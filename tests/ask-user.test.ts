/**
 * tests/ask-user.test.ts — requestAskUser IPC round-trip tests
 *
 * Tests the ask_user tool's main-process side:
 *   - correct answer formatting (single, multi, missing)
 *   - abort signal resolves null and cleans up
 *   - mismatched ID is ignored
 *   - empty questions short-circuits
 *   - multiSelect comma-join and whitelist validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { IpcMainEvent } from "electron"

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockIpcMainOnce, mockIpcMainRemoveListener } = vi.hoisted(() => ({
  mockIpcMainOnce: vi.fn(),
  mockIpcMainRemoveListener: vi.fn()
}))

const h = vi.hoisted(() => {
  const winSend = vi.fn()
  const win = { webContents: { send: winSend } }
  return { winSend, win }
})

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [h.win] },
  ipcMain: {
    on: vi.fn(),
    once: mockIpcMainOnce,
    removeListener: mockIpcMainRemoveListener
  }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("../electron/sidecar/index", () => ({
  spawnSidecar: vi.fn(),
  isBinaryAvailable: vi.fn(() => false)
}))
vi.mock("../electron/sidecar/selene", () => ({ lintFile: vi.fn() }))
vi.mock("../electron/sidecar/stylua", () => ({ formatFile: vi.fn() }))
vi.mock("../electron/bridge/server", () => ({
  getBridgeTree: vi.fn(),
  getBridgeLogs: vi.fn(),
  isBridgeConnected: vi.fn(() => false),
  queueScript: vi.fn(),
  consumeCommandResult: vi.fn()
}))
vi.mock("../electron/mcp/client", () => ({
  isMcpConnected: vi.fn(async () => false),
  mcpRunCode: vi.fn(async () => ({ success: false, output: "" })),
  mcpGetConsole: vi.fn(async () => null),
  mcpInsertModel: vi.fn(async () => ({ success: false, output: "" }))
}))
vi.mock("../electron/ai/rag", () => ({ searchDocs: vi.fn() }))
vi.mock("../electron/file/sandbox", () => ({ validatePath: vi.fn() }))
vi.mock("../electron/ai/wag", () => ({
  wagExists: vi.fn(() => false),
  readWagFile: vi.fn(),
  listSiblings: vi.fn(() => []),
  searchWag: vi.fn(() => []),
  rebuildWagIndex: vi.fn()
}))
vi.mock("../electron/ai/provider", () => ({
  getProvider: vi.fn().mockReturnValue("anthropic"),
  getModel: vi.fn().mockReturnValue("claude-sonnet-4-6"),
  getModelTier: vi.fn().mockReturnValue("frontier"),
  getAnthropicClient: vi.fn(),
  getOpenAIClient: vi.fn(),
  isAdvisorAvailable: vi.fn().mockReturnValue(false),
  getAdvisorModel: vi.fn().mockReturnValue("claude-opus-4-6"),
  _setActiveAbortController: vi.fn(),
  toCachedSystem: vi.fn().mockImplementation((s: unknown) => s),
  toCachedTools: vi.fn().mockImplementation((t: unknown) => t),
  chat: vi.fn(),
  StreamBlockTracker: class { onStart() {} onStop() {} }
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import { requestAskUser } from "../electron/ai/agent"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQuestion(overrides?: Partial<import("../electron/ai/agent").AskUserQuestion>) {
  return {
    question: "Pick a style",
    header: "Style",
    options: [{ label: "Option A" }, { label: "Option B" }],
    ...overrides
  }
}

/** Simulate the renderer sending back an answer by triggering the registered handler */
function resolveWithAnswers(id: string, answers: Record<string, string>) {
  const [, handler] = mockIpcMainOnce.mock.calls[mockIpcMainOnce.mock.calls.length - 1] as [
    string,
    (e: IpcMainEvent, data: { id: string; answers: Record<string, string> }) => void
  ]
  handler({} as IpcMainEvent, { id, answers })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe("requestAskUser", () => {
  it("returns '(no questions provided)' immediately for empty array", async () => {
    const result = await requestAskUser([], "ch", new AbortController().signal)
    expect(result).toBe("(no questions provided)")
    expect(mockIpcMainOnce).not.toHaveBeenCalled()
  })

  it("broadcasts questions to all windows with a UUID id", async () => {
    const controller = new AbortController()
    const promise = requestAskUser([makeQuestion()], "ai:agent:1", controller.signal)

    const sentId = (h.winSend.mock.calls[0][1] as { id: string }).id
    expect(sentId).toMatch(/^[0-9a-f-]{36}$/) // UUID format

    resolveWithAnswers(sentId, { "0": "Option A" })
    await promise
    expect(h.winSend).toHaveBeenCalledWith("ai:agent:1:ask-user", { id: sentId, questions: expect.any(Array) })
  })

  it("formats answer as 'Question\\n→ Answer' for single-select", async () => {
    const controller = new AbortController()
    const promise = requestAskUser([makeQuestion()], "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    resolveWithAnswers(id, { "0": "Option A" })
    const result = await promise
    expect(result).toBe("Pick a style\n→ Option A")
  })

  it("joins multiple questions with double newline", async () => {
    const controller = new AbortController()
    const qs = [makeQuestion({ question: "Q1" }), makeQuestion({ question: "Q2" })]
    const promise = requestAskUser(qs, "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    resolveWithAnswers(id, { "0": "Option A", "1": "Option B" })
    const result = await promise
    expect(result).toBe("Q1\n→ Option A\n\nQ2\n→ Option B")
  })

  it("uses '(no answer)' when answer key is missing", async () => {
    const controller = new AbortController()
    const promise = requestAskUser([makeQuestion()], "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    resolveWithAnswers(id, {})
    const result = await promise
    expect(result).toBe("Pick a style\n→ (no answer)")
  })

  it("whitelist-rejects an answer not in options", async () => {
    const controller = new AbortController()
    const promise = requestAskUser([makeQuestion()], "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    resolveWithAnswers(id, { "0": "injected content" })
    const result = await promise
    expect(result).toBe("Pick a style\n→ (no answer)")
  })

  it("resolves null and cleans up listener on abort", async () => {
    const controller = new AbortController()
    const promise = requestAskUser([makeQuestion()], "ch", controller.signal)

    controller.abort()
    const result = await promise
    expect(result).toBeNull()
    expect(mockIpcMainRemoveListener).toHaveBeenCalled()
  })

  it("validates multiSelect answers — keeps only known labels", async () => {
    const controller = new AbortController()
    const qs = [makeQuestion({ multiSelect: true })]
    const promise = requestAskUser(qs, "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    // "Option A" is valid, "Injected" is not
    resolveWithAnswers(id, { "0": "Option A, Injected, Option B" })
    const result = await promise
    expect(result).toBe("Pick a style\n→ Option A, Option B")
  })

  it("formats multiSelect selections as comma-joined labels", async () => {
    const controller = new AbortController()
    const qs = [makeQuestion({ multiSelect: true })]
    const promise = requestAskUser(qs, "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    resolveWithAnswers(id, { "0": "Option A, Option B" })
    const result = await promise
    expect(result).toBe("Pick a style\n→ Option A, Option B")
  })
})
