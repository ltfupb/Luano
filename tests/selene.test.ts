/**
 * tests/selene.test.ts — Direct unit tests for electron/sidecar/selene.ts
 *
 * Tests lintFile() by mocking spawnSidecar and controlling the fake process:
 *   - Empty output → empty diagnostics array
 *   - JSON diagnostic lines → parsed SelEneDiagnostic objects
 *   - Mixed valid/malformed JSON → malformed lines skipped
 *   - selene.toml discovery → correct cwd passed to spawnSidecar
 *   - Warning severity mapping
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventEmitter } from "events"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockExistsSync = vi.fn().mockReturnValue(false)
  const mockSpawnSidecar = vi.fn()
  return { mockExistsSync, mockSpawnSidecar }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs")
  return { ...actual, existsSync: h.mockExistsSync }
})

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

import { lintFile } from "../electron/sidecar/selene"

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fake sidecar process backed by an EventEmitter. */
function makeProc() {
  const emitter = Object.assign(new EventEmitter(), { kill: vi.fn(), killed: false })
  return { process: emitter as any, kill: vi.fn() }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  h.mockExistsSync.mockReturnValue(false)
})

describe("lintFile", () => {
  it("resolves empty array when sidecar exits with no output", async () => {
    const proc = makeProc()
    h.mockSpawnSidecar.mockReturnValueOnce(proc)

    const promise = lintFile("/project/test.luau")
    proc.process.emit("exit", 0)

    expect(await promise).toEqual([])
  })

  it("parses a JSON2 diagnostic line into a SelEneDiagnostic", async () => {
    let capturedOnData: ((d: string) => void) | undefined
    const proc = makeProc()
    h.mockSpawnSidecar.mockImplementationOnce((_, __, opts) => {
      capturedOnData = opts?.onData
      return proc
    })

    const diagJson = JSON.stringify({
      severity: "Error",
      message: "undefined variable 'x'",
      code: "undefined_variable",
      primary_label: { span: { start_line: 5, start_column: 3 } }
    })

    const promise = lintFile("/project/test.luau")
    capturedOnData?.(diagJson)
    proc.process.emit("exit", 1)

    const result = await promise
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe("error")
    expect(result[0].message).toBe("undefined variable 'x'")
    expect(result[0].code).toBe("undefined_variable")
    expect(result[0].line).toBe(5)
    expect(result[0].col).toBe(3)
    expect(result[0].file).toBe("/project/test.luau")
  })

  it("maps non-Error severity to 'warning'", async () => {
    let capturedOnData: ((d: string) => void) | undefined
    const proc = makeProc()
    h.mockSpawnSidecar.mockImplementationOnce((_, __, opts) => {
      capturedOnData = opts?.onData
      return proc
    })

    const diagJson = JSON.stringify({
      severity: "Warning",
      message: "unused variable",
      code: "unused_variable",
      primary_label: null
    })

    const promise = lintFile("/project/test.luau")
    capturedOnData?.(diagJson)
    proc.process.emit("exit", 0)

    const result = await promise
    expect(result[0].severity).toBe("warning")
    // primary_label null → fallback line/col = 1
    expect(result[0].line).toBe(1)
    expect(result[0].col).toBe(1)
  })

  it("skips malformed JSON lines and still returns valid diagnostics", async () => {
    let capturedOnData: ((d: string) => void) | undefined
    const proc = makeProc()
    h.mockSpawnSidecar.mockImplementationOnce((_, __, opts) => {
      capturedOnData = opts?.onData
      return proc
    })

    const validDiag = JSON.stringify({
      severity: "Warning",
      message: "ok",
      code: "ok",
      primary_label: null
    })

    const promise = lintFile("/project/test.luau")
    // First chunk: bad JSON + newline + valid JSON
    capturedOnData?.(`not valid json\n${validDiag}`)
    proc.process.emit("exit", 0)

    const result = await promise
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe("warning")
  })

  it("uses the selene.toml ancestor directory as cwd for spawnSidecar", async () => {
    // selene.toml is in /project, file is in /project/scripts/
    // path.join normalizes to backslashes on Windows, so match by normalizing slashes
    h.mockExistsSync.mockImplementation((p: string) =>
      p.replace(/\\/g, "/").endsWith("/project/selene.toml")
    )

    let capturedCwd: string | undefined
    const proc = makeProc()
    h.mockSpawnSidecar.mockImplementationOnce((_, __, opts) => {
      capturedCwd = opts?.cwd
      return proc
    })

    const promise = lintFile("/project/scripts/test.luau")
    proc.process.emit("exit", 0)
    await promise

    // Normalize path separators for cross-platform comparison
    expect(capturedCwd?.replace(/\\/g, "/")).toBe("/project")
  })
})
