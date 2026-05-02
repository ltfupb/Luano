/**
 * tests/oneshot.test.ts — Unit tests for electron/sidecar/oneshot.ts
 *
 * Covers the shared one-shot CLI helper used by runWally and runPesde:
 *   - Happy path: resolves with exitCode + merged stdout+stderr
 *   - Exit code propagation (non-zero, null → 1)
 *   - Output cap (1 MB) with truncation marker
 *   - Timeout kills the sidecar and rejects with TimeoutError
 *   - runWally / runPesde wrappers spawn the right binary
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "events"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(true),
  mockSpawn: vi.fn()
}))

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs")
  return { ...actual, existsSync: h.mockExistsSync }
})

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process")
  return { ...actual, spawn: h.mockSpawn }
})

import { runOneShotCli, CommandTimeoutError, RUN_TIMEOUT_MS } from "../electron/sidecar/oneshot"
import { runWally } from "../electron/sidecar/wally"
import { runPesde } from "../electron/sidecar/pesde"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakeProc() {
  const emitter = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    killed: false,
    pid: 9999,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdio: []
  })
  return emitter as unknown as ReturnType<typeof h.mockSpawn>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockExistsSync.mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

// ── runOneShotCli — happy path & exit codes ───────────────────────────────────

describe("runOneShotCli — happy path", () => {
  it("resolves with exitCode 0 and merged stdout+stderr", async () => {
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const promise = runOneShotCli("wally", ["install"], "/project")

    fakeProc.stdout.emit("data", Buffer.from("installing..."))
    fakeProc.stderr.emit("data", Buffer.from("warn: x"))
    fakeProc.emit("exit", 0)

    const result = await promise
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe("installing...warn: x")
  })

  it("propagates non-zero exit codes", async () => {
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const promise = runOneShotCli("pesde", ["install"], "/project")
    fakeProc.emit("exit", 7)

    const result = await promise
    expect(result.exitCode).toBe(7)
  })

  it("treats null exit code (process killed) as 1", async () => {
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const promise = runOneShotCli("wally", [], "/project")
    fakeProc.emit("exit", null)

    const result = await promise
    expect(result.exitCode).toBe(1)
  })

  it("forwards binary + args + cwd to spawn", async () => {
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const promise = runOneShotCli("wally", ["add", "Roblox/roact"], "/projects/foo")
    fakeProc.emit("exit", 0)
    await promise

    expect(h.mockSpawn).toHaveBeenCalledTimes(1)
    const [binPath, args, opts] = h.mockSpawn.mock.calls[0]
    expect(String(binPath)).toContain("wally")
    expect(args).toEqual(["add", "Roblox/roact"])
    expect(opts).toMatchObject({ cwd: "/projects/foo" })
  })
})

// ── runOneShotCli — output cap ───────────────────────────────────────────────

describe("runOneShotCli — output cap", () => {
  it("truncates output beyond 1 MB and appends marker", async () => {
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const promise = runOneShotCli("wally", [], "/project")

    // Write 1.5 MB total — first 1 MB is kept, rest truncated.
    const chunk = "x".repeat(512 * 1024)
    fakeProc.stdout.emit("data", chunk) // 512 KB
    fakeProc.stdout.emit("data", chunk) // 1024 KB total — at cap
    fakeProc.stdout.emit("data", chunk) // would push to 1536 KB — truncated
    fakeProc.emit("exit", 0)

    const result = await promise
    expect(result.output.length).toBeLessThan(1.1 * 1024 * 1024)
    expect(result.output).toMatch(/output truncated/)
  })
})

// ── runOneShotCli — timeout ───────────────────────────────────────────────────

describe("runOneShotCli — timeout", () => {
  it("rejects with CommandTimeoutError and kills the sidecar after RUN_TIMEOUT_MS", async () => {
    vi.useFakeTimers()
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const promise = runOneShotCli("wally", ["install"], "/project")
    // Attach the rejection handler BEFORE advancing timers so the rejection
    // is not flagged as unhandled when the fake timer fires synchronously.
    const settled = expect(promise).rejects.toBeInstanceOf(CommandTimeoutError)

    // Advance past the timeout WITHOUT emitting "exit".
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS + 1)

    await settled
    expect(fakeProc.kill).toHaveBeenCalled()
  })

  it("does not fire timeout when the process exits in time", async () => {
    vi.useFakeTimers()
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const promise = runOneShotCli("pesde", [], "/project")
    fakeProc.emit("exit", 0)

    // Advance the clock — should be a no-op since the timeout was cleared.
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS + 1000)

    const result = await promise
    expect(result.exitCode).toBe(0)
    expect(fakeProc.kill).not.toHaveBeenCalled()
  })
})

// ── Wally / pesde wrappers ────────────────────────────────────────────────────

describe("runWally / runPesde wrappers", () => {
  it("runWally spawns the wally binary", async () => {
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const promise = runWally(["install"], "/project")
    fakeProc.emit("exit", 0)
    await promise

    const [binPath] = h.mockSpawn.mock.calls[0]
    expect(String(binPath)).toContain("wally")
  })

  it("runPesde spawns the pesde binary", async () => {
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const promise = runPesde(["install"], "/project")
    fakeProc.emit("exit", 0)
    await promise

    const [binPath] = h.mockSpawn.mock.calls[0]
    expect(String(binPath)).toContain("pesde")
  })
})
