/**
 * tests/lsp-manager.test.ts — Unit tests for electron/lsp/manager.ts
 *
 * Tests LspManager behaviour:
 *   - start() spawns luau-lsp and starts bridge
 *   - clean exit (code 0) → no retry
 *   - non-zero exit → exponential-backoff auto-retry
 *   - MAX_AUTO_RETRIES exceeded → gives up, sends error IPC
 *   - stop() kills proc and stops bridge
 *   - stale exit handler is a no-op after stop+start
 *   - spawn failure → sends error IPC, propagates throw
 *   - after successful retry, sends sidecar:lsp-ready IPC
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventEmitter } from "events"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const winSend = vi.fn()
  const win = { webContents: { send: winSend } }
  const mockSpawnSidecar = vi.fn()
  const mockBridgeStart = vi.fn().mockResolvedValue(undefined)
  const mockBridgeStop = vi.fn()

  // LspBridge mock class
  const MockLspBridge = vi.fn().mockImplementation(() => ({
    start: mockBridgeStart,
    stop: mockBridgeStop
  }))

  return { winSend, win, mockSpawnSidecar, mockBridgeStart, mockBridgeStop, MockLspBridge }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [h.win] }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("../electron/sidecar/index", () => ({
  spawnSidecar: h.mockSpawnSidecar,
  getResourcePath: vi.fn().mockReturnValue("/resources/type-defs/globalTypes.d.luau"),
  isBinaryAvailable: vi.fn().mockReturnValue(true),
  validateBinary: vi.fn()
}))

vi.mock("../electron/lsp/bridge", () => ({
  LspBridge: h.MockLspBridge
}))

vi.mock("../electron/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// ── Import under test ─────────────────────────────────────────────────────────

import { LspManager } from "../electron/lsp/manager"

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROJECT = "/project"

function makeProc() {
  const emitter = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    killed: false,
    pid: 9999,
    stdin: { on: vi.fn() },
    stdout: null
  })
  return { process: emitter as any, kill: vi.fn() }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  h.mockBridgeStart.mockResolvedValue(undefined)
})

describe("LspManager.start()", () => {
  it("spawns luau-lsp and starts LspBridge", async () => {
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const mgr = new LspManager()
    await mgr.start(PROJECT)

    expect(h.mockSpawnSidecar).toHaveBeenCalledWith(
      "luau-lsp",
      expect.arrayContaining(["lsp"]),
      expect.objectContaining({ cwd: PROJECT })
    )
    expect(h.MockLspBridge).toHaveBeenCalled()
    expect(h.mockBridgeStart).toHaveBeenCalled()
  })

  it("throws and sends error IPC when spawnSidecar throws", async () => {
    h.mockSpawnSidecar.mockImplementationOnce(() => { throw new Error("binary not found") })

    const mgr = new LspManager()
    await expect(mgr.start(PROJECT)).rejects.toThrow("binary not found")

    expect(h.winSend).toHaveBeenCalledWith(
      "sidecar:error",
      expect.objectContaining({ tool: "luau-lsp" })
    )
  })

  it("throws and sends error IPC when bridge.start() rejects", async () => {
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)
    h.mockBridgeStart.mockRejectedValueOnce(new Error("port in use"))

    const mgr = new LspManager()
    await expect(mgr.start(PROJECT)).rejects.toThrow("port in use")

    expect(h.winSend).toHaveBeenCalledWith(
      "sidecar:error",
      expect.objectContaining({ tool: "luau-lsp" })
    )
  })
})

describe("LspManager exit handling", () => {
  it("does not retry when process exits with code 0", async () => {
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const mgr = new LspManager()
    await mgr.start(PROJECT)
    proc.process.emit("exit", 0)

    expect(h.mockSpawnSidecar).toHaveBeenCalledTimes(1)
    expect(h.winSend).toHaveBeenCalledWith(
      "sidecar:error",
      expect.objectContaining({ tool: "luau-lsp" })
    )
  })

  it("auto-retries on non-zero exit with backoff delay", async () => {
    vi.useFakeTimers()
    try {
      const proc1 = makeProc()
      const proc2 = makeProc()
      h.mockSpawnSidecar
        .mockReturnValueOnce(proc1)
        .mockReturnValueOnce(proc2)

      const mgr = new LspManager()
      await mgr.start(PROJECT)

      proc1.process.emit("exit", 1)
      // BASE_DELAY_MS = 2000, retryCount=1 → delay = 2000 * 1.5^0 = 2000ms
      vi.advanceTimersByTime(2001)
      await Promise.resolve() // flush microtasks

      expect(h.mockSpawnSidecar).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("gives up after MAX_AUTO_RETRIES (5) and sends error IPC", async () => {
    vi.useFakeTimers()
    try {
      // We'll check that after 5 retries, one more exit → no more spawns
      const procs = Array.from({ length: 7 }, () => makeProc())
      let spawnCall = 0
      h.mockSpawnSidecar.mockImplementation(() => procs[spawnCall++])

      const mgr = new LspManager()
      await mgr.start(PROJECT)

      // Trigger 5 retries + the final give-up
      for (let i = 0; i < 5; i++) {
        procs[i].process.emit("exit", 1)
        vi.advanceTimersByTime(40_000) // advance past MAX_DELAY_MS
        await Promise.resolve()
      }

      // 6th exit = retry count exhausted
      procs[5].process.emit("exit", 1)

      // 6 total spawns: 1 initial + 5 retries
      expect(h.mockSpawnSidecar).toHaveBeenCalledTimes(6)
      // Error IPC must be sent when retries are exhausted
      expect(h.winSend).toHaveBeenCalledWith(
        "sidecar:error",
        expect.objectContaining({ tool: "luau-lsp" })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("sends sidecar:lsp-ready after a successful retry", async () => {
    vi.useFakeTimers()
    try {
      const proc1 = makeProc()
      const proc2 = makeProc()
      h.mockSpawnSidecar
        .mockReturnValueOnce(proc1)
        .mockReturnValueOnce(proc2)

      const mgr = new LspManager()
      await mgr.start(PROJECT)
      proc1.process.emit("exit", 1)

      vi.advanceTimersByTime(2001)
      await Promise.resolve()

      expect(h.winSend).toHaveBeenCalledWith(
        "sidecar:lsp-ready",
        expect.objectContaining({ port: 6008 })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("ignores stale exit after stop+start (identity guard)", async () => {
    const proc1 = makeProc()
    const proc2 = makeProc()
    h.mockSpawnSidecar
      .mockReturnValueOnce(proc1)
      .mockReturnValueOnce(proc2)

    const mgr = new LspManager()
    await mgr.start(PROJECT)

    // Stop clears this.proc; then start assigns a new proc
    await mgr.stop()
    await mgr.start(PROJECT)

    h.winSend.mockClear()

    // Old proc1 fires exit AFTER the new start — should be ignored
    proc1.process.emit("exit", 1)

    // No retry triggered, no error IPC
    expect(h.winSend).not.toHaveBeenCalled()
    expect(h.mockSpawnSidecar).toHaveBeenCalledTimes(2)
  })
})

describe("LspManager.stop()", () => {
  it("stops bridge and kills proc", async () => {
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const mgr = new LspManager()
    await mgr.start(PROJECT)
    await mgr.stop()

    expect(h.mockBridgeStop).toHaveBeenCalled()
    expect(proc.process.kill).toHaveBeenCalled()
  })

  it("is safe to call when already stopped", async () => {
    const mgr = new LspManager()
    await expect(mgr.stop()).resolves.not.toThrow()
  })
})
