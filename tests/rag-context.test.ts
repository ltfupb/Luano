/**
 * tests/rag-context.test.ts — buildRAGContext (electron/ipc/shared.ts)
 *
 * Verifies the multi-turn query construction that feeds docs into the
 * system prompt. The behavior under test:
 * - Extract the last user message verbatim for return (used elsewhere
 *   to label what the user just said).
 * - Build the RAG search query from the last TWO user messages so
 *   follow-ups like "how do I use that?" still retrieve relevant docs.
 * - Cap each message at 2000 chars so a pasted file doesn't drown
 *   the actual question.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockBuildDocsContext } = vi.hoisted(() => ({ mockBuildDocsContext: vi.fn() }))

// shared.ts imports from pro/modules, which wraps the optional Pro context.ts.
// Fake the Pro wrapper with a controllable buildDocsContext.
vi.mock("../electron/pro/modules", () => ({
  buildSystemPrompt: vi.fn(() => ""),
  buildDocsContext: mockBuildDocsContext,
  buildGlobalSummary: vi.fn(async () => ({ globalSummary: "" })),
}))

// shared.ts also imports memory helpers + provider + wag. Stub minimally.
vi.mock("../electron/ai/memory", () => ({
  buildMemoryIndex: vi.fn(() => ""),
  loadInstructions: vi.fn(() => "")
}))
vi.mock("../electron/ai/provider", () => ({
  isAdvisorAvailable: vi.fn(() => false)
}))
vi.mock("../electron/ai/wag", () => ({
  buildWagIndex: vi.fn(),
  wagExists: vi.fn(() => false)
}))
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  BrowserWindow: { getAllWindows: () => [] }
}))

import { buildRAGContext } from "../electron/ipc/shared"

beforeEach(() => {
  mockBuildDocsContext.mockReset()
  mockBuildDocsContext.mockResolvedValue("")
})

describe("buildRAGContext", () => {
  it("returns empty docsContext when there are no user messages", async () => {
    const result = await buildRAGContext([
      { role: "assistant", content: "hello" }
    ])
    expect(result.lastUserMsg).toBe("")
    expect(result.docsContext).toBe("")
    expect(mockBuildDocsContext).not.toHaveBeenCalled()
  })

  it("uses the single user message when only one exists", async () => {
    mockBuildDocsContext.mockResolvedValue("DOCS_FOR_SINGLE_MSG")
    const result = await buildRAGContext([
      { role: "user", content: "explain RunService" }
    ])
    expect(result.lastUserMsg).toBe("explain RunService")
    expect(result.docsContext).toBe("DOCS_FOR_SINGLE_MSG")
    expect(mockBuildDocsContext).toHaveBeenCalledOnce()
    expect(mockBuildDocsContext).toHaveBeenCalledWith("explain RunService")
  })

  it("concatenates the last TWO user messages for the docs search query", async () => {
    await buildRAGContext([
      { role: "user", content: "tell me about RunService" },
      { role: "assistant", content: "RunService provides..." },
      { role: "user", content: "how do I use that?" }
    ])
    expect(mockBuildDocsContext).toHaveBeenCalledWith(
      "tell me about RunService how do I use that?"
    )
  })

  it("ignores user messages older than the last 2", async () => {
    await buildRAGContext([
      { role: "user", content: "FIRST_MSG_SHOULD_BE_DROPPED" },
      { role: "user", content: "middle msg" },
      { role: "user", content: "latest msg" }
    ])
    const [query] = mockBuildDocsContext.mock.calls[0]
    expect(query).not.toContain("FIRST_MSG_SHOULD_BE_DROPPED")
    expect(query).toContain("middle msg")
    expect(query).toContain("latest msg")
  })

  it("returns only the LAST user message as lastUserMsg (not the concatenated query)", async () => {
    const result = await buildRAGContext([
      { role: "user", content: "old question" },
      { role: "user", content: "current question" }
    ])
    expect(result.lastUserMsg).toBe("current question")
  })

  it("caps each message at 2000 chars so a pasted file doesn't drown the question", async () => {
    const hugeFile = "x".repeat(5000)
    await buildRAGContext([
      { role: "user", content: hugeFile },
      { role: "user", content: "what is this?" }
    ])
    const [query] = mockBuildDocsContext.mock.calls[0]
    // Huge message should be truncated to 2000 chars
    expect(query.length).toBeLessThan(hugeFile.length + 100)
    // The actual question must still be fully present
    expect(query).toContain("what is this?")
  })

  it("skips docs search when the concatenated query is whitespace-only", async () => {
    await buildRAGContext([
      { role: "user", content: "   " },
      { role: "user", content: "" }
    ])
    expect(mockBuildDocsContext).not.toHaveBeenCalled()
  })

  it("handles null / undefined content on a prior message without crashing", async () => {
    // Defensive — upstream schemas say content is required, but IPC boundaries
    // can get sloppy. A null content on an older message must not crash the
    // concat; it's replaced with an empty string.
    const result = await buildRAGContext([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { role: "user", content: null as any },
      { role: "user", content: "real question" }
    ])
    expect(result.lastUserMsg).toBe("real question")
    expect(mockBuildDocsContext).toHaveBeenCalledWith(expect.stringContaining("real question"))
  })
})
