/**
 * tests/stream-block-tracker.test.ts — StreamBlockTracker lifecycle tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => {
  const winSend = vi.fn()
  const win = { webContents: { send: winSend } }
  return { winSend, win }
})

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [h.win] }
}))

import { StreamBlockTracker } from "../electron/ai/provider"

beforeEach(() => { vi.clearAllMocks() })

describe("StreamBlockTracker", () => {
  it("broadcasts advisor:true on advisor block_start", () => {
    const t = new StreamBlockTracker("ch")
    t.onStart({ type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "advisor" } })
    expect(h.winSend).toHaveBeenCalledWith("ch:advisor", true)
  })

  it("broadcasts thinking:true on thinking block_start", () => {
    const t = new StreamBlockTracker("ch")
    t.onStart({ type: "content_block_start", index: 1, content_block: { type: "thinking" } })
    expect(h.winSend).toHaveBeenCalledWith("ch:thinking", true)
  })

  it("broadcasts advisor:false on matching block_stop", () => {
    const t = new StreamBlockTracker("ch")
    t.onStart({ type: "content_block_start", index: 0, content_block: { name: "advisor" } })
    t.onStop({ type: "content_block_stop", index: 0 })
    expect(h.winSend).toHaveBeenNthCalledWith(2, "ch:advisor", false)
  })

  it("ignores block_stop with non-matching index", () => {
    const t = new StreamBlockTracker("ch")
    t.onStart({ type: "content_block_start", index: 0, content_block: { name: "advisor" } })
    h.winSend.mockClear()
    t.onStop({ type: "content_block_stop", index: 99 })
    expect(h.winSend).not.toHaveBeenCalled()
  })

  it("tracks advisor and thinking independently", () => {
    const t = new StreamBlockTracker("ch")
    t.onStart({ type: "content_block_start", index: 0, content_block: { name: "advisor" } })
    t.onStart({ type: "content_block_start", index: 1, content_block: { type: "thinking" } })
    t.onStop({ type: "content_block_stop", index: 1 })
    // advisor should still be active; only thinking ended
    expect(h.winSend).toHaveBeenNthCalledWith(3, "ch:thinking", false)
    h.winSend.mockClear()
    t.onStop({ type: "content_block_stop", index: 0 })
    expect(h.winSend).toHaveBeenCalledWith("ch:advisor", false)
  })

  it("respects advisorEnabled=false", () => {
    const t = new StreamBlockTracker("ch", false)
    t.onStart({ type: "content_block_start", index: 0, content_block: { name: "advisor" } })
    expect(h.winSend).not.toHaveBeenCalledWith("ch:advisor", true)
  })

  it("still broadcasts thinking when advisorEnabled=false", () => {
    const t = new StreamBlockTracker("ch", false)
    t.onStart({ type: "content_block_start", index: 0, content_block: { type: "thinking" } })
    expect(h.winSend).toHaveBeenCalledWith("ch:thinking", true)
  })

  it("uses streamChannel as broadcast prefix", () => {
    const t = new StreamBlockTracker("ai:agent:custom-channel")
    t.onStart({ type: "content_block_start", index: 0, content_block: { type: "thinking" } })
    expect(h.winSend).toHaveBeenCalledWith("ai:agent:custom-channel:thinking", true)
  })
})
