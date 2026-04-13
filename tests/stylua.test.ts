/**
 * tests/stylua.test.ts — Direct unit tests for electron/sidecar/stylua.ts
 *
 * Tests formatFile() and formatContent() by mocking spawnSidecar and
 * controlling the fake process exit code and stdout data.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventEmitter } from "events"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockSpawnSidecar = vi.fn()
  return { mockSpawnSidecar }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("../electron/sidecar/index", () => ({
  spawnSidecar: h.mockSpawnSidecar,
  isBinaryAvailable: vi.fn().mockReturnValue(true),
  validateBinary: vi.fn()
}))

// ── Import under test ─────────────────────────────────────────────────────────

import { formatFile, formatContent } from "../electron/sidecar/stylua"

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fake sidecar process with a writable stdin mock. */
function makeProc() {
  const emitter = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    killed: false,
    stdin: { write: vi.fn(), end: vi.fn() }
  })
  return { process: emitter as any, kill: vi.fn() }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe("formatFile", () => {
  it("resolves true when sidecar exits code 0", async () => {
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const promise = formatFile("/project/test.luau")
    proc.process.emit("exit", 0)

    expect(await promise).toBe(true)
  })

  it("resolves false when sidecar exits non-zero", async () => {
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const promise = formatFile("/project/test.luau")
    proc.process.emit("exit", 1)

    expect(await promise).toBe(false)
  })

  it("passes the file path as the sole argument to spawnSidecar", async () => {
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const promise = formatFile("/project/test.luau")
    proc.process.emit("exit", 0)
    await promise

    expect(h.mockSpawnSidecar).toHaveBeenCalledWith("stylua", ["/project/test.luau"])
  })
})

describe("formatContent", () => {
  it("returns formatted output when sidecar exits code 0", async () => {
    let capturedOnData: ((d: string) => void) | undefined
    const proc = makeProc()
    h.mockSpawnSidecar.mockImplementationOnce((_, __, opts) => {
      capturedOnData = opts?.onData
      return proc
    })

    const promise = formatContent("local x=1\n")
    capturedOnData?.("local x = 1\n")
    proc.process.emit("exit", 0)

    expect(await promise).toBe("local x = 1\n")
  })

  it("returns original content when sidecar exits non-zero", async () => {
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const original = "local x=1\n"
    const promise = formatContent(original)
    proc.process.emit("exit", 1)

    expect(await promise).toBe(original)
  })

  it("writes content to stdin and closes it", async () => {
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const promise = formatContent("local x = 1\n")
    proc.process.emit("exit", 0)
    await promise

    expect(proc.process.stdin.write).toHaveBeenCalledWith("local x = 1\n")
    expect(proc.process.stdin.end).toHaveBeenCalled()
  })

  it("passes '-' as the path argument (stdin mode) to spawnSidecar", async () => {
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const promise = formatContent("return {}")
    proc.process.emit("exit", 0)
    await promise

    expect(h.mockSpawnSidecar).toHaveBeenCalledWith("stylua", ["-"], expect.any(Object))
  })
})
