/**
 * tests/inline-edit.test.ts — Tests for inlineEdit() in electron/ai/agent.ts
 *
 * inlineEdit() makes a single non-streaming API call (OpenAI or Anthropic)
 * and returns the modified file content with markdown fences stripped.
 *
 * Tests cover:
 *   - OpenAI path: happy path, fence stripping, null content fallback
 *   - Anthropic path: happy path, fence stripping, non-text block fallback
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildOpenAIResponse } from "./__fixtures__/openai-stream"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockGetProvider = vi.fn().mockReturnValue("anthropic")
  const mockGetOpenAIClient = vi.fn()
  const mockGetAnthropicClient = vi.fn()

  return { mockGetProvider, mockGetOpenAIClient, mockGetAnthropicClient }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("../electron/ai/provider", () => ({
  getProvider: h.mockGetProvider,
  getModel: vi.fn().mockReturnValue("gpt-4o"),
  getAnthropicClient: h.mockGetAnthropicClient,
  getOpenAIClient: h.mockGetOpenAIClient,
  isAdvisorAvailable: vi.fn().mockReturnValue(false),
  _setActiveAbortController: vi.fn(),
  toCachedSystem: vi.fn().mockImplementation((s: unknown) => s),
  toCachedTools: vi.fn().mockImplementation((t: unknown) => t),
  chat: vi.fn()
}))

vi.mock("../electron/ai/tools", () => ({ TOOLS: [], executeTool: vi.fn() }))

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs")
  return { ...actual, existsSync: vi.fn().mockReturnValue(false), readFileSync: vi.fn().mockReturnValue("") }
})

// ── Import under test ─────────────────────────────────────────────────────────

import { inlineEdit } from "../electron/ai/agent"

// ── Helpers ───────────────────────────────────────────────────────────────────

const FILE = "/project/test.luau"
const ORIGINAL = "local x = 1\nreturn x\n"
const SYS = "system prompt"

/** Minimal Anthropic non-streaming response */
function anthropicResponse(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe("inlineEdit — OpenAI path", () => {
  beforeEach(() => {
    h.mockGetProvider.mockReturnValue("openai")
  })

  it("returns modified content from API response", async () => {
    const modified = "local x = 99\nreturn x\n"
    const openai = { chat: { completions: { create: vi.fn().mockResolvedValue(buildOpenAIResponse({ content: modified })) } } }
    h.mockGetOpenAIClient.mockResolvedValue(openai)

    const result = await inlineEdit(FILE, ORIGINAL, "change x to 99", SYS)

    expect(result).toBe(modified.trim())
  })

  it("strips lua code fences from response", async () => {
    const withFences = "```lua\nlocal x = 99\nreturn x\n```"
    const openai = { chat: { completions: { create: vi.fn().mockResolvedValue(buildOpenAIResponse({ content: withFences })) } } }
    h.mockGetOpenAIClient.mockResolvedValue(openai)

    const result = await inlineEdit(FILE, ORIGINAL, "change x to 99", SYS)

    expect(result).toBe("local x = 99\nreturn x")
    expect(result).not.toContain("```")
  })

  it("strips luau code fences from response", async () => {
    const withFences = "```luau\nlocal x = 99\nreturn x\n```"
    const openai = { chat: { completions: { create: vi.fn().mockResolvedValue(buildOpenAIResponse({ content: withFences })) } } }
    h.mockGetOpenAIClient.mockResolvedValue(openai)

    const result = await inlineEdit(FILE, ORIGINAL, "change x to 99", SYS)

    expect(result).not.toContain("```")
    expect(result).toContain("local x = 99")
  })

  it("falls back to original content when API returns null message content", async () => {
    // Construct a response with explicitly null content (not using buildOpenAIResponse
    // which defaults to "ok" for empty options)
    const nullContentResponse = { choices: [{ message: { role: "assistant", content: null } }] }
    const openai = { chat: { completions: { create: vi.fn().mockResolvedValue(nullContentResponse) } } }
    h.mockGetOpenAIClient.mockResolvedValue(openai)

    const result = await inlineEdit(FILE, ORIGINAL, "change x to 99", SYS)

    // null content → falls back to fileContent passed in
    expect(result).toBe(ORIGINAL.trim())
  })

  it("sends instruction and file content to the API", async () => {
    const openai = { chat: { completions: { create: vi.fn().mockResolvedValue(buildOpenAIResponse({ content: ORIGINAL })) } } }
    h.mockGetOpenAIClient.mockResolvedValue(openai)

    await inlineEdit(FILE, ORIGINAL, "add a comment", SYS)

    const callArgs = openai.chat.completions.create.mock.calls[0][0]
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user")
    expect(userMessage.content).toContain("add a comment")
    expect(userMessage.content).toContain(ORIGINAL)
  })
})

describe("inlineEdit — Anthropic path", () => {
  beforeEach(() => {
    h.mockGetProvider.mockReturnValue("anthropic")
  })

  it("returns modified content from API response", async () => {
    const modified = "local x = 99\nreturn x\n"
    const anthropic = { messages: { create: vi.fn().mockResolvedValue(anthropicResponse(modified)) } }
    h.mockGetAnthropicClient.mockResolvedValue(anthropic)

    const result = await inlineEdit(FILE, ORIGINAL, "change x to 99", SYS)

    expect(result).toBe(modified.trim())
  })

  it("strips lua code fences from response", async () => {
    const withFences = "```lua\nlocal x = 99\nreturn x\n```"
    const anthropic = { messages: { create: vi.fn().mockResolvedValue(anthropicResponse(withFences)) } }
    h.mockGetAnthropicClient.mockResolvedValue(anthropic)

    const result = await inlineEdit(FILE, ORIGINAL, "change x to 99", SYS)

    expect(result).not.toContain("```")
    expect(result).toContain("local x = 99")
  })

  it("falls back to original content when response block is not text type", async () => {
    // Non-text block (e.g. tool_use) → falls back to fileContent
    const anthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [{ type: "tool_use", id: "t1", name: "fn", input: {} }] })
      }
    }
    h.mockGetAnthropicClient.mockResolvedValue(anthropic)

    const result = await inlineEdit(FILE, ORIGINAL, "change x to 99", SYS)

    expect(result).toBe(ORIGINAL.trim())
  })

  it("does not call getOpenAIClient on Anthropic path", async () => {
    const anthropic = { messages: { create: vi.fn().mockResolvedValue(anthropicResponse(ORIGINAL)) } }
    h.mockGetAnthropicClient.mockResolvedValue(anthropic)

    await inlineEdit(FILE, ORIGINAL, "noop", SYS)

    expect(h.mockGetOpenAIClient).not.toHaveBeenCalled()
  })
})
