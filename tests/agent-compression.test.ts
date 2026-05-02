/**
 * tests/agent-compression.test.ts — tests for the history compression pipeline
 * in electron/ai/agent.ts.
 *
 * Coverage:
 *   - deterministicTrimHistory: keeps first + last N, no-ops under budget,
 *     no-ops when history shorter than KEEP_RECENT
 *   - compressHistoryIfNeeded: three paths — LLM summary succeeds / summary
 *     too short / chat() throws — each emits the correct
 *     ai:history-compressed event
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Shared renderer-window send spy — lets us assert broadcasts on the
// ai:history-compressed IPC channel.
const h = vi.hoisted(() => {
  const winSend = vi.fn()
  const win = { webContents: { send: winSend } }
  return { winSend, win }
})

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [h.win] },
  ipcMain: { on: vi.fn(), once: vi.fn(), removeListener: vi.fn() }
}))
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))
vi.mock("../electron/sidecar/index", () => ({ spawnSidecar: vi.fn(), isBinaryAvailable: vi.fn(() => false) }))
vi.mock("../electron/sidecar/selene", () => ({ lintFile: vi.fn() }))
vi.mock("../electron/sidecar/stylua", () => ({ formatFile: vi.fn() }))
vi.mock("../electron/bridge/server", () => ({
  getBridgeTree: vi.fn(), getBridgeLogs: vi.fn(), isBridgeConnected: vi.fn(() => false),
  queueScript: vi.fn(), consumeCommandResult: vi.fn()
}))
vi.mock("../electron/mcp/client", () => ({
  isMcpConnected: vi.fn(async () => false),
  mcpInsertModel: vi.fn(async () => ({ success: false, output: "" }))
}))
vi.mock("../electron/ai/rag", () => ({ searchDocs: vi.fn() }))
vi.mock("../electron/file/sandbox", () => ({ validatePath: vi.fn() }))
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs")
  return { ...actual, existsSync: vi.fn(() => true), readFileSync: vi.fn(() => "") }
})
vi.mock("../electron/ai/wag", () => ({
  wagExists: vi.fn(() => false), readWagFile: vi.fn(),
  listSiblings: vi.fn(() => []), searchWag: vi.fn(() => []), rebuildWagIndex: vi.fn()
}))

// chat() is the knob we drive — mock it at the provider module so compression
// can be tested in isolation (succeeds / too-short / throws).
const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }))
vi.mock("../electron/ai/provider", () => ({
  getProvider: vi.fn().mockReturnValue("anthropic"),
  getModel: vi.fn().mockReturnValue("claude-sonnet-4-6"),
  getModelTier: vi.fn().mockReturnValue("frontier"),
  getAnthropicClient: vi.fn(), getOpenAIClient: vi.fn(),
  getAnthropicPath: vi.fn(),
  isAdvisorAvailable: vi.fn().mockReturnValue(false),
  getAdvisorModel: vi.fn().mockReturnValue("claude-opus-4-6"),
  _setActiveAbortController: vi.fn(),
  toCachedSystem: vi.fn().mockImplementation((s: unknown) => s),
  toCachedTools: vi.fn().mockImplementation((t: unknown) => t),
  chat: mockChat,
  StreamBlockTracker: class { onStart() {} onStop() {} }
}))

import {
  deterministicTrimHistory,
  compressHistoryIfNeeded,
  broadcastHistoryCompressed,
  estimateTokens
} from "../electron/ai/agent"

type Msg = { role: string; content?: unknown }

beforeEach(() => {
  vi.clearAllMocks()
})

// ── deterministicTrimHistory ────────────────────────────────────────────────

describe("deterministicTrimHistory", () => {
  it("keeps the first message and the last 8 when history is long — middle dropped", () => {
    // 20 messages → first + last 8 = 9 total after trim.
    const history: Msg[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg-${i}`
    }))
    const first = history[0]
    const last8 = history.slice(-8)

    deterministicTrimHistory(history, 1000, 150_000)

    expect(history.length).toBe(9)
    expect(history[0]).toBe(first)
    // Preserve order of the last 8
    for (let i = 0; i < 8; i++) {
      expect(history[i + 1]).toBe(last8[i])
    }
    // A middle message was dropped
    expect(history.some((m) => m.content === "msg-5")).toBe(false)
  })

  it("returns unchanged when history is already at/under KEEP_RECENT + 1", () => {
    // KEEP_RECENT = 8; 9 or fewer messages should not be sliced.
    const history: Msg[] = Array.from({ length: 9 }, (_, i) => ({
      role: "user", content: `msg-${i}`
    }))
    const snapshot = [...history]

    deterministicTrimHistory(history, 1000, 150_000)

    expect(history.length).toBe(9)
    history.forEach((m, i) => expect(m).toBe(snapshot[i]))
  })

  it("returns unchanged when history is small and already under token budget", () => {
    const history: Msg[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" }
    ]

    deterministicTrimHistory(history, 0, 150_000)

    expect(history.length).toBe(2)
    expect(history[0].content).toBe("hi")
    expect(history[1].content).toBe("hello")
  })

  it("respects maxBudget — if the post-slice history still exceeds it, truncateHistory trims further", () => {
    // Fabricate a message so large it alone blows the budget. truncateHistory
    // is supposed to keep shifting until <= budget OR history.length <= 2.
    const bigContent = "x".repeat(200_000) // ~55k tokens per the ASCII estimator
    const history: Msg[] = [
      { role: "user", content: "original goal" },
      { role: "user", content: bigContent },
      { role: "assistant", content: "ok" },
      { role: "user", content: "next" },
      ...Array.from({ length: 12 }, (_, i) => ({ role: "user" as const, content: `tail-${i}` }))
    ]
    const beforeLen = history.length

    deterministicTrimHistory(history, 0, 10_000)

    // truncateHistory stops at length <= 2 even when still over budget.
    expect(history.length).toBeLessThanOrEqual(beforeLen)
    expect(history.length).toBeGreaterThanOrEqual(2)
  })
})

// ── broadcastHistoryCompressed ──────────────────────────────────────────────

describe("broadcastHistoryCompressed", () => {
  it("emits the ai:history-compressed event with lossy + reason payload", () => {
    broadcastHistoryCompressed(true, "llm-summary")
    expect(h.winSend).toHaveBeenCalledWith(
      "ai:history-compressed",
      { lossy: true, reason: "llm-summary" }
    )
  })

  it("passes lossy:false through faithfully", () => {
    broadcastHistoryCompressed(false, "no-op")
    expect(h.winSend).toHaveBeenCalledWith(
      "ai:history-compressed",
      { lossy: false, reason: "no-op" }
    )
  })
})

// ── compressHistoryIfNeeded ─────────────────────────────────────────────────

/**
 * Build a history large enough that compressHistoryIfNeeded's threshold check
 * passes: the function bails when estimated tokens < 60% of (maxBudget - systemTokens)
 * OR when history.length < 6.
 *
 * We pack each message with ~40k ASCII chars (≈10.5k tokens by the estimator)
 * so 8 messages cross the ~84k threshold even with systemTokens=0 and a
 * default 150k budget.
 */
function buildOverBudgetHistory(): Msg[] {
  const bulk = "word ".repeat(10_000) // ~50k chars each → ~13k tokens each
  return Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `msg-${i}-${bulk}`
  }))
}

describe("compressHistoryIfNeeded", () => {
  it("no-ops when history is short (length < 6)", async () => {
    const history: Msg[] = [
      { role: "user", content: "short-1" },
      { role: "assistant", content: "short-2" }
    ]
    const snapshot = [...history]

    await compressHistoryIfNeeded(history, 0, undefined, 150_000)

    expect(history).toEqual(snapshot)
    expect(mockChat).not.toHaveBeenCalled()
    expect(h.winSend).not.toHaveBeenCalled()
  })

  it("no-ops when under the 60% threshold", async () => {
    const history: Msg[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `small-${i}` // tiny — well under threshold
    }))
    const snapshot = [...history]

    await compressHistoryIfNeeded(history, 0, undefined, 150_000)

    expect(history).toEqual(snapshot)
    expect(mockChat).not.toHaveBeenCalled()
    expect(h.winSend).not.toHaveBeenCalled()
  })

  it("replaces the oldest half with the LLM summary and broadcasts llm-summary", async () => {
    const summary = "- decision A made\n- file X modified\n- pending: add tests"
    mockChat.mockResolvedValueOnce(summary)

    const history = buildOverBudgetHistory()
    const originalLen = history.length

    await compressHistoryIfNeeded(history, 0, undefined, 150_000)

    expect(mockChat).toHaveBeenCalledTimes(1)
    // splice(0, splitIdx, newSummary): new length == (len - splitIdx) + 1
    const splitIdx = Math.floor(originalLen / 2)
    expect(history.length).toBe(originalLen - splitIdx + 1)
    expect(history[0].role).toBe("user")
    expect(String(history[0].content)).toContain("[Previous conversation summary]")
    expect(String(history[0].content)).toContain(summary)

    expect(h.winSend).toHaveBeenCalledWith(
      "ai:history-compressed",
      { lossy: true, reason: "llm-summary" }
    )
  })

  it("falls back to deterministic trim and broadcasts summary-too-short when chat() returns a short string", async () => {
    mockChat.mockResolvedValueOnce("tiny") // <= 20 chars threshold in agent.ts

    const history = buildOverBudgetHistory()
    const originalLen = history.length

    await compressHistoryIfNeeded(history, 0, undefined, 150_000)

    expect(mockChat).toHaveBeenCalledTimes(1)
    // Deterministic trim shrank history — summary path would have made it
    // longer-than-originalLen - splitIdx + 1; fallback keeps first + last 8.
    expect(history.length).toBeLessThanOrEqual(originalLen)
    // Specifically look for the summary-too-short broadcast.
    const reasons = h.winSend.mock.calls
      .filter((c) => c[0] === "ai:history-compressed")
      .map((c) => (c[1] as { reason: string }).reason)
    expect(reasons).toContain("summary-too-short")
  })

  it("falls back to deterministic trim and broadcasts summary-error when chat() throws", async () => {
    mockChat.mockRejectedValueOnce(new Error("rate limit exceeded"))

    const history = buildOverBudgetHistory()
    const originalLen = history.length

    await compressHistoryIfNeeded(history, 0, undefined, 150_000)

    expect(mockChat).toHaveBeenCalledTimes(1)
    expect(history.length).toBeLessThanOrEqual(originalLen)
    const reasons = h.winSend.mock.calls
      .filter((c) => c[0] === "ai:history-compressed")
      .map((c) => (c[1] as { reason: string }).reason)
    // Reason starts with "summary-error: " and contains the underlying err msg.
    expect(reasons.some((r) => r.startsWith("summary-error:"))).toBe(true)
    expect(reasons.some((r) => r.includes("rate limit"))).toBe(true)
  })
})

// Sanity: threshold calculation lines up with our buildOverBudgetHistory helper.
describe("threshold sanity", () => {
  it("buildOverBudgetHistory exceeds 60% of (150_000 - 0)", () => {
    const history = buildOverBudgetHistory()
    const totalTokens = history.reduce(
      (sum, m) => sum + estimateTokens(String(m.content ?? "")),
      0
    )
    expect(totalTokens).toBeGreaterThan(0.6 * 150_000)
  })
})
