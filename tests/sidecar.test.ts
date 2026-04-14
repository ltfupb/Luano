/**
 * tests/sidecar.test.ts — Unit tests for electron/sidecar/index.ts
 *
 * Tests path helpers, binary validation, and spawnSidecar:
 *   - getBinaryPath: correct extension per platform
 *   - isBinaryAvailable / validateBinary: existence checks
 *   - spawnSidecar: throws on missing binary, routes stdout/stderr through
 *     the codepage-aware decoder, kill() wraps proc.kill()
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventEmitter } from "events"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockExistsSync = vi.fn().mockReturnValue(false)
  const mockSpawn = vi.fn()
  return { mockExistsSync, mockSpawn }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

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

// ── Import under test ─────────────────────────────────────────────────────────

import {
  getBinaryPath,
  getUserBinDir,
  isBinaryAvailable,
  validateBinary,
  spawnSidecar
} from "../electron/sidecar/index"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakeProc(overrides: Partial<{ killed: boolean }> = {}) {
  const emitter = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    killed: overrides.killed ?? false,
    pid: 9999,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdio: []
  })
  return emitter as ReturnType<typeof h.mockSpawn>
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  h.mockExistsSync.mockReturnValue(false)
})

// ── getBinaryPath ─────────────────────────────────────────────────────────────

describe("getBinaryPath", () => {
  it("includes userData/binaries base dir", () => {
    const p = getBinaryPath("selene")
    expect(p).toContain("binaries")
    expect(p).toContain("selene")
  })

  it("getUserBinDir returns a path inside userData", () => {
    expect(getUserBinDir()).toContain("binaries")
  })
})

// ── isBinaryAvailable ─────────────────────────────────────────────────────────

describe("isBinaryAvailable", () => {
  it("returns false when binary file does not exist", () => {
    h.mockExistsSync.mockReturnValue(false)
    expect(isBinaryAvailable("rojo")).toBe(false)
  })

  it("returns true when binary file exists", () => {
    h.mockExistsSync.mockReturnValue(true)
    expect(isBinaryAvailable("rojo")).toBe(true)
  })
})

// ── validateBinary ────────────────────────────────────────────────────────────

describe("validateBinary", () => {
  it("throws with descriptive message when binary is missing", () => {
    h.mockExistsSync.mockReturnValue(false)
    expect(() => validateBinary("luau-lsp")).toThrow(/Binary not found: luau-lsp/)
  })

  it("includes the binary path in the error", () => {
    h.mockExistsSync.mockReturnValue(false)
    expect(() => validateBinary("selene")).toThrow(/Path:/)
  })

  it("does not throw when binary exists", () => {
    h.mockExistsSync.mockReturnValue(true)
    expect(() => validateBinary("selene")).not.toThrow()
  })
})

// ── spawnSidecar ──────────────────────────────────────────────────────────────

describe("spawnSidecar", () => {
  it("throws when binary is missing (validateBinary check)", () => {
    h.mockExistsSync.mockReturnValue(false)
    expect(() => spawnSidecar("selene", ["--version"])).toThrow(/Binary not found/)
  })

  it("spawns the process and returns a SidecarProcess", () => {
    h.mockExistsSync.mockReturnValue(true)
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const result = spawnSidecar("selene", ["--version"])

    expect(h.mockSpawn).toHaveBeenCalledTimes(1)
    expect(result).toHaveProperty("process")
    expect(result).toHaveProperty("kill")
  })

  it("routes stdout data through onData callback", () => {
    h.mockExistsSync.mockReturnValue(true)
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const onData = vi.fn()
    spawnSidecar("selene", [], { onData })

    fakeProc.stdout.emit("data", Buffer.from("lint result"))
    expect(onData).toHaveBeenCalledWith("lint result")
  })

  it("routes stderr data through onError callback", () => {
    h.mockExistsSync.mockReturnValue(true)
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const onError = vi.fn()
    spawnSidecar("selene", [], { onError })

    fakeProc.stderr.emit("data", Buffer.from("error output"))
    expect(onError).toHaveBeenCalledWith("error output")
  })

  it("does not throw when no onData/onError provided", () => {
    h.mockExistsSync.mockReturnValue(true)
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    const sidecar = spawnSidecar("selene", [])
    expect(() => {
      fakeProc.stdout.emit("data", Buffer.from("data"))
      fakeProc.stderr.emit("data", Buffer.from("err"))
    }).not.toThrow()
  })

  it("kill() calls proc.kill() when not already killed", () => {
    h.mockExistsSync.mockReturnValue(true)
    const fakeProc = makeFakeProc({ killed: false })
    h.mockSpawn.mockReturnValue(fakeProc)

    const { kill } = spawnSidecar("selene", [])
    kill()

    expect(fakeProc.kill).toHaveBeenCalled()
  })

  it("kill() is safe to call when proc is already killed", () => {
    h.mockExistsSync.mockReturnValue(true)
    const fakeProc = makeFakeProc({ killed: true })
    h.mockSpawn.mockReturnValue(fakeProc)

    const { kill } = spawnSidecar("selene", [])
    expect(() => kill()).not.toThrow()
    expect(fakeProc.kill).not.toHaveBeenCalled()
  })

  it("passes cwd option to spawn", () => {
    h.mockExistsSync.mockReturnValue(true)
    const fakeProc = makeFakeProc()
    h.mockSpawn.mockReturnValue(fakeProc)

    spawnSidecar("selene", ["file.lua"], { cwd: "/project/src" })

    const [, , spawnOpts] = h.mockSpawn.mock.calls[0]
    expect(spawnOpts).toMatchObject({ cwd: "/project/src" })
  })
})
