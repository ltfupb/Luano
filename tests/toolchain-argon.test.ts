/**
 * tests/toolchain-argon.test.ts — Unit tests for electron/toolchain/argon-manager.ts
 *
 * Tests ArgonManager behaviour (mirrors rojo-manager.test.ts pattern):
 *   - serve() guard: no default.project.json → status stays stopped
 *   - serve() happy path: spawns process, parses port from "Serving on: ... :PORT"
 *   - Auto-retry on non-zero exit (up to MAX_AUTO_RETRIES = 2)
 *   - No retry on clean exit (code 0) or after stop()
 *   - Stale exit ignored after stop+serve cycle
 *   - stop() kills proc, resets status
 *   - Error keyword detection in output
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventEmitter } from "events"

// Retry delay used in ArgonManager (2s backoff) + buffer for timer advancement
const RETRY_DELAY_MS = 2100

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const winSend = vi.fn()
  const win = { webContents: { send: winSend } }
  const mockSpawnSidecar = vi.fn()
  const mockExistsSync = vi.fn().mockReturnValue(false)
  const mockSpawnSync = vi.fn().mockReturnValue({ stdout: "", stderr: "", status: 0 })
  const mockIsBinaryAvailable = vi.fn().mockReturnValue(false)

  return { winSend, win, mockSpawnSidecar, mockExistsSync, mockSpawnSync, mockIsBinaryAvailable }
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

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process")
  return { ...actual, spawnSync: h.mockSpawnSync }
})

vi.mock("../electron/sidecar/index", () => ({
  spawnSidecar: h.mockSpawnSidecar,
  isBinaryAvailable: h.mockIsBinaryAvailable,
  getBinaryPath: vi.fn().mockReturnValue("/usr/bin/argon"),
  validateBinary: vi.fn()
}))

vi.mock("../electron/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock("../electron/file/project", () => ({
  migrateProjectForArgon: vi.fn().mockReturnValue(false)
}))

// ── Import under test ─────────────────────────────────────────────────────────

import { ArgonManager } from "../electron/toolchain/argon-manager"

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROJECT = "/project/my-game"

function makeProc() {
  const emitter = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    killed: false,
    pid: 1234
  })
  return { process: emitter as any, kill: vi.fn() }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  h.mockExistsSync.mockReturnValue(false)
  h.mockIsBinaryAvailable.mockReturnValue(false)
})

// ── serve() ───────────────────────────────────────────────────────────────────

describe("ArgonManager.serve()", () => {
  it("sets status to stopped when default.project.json is missing", () => {
    const mgr = new ArgonManager()
    mgr.serve(PROJECT)

    expect(mgr.getStatus()).toBe("stopped")
    expect(h.winSend).toHaveBeenCalledWith("sync:status-changed", "stopped", null, null)
  })

  it("transitions to starting then running after port line on stderr", () => {
    h.mockExistsSync.mockReturnValue(true)
    let capturedOnError: ((d: string) => void) | undefined
    const proc = makeProc()
    h.mockSpawnSidecar.mockImplementationOnce((_b: string, _a: string[], opts: { onError?: (d: string) => void }) => {
      capturedOnError = opts?.onError
      return proc
    })

    const mgr = new ArgonManager()
    mgr.serve(PROJECT)

    expect(mgr.getStatus()).toBe("starting")

    capturedOnError?.("Serving on: http://127.0.0.1:34872")

    expect(mgr.getStatus()).toBe("running")
    expect(mgr.getPort()).toBe(34872)
    expect(h.winSend).toHaveBeenCalledWith("sync:status-changed", "running", 34872, null)
  })

  it("parses port from 'listening on ... :PORT' format", () => {
    h.mockExistsSync.mockReturnValue(true)
    let capturedOnError: ((d: string) => void) | undefined
    const proc = makeProc()
    h.mockSpawnSidecar.mockImplementationOnce((_b: string, _a: string[], opts: { onError?: (d: string) => void }) => {
      capturedOnError = opts?.onError
      return proc
    })

    const mgr = new ArgonManager()
    mgr.serve(PROJECT)
    capturedOnError?.("listening on 127.0.0.1:8080")

    expect(mgr.getPort()).toBe(8080)
  })

  it("sets status to error when spawnSidecar throws", () => {
    h.mockExistsSync.mockReturnValue(true)
    h.mockSpawnSidecar.mockImplementationOnce(() => { throw new Error("binary missing") })

    const mgr = new ArgonManager()
    mgr.serve(PROJECT)

    expect(mgr.getStatus()).toBe("error")
  })

  it("records error keyword from output", () => {
    h.mockExistsSync.mockReturnValue(true)
    let capturedOnError: ((d: string) => void) | undefined
    const proc = makeProc()
    h.mockSpawnSidecar.mockImplementationOnce((_b: string, _a: string[], opts: { onError?: (d: string) => void }) => {
      capturedOnError = opts?.onError
      return proc
    })

    const mgr = new ArgonManager()
    mgr.serve(PROJECT)
    capturedOnError?.("ERROR: port already in use")

    expect(mgr.getLastError()).toBe("ERROR: port already in use")
  })
})

// ── exit handling ─────────────────────────────────────────────────────────────

describe("ArgonManager exit handling", () => {
  it("sets status to stopped on clean exit (code 0)", () => {
    h.mockExistsSync.mockReturnValue(true)
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const mgr = new ArgonManager()
    mgr.serve(PROJECT)
    proc.process.emit("exit", 0, null)

    expect(mgr.getStatus()).toBe("stopped")
  })

  it("auto-retries on non-zero exit within budget", async () => {
    vi.useFakeTimers()
    try {
      h.mockExistsSync.mockReturnValue(true)
      const proc1 = makeProc()
      const proc2 = makeProc()
      h.mockSpawnSidecar
        .mockReturnValueOnce(proc1)
        .mockReturnValueOnce(proc2)

      const mgr = new ArgonManager()
      mgr.serve(PROJECT)
      proc1.process.emit("exit", 1, null)

      vi.advanceTimersByTime(RETRY_DELAY_MS)

      expect(h.mockSpawnSidecar).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops retrying after MAX_AUTO_RETRIES (2) attempts", async () => {
    vi.useFakeTimers()
    try {
      h.mockExistsSync.mockReturnValue(true)
      const procs = [makeProc(), makeProc(), makeProc()]
      procs.forEach((p) => h.mockSpawnSidecar.mockReturnValueOnce(p))

      const mgr = new ArgonManager()
      mgr.serve(PROJECT)
      procs[0].process.emit("exit", 1, null)
      vi.advanceTimersByTime(RETRY_DELAY_MS)

      procs[1].process.emit("exit", 1, null)
      vi.advanceTimersByTime(RETRY_DELAY_MS)

      procs[2].process.emit("exit", 1, null)
      vi.advanceTimersByTime(RETRY_DELAY_MS)

      // 1 initial + 2 retries = 3 total (no 4th)
      expect(h.mockSpawnSidecar).toHaveBeenCalledTimes(3)
      expect(mgr.getStatus()).toBe("error")
    } finally {
      vi.useRealTimers()
    }
  })

  it("stale exit from old proc is ignored after stop+serve", () => {
    h.mockExistsSync.mockReturnValue(true)
    const proc1 = makeProc()
    const proc2 = makeProc()
    h.mockSpawnSidecar
      .mockReturnValueOnce(proc1)
      .mockReturnValueOnce(proc2)

    const mgr = new ArgonManager()
    mgr.serve(PROJECT)
    mgr.stop()
    mgr.serve(PROJECT)

    proc1.process.emit("exit", 1, null)

    // Only 2 spawns total; the stale exit must not trigger a 3rd
    expect(h.mockSpawnSidecar).toHaveBeenCalledTimes(2)
    expect(mgr.getStatus()).toBe("starting")
  })

  it("exit after stop() does not trigger retry", () => {
    h.mockExistsSync.mockReturnValue(true)
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const mgr = new ArgonManager()
    mgr.serve(PROJECT)
    mgr.stop()
    proc.process.emit("exit", 1, null)

    expect(h.mockSpawnSidecar).toHaveBeenCalledTimes(1)
  })
})

// ── stop() ────────────────────────────────────────────────────────────────────

describe("ArgonManager.stop()", () => {
  it("kills proc and sets status to stopped", () => {
    h.mockExistsSync.mockReturnValue(true)
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const mgr = new ArgonManager()
    mgr.serve(PROJECT)
    mgr.stop()

    expect(proc.process.kill).toHaveBeenCalled()
    expect(mgr.getStatus()).toBe("stopped")
    expect(h.winSend).toHaveBeenCalledWith("sync:status-changed", "stopped", null, null)
  })

  it("attempts argon stop --all cleanup when binary available", () => {
    h.mockExistsSync.mockReturnValue(true)
    h.mockIsBinaryAvailable.mockReturnValue(true)
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const mgr = new ArgonManager()
    mgr.serve(PROJECT)
    mgr.stop()

    expect(h.mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["stop", "--all", "-y"]),
      expect.anything()
    )
  })

  it("skips stop --all when argon binary not available", () => {
    h.mockExistsSync.mockReturnValue(true)
    h.mockIsBinaryAvailable.mockReturnValue(false)
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const mgr = new ArgonManager()
    mgr.serve(PROJECT)
    mgr.stop()

    expect(h.mockSpawnSync).not.toHaveBeenCalled()
  })
})
