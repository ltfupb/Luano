/**
 * tests/agent-loop-openai.test.ts — Phase machine tests for OpenAI path
 *
 * Tests the OpenAI path of agentChat:
 *   PLAN → EXECUTE → VERIFY
 *
 * Strategy mirrors agent-loop.test.ts but mocks getProvider to return "openai"
 * and uses createOpenAIStream / openaiToolCall fixtures instead of Anthropic ones.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  createOpenAIStream,
  openaiToolCall
} from "./__fixtures__/openai-stream"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const winSend = vi.fn()
  const win = { webContents: { send: winSend } }

  const mockExecuteTool = vi.fn()
  const mockGetOpenAIClient = vi.fn()
  const mockGetAnthropicClient = vi.fn()
  const mockExistsSyncRaw = vi.fn()
  const mockReadFileSyncRaw = vi.fn().mockReturnValue("")

  return { winSend, win, mockExecuteTool, mockGetOpenAIClient, mockGetAnthropicClient, mockExistsSyncRaw, mockReadFileSyncRaw }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [h.win] }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("../electron/ai/provider", () => ({
  getProvider: vi.fn().mockReturnValue("openai"),
  getModel: vi.fn().mockReturnValue("gpt-4o"),
  getAnthropicClient: h.mockGetAnthropicClient,
  getOpenAIClient: h.mockGetOpenAIClient,
  isAdvisorAvailable: vi.fn().mockReturnValue(false),
  _setActiveAbortController: vi.fn(),
  toCachedSystem: vi.fn().mockImplementation((s: unknown) => s),
  toCachedTools: vi.fn().mockImplementation((t: unknown) => t),
  chat: vi.fn()
}))

vi.mock("../electron/ai/tools", () => ({
  TOOLS: [],
  executeTool: h.mockExecuteTool
}))

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs")
  return {
    ...actual,
    existsSync: h.mockExistsSyncRaw,
    readFileSync: h.mockReadFileSyncRaw
  }
})

// ── Import under test ─────────────────────────────────────────────────────────

import { agentChat } from "../electron/ai/agent"

// ── Helpers ───────────────────────────────────────────────────────────────────

/** OpenAI client mock with a single create function that returns different streams. */
function makeClient(stream: ReturnType<typeof createOpenAIStream>) {
  return {
    chat: { completions: { create: vi.fn().mockReturnValue(stream) } }
  }
}

function userMsg(content: string) {
  return [{ role: "user" as const, content }]
}

const SYS = "system prompt"
const CH = "test-channel"

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  h.mockExistsSyncRaw.mockReturnValue(false)
  h.mockExecuteTool.mockResolvedValue({ success: true, output: "ok", filePath: undefined })
})

describe("agentChat — OpenAI path", () => {
  // ── 1. Question bypass ──────────────────────────────────────────────────────
  it("skips plan phase when message is a question", async () => {
    const execStream = createOpenAIStream({ finishReason: "stop", content: "42" })
    h.mockGetOpenAIClient.mockResolvedValue(makeClient(execStream))

    await agentChat(userMsg("what is Luau?"), SYS, CH)

    // Only one client creation (execute), not two (plan + execute)
    expect(h.mockGetOpenAIClient).toHaveBeenCalledTimes(1)
  })

  // ── 2. Plan → Execute transition ────────────────────────────────────────────
  it("runs plan then execute for non-question message", async () => {
    const planStream = createOpenAIStream({ content: "1. Create foo.luau" })
    const execStream = createOpenAIStream({ finishReason: "stop", content: "done" })

    const client = {
      chat: {
        completions: {
          create: vi.fn()
            .mockReturnValueOnce(planStream)
            .mockReturnValueOnce(execStream)
        }
      }
    }
    h.mockGetOpenAIClient.mockResolvedValue(client)

    await agentChat(userMsg("create a new module"), SYS, CH)

    // Two client calls: plan + execute
    expect(h.mockGetOpenAIClient).toHaveBeenCalledTimes(2)

    const sentTexts = h.winSend.mock.calls
      .filter(([ch]: [string]) => ch === CH)
      .map(([, text]: [string, unknown]) => text)
    expect(sentTexts).toContain("1. Create foo.luau")
  })

  // ── 3. Execute: tool_calls → executeTool called → file tracked ──────────────
  it("executes create_file tool and tracks it in modifiedFiles", async () => {
    const round1 = createOpenAIStream({
      finishReason: "tool_calls",
      toolCalls: [openaiToolCall("create_file", { path: "/tmp/foo.lua", content: "return {}" })]
    })
    const round2 = createOpenAIStream({ finishReason: "stop" })

    const client = {
      chat: {
        completions: {
          create: vi.fn()
            .mockReturnValueOnce(round1)
            .mockReturnValueOnce(round2)
        }
      }
    }
    h.mockGetOpenAIClient.mockResolvedValue(client)
    h.mockExecuteTool.mockResolvedValue({ success: true, output: "Created", filePath: "/tmp/foo.lua" })

    // Question form skips plan phase
    const result = await agentChat(userMsg("create foo?"), SYS, CH)

    expect(h.mockExecuteTool).toHaveBeenCalledWith("create_file", expect.objectContaining({ path: "/tmp/foo.lua" }), undefined)
    expect(result.modifiedFiles).toContain("/tmp/foo.lua")
  })

  // ── 4. Clean stop, no files → no lint, clean exit ──────────────────────────
  it("ends cleanly when execute returns stop with no modified files", async () => {
    const execStream = createOpenAIStream({ finishReason: "stop", content: "nothing to do" })
    h.mockGetOpenAIClient.mockResolvedValue(makeClient(execStream))

    const result = await agentChat(userMsg("say hello"), SYS, CH)

    expect(result.modifiedFiles).toHaveLength(0)
    expect(h.mockExecuteTool).not.toHaveBeenCalled()

    const lastSend = h.winSend.mock.calls.filter(([ch]: [string]) => ch === CH).pop()
    expect(lastSend?.[1]).toBeNull()
  })

  // ── 5. VERIFY: lint errors → AUTO-VERIFY injected ──────────────────────────
  it("enters verify phase when lint errors found after execute", async () => {
    const modFile = "/tmp/test.luau"
    h.mockExistsSyncRaw.mockImplementation((f: string) => f === modFile)

    const round1 = createOpenAIStream({
      finishReason: "tool_calls",
      toolCalls: [openaiToolCall("create_file", { path: modFile, content: "bad code" })]
    })
    const round2 = createOpenAIStream({ finishReason: "stop" })
    const round3 = createOpenAIStream({ finishReason: "stop" })

    const client = {
      chat: {
        completions: {
          create: vi.fn()
            .mockReturnValueOnce(round1)
            .mockReturnValueOnce(round2)
            .mockReturnValueOnce(round3)
        }
      }
    }
    h.mockGetOpenAIClient.mockResolvedValue(client)

    h.mockExecuteTool
      .mockResolvedValueOnce({ success: true, output: "Created", filePath: modFile })
      .mockResolvedValueOnce({ success: true, output: "ERROR: undefined variable 'x' at line 1" })
      .mockResolvedValue({ success: true, output: "No lint errors" })

    await agentChat(userMsg("create a script?"), SYS, CH)

    expect(h.mockExecuteTool).toHaveBeenCalledWith("lint_file", expect.anything(), undefined)
    // execute → verify-trigger → verify = 3 stream calls
    expect(client.chat.completions.create).toHaveBeenCalledTimes(3)
  })

  // ── 6. MAX_TOOLS_PER_ROUND: 11th tool call is skipped ──────────────────────
  it("skips tools beyond MAX_TOOLS_PER_ROUND (10) per round", async () => {
    const toolCalls = Array.from({ length: 11 }, (_, i) =>
      openaiToolCall("read_file", { path: `/tmp/file${i}.lua` }, `call_${i}`)
    )
    const round1 = createOpenAIStream({ finishReason: "tool_calls", toolCalls })
    const round2 = createOpenAIStream({ finishReason: "stop" })

    const client = {
      chat: {
        completions: {
          create: vi.fn()
            .mockReturnValueOnce(round1)
            .mockReturnValueOnce(round2)
        }
      }
    }
    h.mockGetOpenAIClient.mockResolvedValue(client)

    await agentChat(userMsg("read files?"), SYS, CH)

    expect(h.mockExecuteTool).toHaveBeenCalledTimes(10)
  })

  // ── 7. delete_file blocked unless user explicitly requested ─────────────────
  it("blocks delete_file when user message does not mention delete", async () => {
    const round1 = createOpenAIStream({
      finishReason: "tool_calls",
      toolCalls: [openaiToolCall("delete_file", { path: "/tmp/foo.lua" }, "call_del")]
    })
    const round2 = createOpenAIStream({ finishReason: "stop" })

    const client = {
      chat: {
        completions: {
          create: vi.fn()
            .mockReturnValueOnce(round1)
            .mockReturnValueOnce(round2)
        }
      }
    }
    h.mockGetOpenAIClient.mockResolvedValue(client)

    await agentChat(userMsg("refactor this code?"), SYS, CH)

    const deleteCall = h.mockExecuteTool.mock.calls.find(([name]: [string]) => name === "delete_file")
    expect(deleteCall).toBeUndefined()
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  // ── 8. delete_file allowed when user explicitly says "delete" ───────────────
  it("allows delete_file when user message contains delete keyword", async () => {
    const round1 = createOpenAIStream({
      finishReason: "tool_calls",
      toolCalls: [openaiToolCall("delete_file", { path: "/tmp/foo.lua" }, "call_del")]
    })
    const round2 = createOpenAIStream({ finishReason: "stop" })

    const client = {
      chat: {
        completions: {
          create: vi.fn()
            .mockReturnValueOnce(round1)
            .mockReturnValueOnce(round2)
        }
      }
    }
    h.mockGetOpenAIClient.mockResolvedValue(client)
    h.mockExecuteTool.mockResolvedValue({ success: true, output: "Deleted", filePath: "/tmp/foo.lua" })

    await agentChat(userMsg("delete foo.lua please?"), SYS, CH)

    expect(h.mockExecuteTool).toHaveBeenCalledWith("delete_file", expect.objectContaining({ path: "/tmp/foo.lua" }), undefined)
  })

  // ── 9. Stream termination sentinel always sent ──────────────────────────────
  it("always sends null sentinel to close the stream on exit", async () => {
    const execStream = createOpenAIStream({ finishReason: "stop" })
    h.mockGetOpenAIClient.mockResolvedValue(makeClient(execStream))

    await agentChat(userMsg("hello?"), SYS, CH)

    const channelSends = h.winSend.mock.calls.filter(([ch]: [string]) => ch === CH)
    const sentValues = channelSends.map(([, v]: [string, unknown]) => v)
    expect(sentValues).toContain(null)
    expect(sentValues[sentValues.length - 1]).toBeNull()
  })

  // ── 10. Anthropic client is NOT called on OpenAI path ──────────────────────
  it("never calls getAnthropicClient when provider is openai", async () => {
    const execStream = createOpenAIStream({ finishReason: "stop" })
    h.mockGetOpenAIClient.mockResolvedValue(makeClient(execStream))

    await agentChat(userMsg("hello?"), SYS, CH)

    expect(h.mockGetAnthropicClient).not.toHaveBeenCalled()
  })
})
