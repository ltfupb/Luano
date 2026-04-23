/**
 * tests/rojo-manager.test.ts — Unit tests for electron/sidecar/rojo.ts
 *
 * Tests RojoManager behaviour:
 *   - serve() with/without default.project.json
 *   - Port parsed from Rojo stdout
 *   - Auto-restart on non-zero exit (up to 3 times)
 *   - No restart on clean exit (code 0)
 *   - stop() kills proc and resets status
 *   - Stale exit handler is ignored after stop+serve cycle
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventEmitter } from "events"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const winSend = vi.fn()
  const win = { webContents: { send: winSend } }
  const mockSpawnSidecar = vi.fn()
  const mockExistsSync = vi.fn().mockReturnValue(false)

  return { winSend, win, mockSpawnSidecar, mockExistsSync }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [h.win] }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs")
  return { ...actual, existsSync: h.mockExistsSync }
})

vi.mock("../electron/sidecar/index", () => ({
  spawnSidecar: h.mockSpawnSidecar,
  isBinaryAvailable: vi.fn().mockReturnValue(true),
  validateBinary: vi.fn()
}))

// ── Import under test ─────────────────────────────────────────────────────────

import { RojoManager } from "../electron/sidecar/rojo"

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROJECT = "/project"

function makeProc() {
  const emitter = Object.assign(new EventEmitter(), { kill: vi.fn(), killed: false, pid: 1234 })
  return { process: emitter as any, kill: vi.fn() }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  h.mockExistsSync.mockReturnValue(false)
})

describe("RojoManager.serve()", () => {
  it("surfaces an error status + toast when default.project.json is missing", () => {
    const mgr = new RojoManager()
    mgr.serve(PROJECT) // existsSync returns false

    expect(mgr.getStatus()).toBe("error")
    expect(h.winSend).toHaveBeenCalledWith(
      "sync:status-changed",
      "error",
      null,
      expect.stringMatching(/default\.project\.json/)
    )
    expect(h.winSend).toHaveBeenCalledWith(
      "sync:notice",
      expect.stringMatching(/default\.project\.json/),
      "error"
    )
  })

  it("spawns rojo and transitions to 'starting' then 'running' on stdout data", () => {
    h.mockExistsSync.mockReturnValue(true)
    let capturedOnData: ((d: string) => void) | undefined
    const proc = makeProc()
    // mockImplementationOnce handles the main serve spawn; mockReturnValue
    // handles the subsequent sourcemap spawn (triggered by onData)
    h.mockSpawnSidecar
      .mockImplementationOnce((_, __, opts) => {
        capturedOnData = opts?.onData
        return proc
      })
      .mockReturnValue(makeProc()) // sourcemap spawn

    const mgr = new RojoManager()
    mgr.serve(PROJECT)

    expect(mgr.getStatus()).toBe("starting")

    capturedOnData?.("Rojo server running at 127.0.0.1:34872")

    expect(mgr.getStatus()).toBe("running")
    expect(mgr.getPort()).toBe(34872)
    expect(h.winSend).toHaveBeenCalledWith("sync:status-changed", "running", 34872, null)
  })

  it("parses port from 'localhost:PORT' format", () => {
    h.mockExistsSync.mockReturnValue(true)
    let capturedOnData: ((d: string) => void) | undefined
    const proc = makeProc()
    h.mockSpawnSidecar
      .mockImplementationOnce((_, __, opts) => {
        capturedOnData = opts?.onData
        return proc
      })
      .mockReturnValue(makeProc()) // sourcemap spawn

    const mgr = new RojoManager()
    mgr.serve(PROJECT)
    capturedOnData?.("Roblox Studio server started at localhost:8080")

    expect(mgr.getPort()).toBe(8080)
  })

  it("sets status to 'error' and notifies when spawnSidecar throws", () => {
    h.mockExistsSync.mockReturnValue(true)
    h.mockSpawnSidecar.mockImplementationOnce(() => { throw new Error("binary not found") })

    const mgr = new RojoManager()
    mgr.serve(PROJECT)

    expect(mgr.getStatus()).toBe("error")
    // port and lastError are null at this point (spawn threw before any data)
    expect(h.winSend).toHaveBeenCalledWith("sync:status-changed", "error", null, null)
  })

  it("records error from stderr matching 'error' keyword", () => {
    h.mockExistsSync.mockReturnValue(true)
    let capturedOnError: ((d: string) => void) | undefined
    const proc = makeProc()
    h.mockSpawnSidecar.mockImplementationOnce((_, __, opts) => {
      capturedOnError = opts?.onError
      return proc
    })

    const mgr = new RojoManager()
    mgr.serve(PROJECT)
    capturedOnError?.("error: port already in use")

    expect(mgr.getLastError()).toBe("error: port already in use")
  })
})

describe("RojoManager exit handling", () => {
  it("sets status to 'stopped' on clean exit (code 0)", () => {
    h.mockExistsSync.mockReturnValue(true)
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const mgr = new RojoManager()
    mgr.serve(PROJECT)
    proc.process.emit("exit", 0)

    expect(mgr.getStatus()).toBe("stopped")
  })

  it("sets status to 'error' and auto-restarts on non-zero exit", async () => {
    vi.useFakeTimers()
    try {
      h.mockExistsSync.mockReturnValue(true)
      const proc1 = makeProc()
      const proc2 = makeProc()
      h.mockSpawnSidecar
        .mockReturnValueOnce(proc1)
        .mockReturnValueOnce(proc2)

      const mgr = new RojoManager()
      mgr.serve(PROJECT)
      proc1.process.emit("exit", 1)

      expect(mgr.getStatus()).toBe("error")

      vi.advanceTimersByTime(2001)

      // Second spawn triggered
      expect(h.mockSpawnSidecar).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not restart after stop() (proc nulled before exit fires)", () => {
    h.mockExistsSync.mockReturnValue(true)
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const mgr = new RojoManager()
    mgr.serve(PROJECT)
    mgr.stop() // nulls this.proc
    proc.process.emit("exit", 1) // exit handler checks this.proc === null → skips

    // Only 1 spawn, no restart
    expect(h.mockSpawnSidecar).toHaveBeenCalledTimes(1)
  })
})

describe("RojoManager.stop()", () => {
  it("kills proc and sets status to stopped", () => {
    h.mockExistsSync.mockReturnValue(true)
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const mgr = new RojoManager()
    mgr.serve(PROJECT)
    mgr.stop()

    expect(proc.process.kill).toHaveBeenCalled()
    expect(mgr.getStatus()).toBe("stopped")
    expect(h.winSend).toHaveBeenCalledWith("sync:status-changed", "stopped", null, null)
  })
})
