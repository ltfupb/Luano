/**
 * tests/agent-sender-scoping.test.ts — H3 / H4 / H6 / H15 sender scoping.
 *
 * Covers:
 *   - H3 owner-only stream broadcast: sendToOwner targets only the owner
 *     window even when multiple BrowserWindows exist.
 *   - resolveOwnerWebContents returns null when the owner is destroyed or
 *     when senderId is missing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => {
  const ownerSend = vi.fn()
  const otherSend = vi.fn()
  const owner = {
    webContents: { id: 101, send: ownerSend, isDestroyed: () => false },
    isDestroyed: () => false,
  }
  const other = {
    webContents: { id: 202, send: otherSend, isDestroyed: () => false },
    isDestroyed: () => false,
  }
  let windows: Array<{ webContents: { id: number; send: typeof ownerSend; isDestroyed: () => boolean }; isDestroyed: () => boolean }> = [owner, other]
  return {
    ownerSend,
    otherSend,
    owner,
    other,
    setWindows: (ws: typeof windows) => { windows = ws },
    getWindows: () => windows,
  }
})

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => h.getWindows() },
  ipcMain: { on: vi.fn(), removeListener: vi.fn(), handle: vi.fn() },
  app: { getPath: () => "/tmp/luano-test", isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false },
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("../electron/ai/provider", () => ({
  getProvider: vi.fn().mockReturnValue("anthropic"),
  getModel: vi.fn().mockReturnValue("claude-sonnet-4-6"),
  getModelTier: vi.fn().mockReturnValue("frontier"),
  getAnthropicClient: vi.fn(),
  getAnthropicPath: vi.fn(),
  getOpenAIClient: vi.fn(),
  isAdvisorAvailable: vi.fn().mockReturnValue(false),
  getAdvisorModel: vi.fn().mockReturnValue("claude-opus-4-6"),
  _setActiveAbortController: vi.fn(),
  toCachedSystem: vi.fn().mockImplementation((s: unknown) => s),
  toCachedTools: vi.fn().mockImplementation((t: unknown) => t),
  chat: vi.fn(),
  StreamBlockTracker: class { onStart() {} onStop() {} },
  getThinkingEffort: vi.fn().mockReturnValue("medium"),
  supportsThinking: vi.fn().mockReturnValue(false),
  getAutoAccept: vi.fn().mockReturnValue(false),
  autoAcceptEmitter: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  ANTHROPIC_THINKING_BUDGET: { low: 1024, medium: 4096, high: 16384, xhigh: 32768, max: 65536 },
  OPENAI_REASONING_EFFORT: { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" }
}))

vi.mock("../electron/ai/tools", () => ({
  TOOLS: [],
  executeTool: vi.fn(),
  previewEdit: () => null
}))

// Pull in the @internal helpers exported by agent.ts.
import { resolveOwnerWebContents, sendToOwner } from "../electron/ai/agent"

beforeEach(() => {
  vi.clearAllMocks()
  h.setWindows([h.owner, h.other])
  h.owner.webContents.isDestroyed = () => false
  h.other.webContents.isDestroyed = () => false
})

describe("H3 — sendToOwner: owner-only stream broadcast", () => {
  it("sends to ONLY the owner window when senderId matches", () => {
    sendToOwner(101, "ai:stream:abc", "chunk-1")

    expect(h.ownerSend).toHaveBeenCalledTimes(1)
    expect(h.ownerSend).toHaveBeenCalledWith("ai:stream:abc", "chunk-1")
    expect(h.otherSend).not.toHaveBeenCalled()
  })

  it("does NOT leak the chunk to a second renderer that didn't start the session", () => {
    // Fan out 5 chunks — the second window should remain quiet for all of them.
    for (let i = 0; i < 5; i++) sendToOwner(101, "ai:stream:abc", `chunk-${i}`)

    expect(h.ownerSend).toHaveBeenCalledTimes(5)
    expect(h.otherSend).not.toHaveBeenCalled()
  })

  it("falls back to broadcast only when senderId is undefined (legacy callers)", () => {
    sendToOwner(undefined, "legacy:notice", "x")

    expect(h.ownerSend).toHaveBeenCalledWith("legacy:notice", "x")
    expect(h.otherSend).toHaveBeenCalledWith("legacy:notice", "x")
  })

  it("drops the send silently when the owner is gone (no window matches the id)", () => {
    sendToOwner(999, "ai:stream:abc", "chunk")

    expect(h.ownerSend).not.toHaveBeenCalled()
    expect(h.otherSend).not.toHaveBeenCalled()
  })

  it("drops the send when the owner WebContents is destroyed", () => {
    h.owner.webContents.isDestroyed = () => true

    sendToOwner(101, "ai:stream:abc", "chunk")

    expect(h.ownerSend).not.toHaveBeenCalled()
    expect(h.otherSend).not.toHaveBeenCalled()
  })
})

describe("resolveOwnerWebContents", () => {
  it("returns the WebContents when senderId matches an existing window", () => {
    const wc = resolveOwnerWebContents(101)
    expect(wc).toBe(h.owner.webContents)
  })

  it("returns null when senderId is undefined", () => {
    expect(resolveOwnerWebContents(undefined)).toBeNull()
  })

  it("returns null when no window matches the senderId", () => {
    expect(resolveOwnerWebContents(999)).toBeNull()
  })

  it("returns null when the matched WebContents is destroyed", () => {
    h.owner.webContents.isDestroyed = () => true
    expect(resolveOwnerWebContents(101)).toBeNull()
  })
})
