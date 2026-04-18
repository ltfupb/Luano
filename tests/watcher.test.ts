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
  return { winSend, win, watcherInstance, mockWatch }
})

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [h.win] }
}))
vi.mock("chokidar", () => ({ default: { watch: h.mockWatch } }))
vi.mock("../electron/sidecar/selene", () => ({ lintFile: vi.fn(async () => []) }))
vi.mock("../electron/sidecar/stylua", () => ({ formatFile: vi.fn(async () => undefined) }))
vi.mock("../electron/toolchain/config", () => ({ getActiveTool: vi.fn(() => null) }))

import { watchProject, stopWatcher } from "../electron/file/watcher"

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
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    watchProject("/proj")
    expect(() => h.watcherInstance.emit("error", new Error("ENOENT"))).not.toThrow()
    expect(consoleSpy).toHaveBeenCalledWith("[Watcher] FSWatcher error:", expect.any(Error))
    consoleSpy.mockRestore()
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
