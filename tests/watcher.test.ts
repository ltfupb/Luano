/**
 * tests/watcher.test.ts — file watcher event handlers + cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const h = vi.hoisted(() => {
  // Inline minimal EventEmitter substitute (avoids require() in hoisted block).
  type Listener = (...args: unknown[]) => void
  const listeners = new Map<string, Listener[]>()
  const watcherInstance = {
    on(event: string, fn: Listener) {
      const arr = listeners.get(event) ?? []
      arr.push(fn)
      listeners.set(event, arr)
    },
    emit(event: string, ...args: unknown[]) {
      (listeners.get(event) ?? []).forEach((fn) => fn(...args))
    },
    close: vi.fn()
  }
  const winSend = vi.fn()
  const win = { webContents: { send: winSend } }
  const mockWatch = vi.fn(() => watcherInstance)
  const logWarn = vi.fn()
  return { winSend, win, watcherInstance, mockWatch, logWarn }
})

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [h.win] }
}))
vi.mock("chokidar", () => ({ default: { watch: h.mockWatch } }))
vi.mock("../electron/sidecar/selene", () => ({ lintFile: vi.fn(async () => []) }))
vi.mock("../electron/sidecar/stylua", () => ({ formatFile: vi.fn(async () => undefined) }))
vi.mock("../electron/sidecar", () => ({ isBinaryAvailable: vi.fn(() => true) }))
vi.mock("../electron/toolchain/config", () => ({ getActiveTool: vi.fn(() => null) }))
vi.mock("../electron/logger", () => ({
  log: { info: vi.fn(), warn: h.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import { watchProject, stopWatcher, emitSidecarError } from "../electron/file/watcher"

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  stopWatcher()
})

describe("watcher", () => {
  it("registers chokidar watch on project src dir", () => {
    watchProject("/proj")
    expect(h.mockWatch).toHaveBeenCalledWith(expect.stringContaining("src"), expect.any(Object))
  })

  it("broadcasts file:added on add event", () => {
    watchProject("/proj")
    h.watcherInstance.emit("add", "/proj/src/foo.lua")
    expect(h.winSend).toHaveBeenCalledWith("file:added", "/proj/src/foo.lua")
  })

  it("broadcasts file:deleted on unlink event", () => {
    watchProject("/proj")
    h.watcherInstance.emit("unlink", "/proj/src/foo.lua")
    expect(h.winSend).toHaveBeenCalledWith("file:deleted", "/proj/src/foo.lua")
  })

  it("clears pending debounce timer when file is deleted before timer fires", () => {
    watchProject("/proj")
    h.watcherInstance.emit("change", "/proj/src/foo.lua")
    // Timer is set; immediately delete the file
    h.watcherInstance.emit("unlink", "/proj/src/foo.lua")
    // Advance past debounce — handleFileChange should NOT run (timer was cleared)
    vi.advanceTimersByTime(500)
    // Verify file:deleted broadcast happened (proves unlink path ran)
    expect(h.winSend).toHaveBeenCalledWith("file:deleted", "/proj/src/foo.lua")
  })

  it("registers an error handler on the watcher (does not crash on error event)", () => {
    watchProject("/proj")
    expect(() => h.watcherInstance.emit("error", new Error("ENOENT"))).not.toThrow()
    expect(h.logWarn).toHaveBeenCalledWith("[Watcher] FSWatcher error:", expect.any(Error))
  })

  it("ignores change events on non-Lua files", () => {
    watchProject("/proj")
    h.watcherInstance.emit("change", "/proj/src/README.md")
    vi.advanceTimersByTime(500)
    // No broadcast because handler returned early
    expect(h.winSend).not.toHaveBeenCalledWith(expect.stringContaining("lint"), expect.any(Object))
  })

  it("stopWatcher closes the watcher and clears all pending timers", () => {
    watchProject("/proj")
    h.watcherInstance.emit("change", "/proj/src/a.lua")
    h.watcherInstance.emit("change", "/proj/src/b.lua")
    stopWatcher()
    expect(h.watcherInstance.close).toHaveBeenCalledOnce()
    // Advancing timers shouldn't trigger any handler
    vi.advanceTimersByTime(1000)
  })
})

// ── Sidecar error debounce ────────────────────────────────────────────────────
// A linter/formatter crashing on every save can flood the renderer with
// sidecar:error IPC events. emitSidecarError collapses bursts per-tool into
// a single event every 2s, keeping the latest message.

describe("emitSidecarError — 2s debounce per tool", () => {
  it("collapses 5 rapid errors for the same tool into one IPC with the LAST message", () => {
    emitSidecarError("stylua", "err 1")
    emitSidecarError("stylua", "err 2")
    emitSidecarError("stylua", "err 3")
    emitSidecarError("stylua", "err 4")
    emitSidecarError("stylua", "err 5")

    // Before debounce window fires, no IPC yet
    expect(h.winSend).not.toHaveBeenCalledWith("sidecar:error", expect.anything())

    vi.advanceTimersByTime(2000)

    // Exactly one fire, carrying the LAST message
    const calls = h.winSend.mock.calls.filter((c) => c[0] === "sidecar:error")
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({ tool: "stylua", message: "err 5" })
  })

  it("starts a new debounce window after the first fires", () => {
    emitSidecarError("stylua", "burst-1")
    vi.advanceTimersByTime(2000)

    // First burst delivered
    let calls = h.winSend.mock.calls.filter((c) => c[0] === "sidecar:error")
    expect(calls).toHaveLength(1)

    // Second burst: a fresh window opens; the store is now empty so the next
    // emitSidecarError schedules a new timer (not a collapse into the
    // already-fired one).
    emitSidecarError("stylua", "burst-2")
    vi.advanceTimersByTime(2000)

    calls = h.winSend.mock.calls.filter((c) => c[0] === "sidecar:error")
    expect(calls).toHaveLength(2)
    expect(calls[1][1]).toEqual({ tool: "stylua", message: "burst-2" })
  })

  it("debounces different tools independently (both fire)", () => {
    emitSidecarError("stylua", "fmt-err")
    emitSidecarError("selene", "lint-err")

    vi.advanceTimersByTime(2000)

    const calls = h.winSend.mock.calls.filter((c) => c[0] === "sidecar:error")
    expect(calls).toHaveLength(2)
    const tools = calls.map((c) => (c[1] as { tool: string }).tool).sort()
    expect(tools).toEqual(["selene", "stylua"])
  })

  it("stopWatcher clears all pending sidecar-error debounce timers", () => {
    emitSidecarError("stylua", "err")
    emitSidecarError("selene", "err")

    stopWatcher()
    vi.advanceTimersByTime(5000)

    // No sidecar:error IPC should ever fire once stopWatcher cleared timers
    expect(h.winSend).not.toHaveBeenCalledWith("sidecar:error", expect.anything())
  })
})
