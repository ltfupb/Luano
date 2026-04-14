/**
 * tests/toolchain-config.test.ts — Unit tests for electron/toolchain/config.ts
 *
 * Tests toolchain configuration resolution:
 *   - hasProjectConfig: file-existence check
 *   - getActiveTool: project > global > bundled priority
 *   - setProjectTool / setGlobalDefault: write paths
 *   - getToolchainConfig: full config snapshot
 *   - initProjectConfig: one-shot creation, no-op if exists
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { join } from "path"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockExistsSync = vi.fn().mockReturnValue(false)
  const mockReadFileSync = vi.fn()
  const mockWriteFileSync = vi.fn()
  const mockMkdirSync = vi.fn()
  const mockStoreGet = vi.fn().mockReturnValue(undefined)
  const mockStoreSet = vi.fn()
  const mockIsBinaryAvailable = vi.fn().mockReturnValue(false)

  return {
    mockExistsSync,
    mockReadFileSync,
    mockWriteFileSync,
    mockMkdirSync,
    mockStoreGet,
    mockStoreSet,
    mockIsBinaryAvailable
  }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs")
  return {
    ...actual,
    existsSync: h.mockExistsSync,
    readFileSync: h.mockReadFileSync,
    writeFileSync: h.mockWriteFileSync,
    mkdirSync: h.mockMkdirSync
  }
})

vi.mock("../electron/store", () => ({
  store: {
    get: h.mockStoreGet,
    set: h.mockStoreSet
  }
}))

vi.mock("../electron/sidecar", () => ({
  isBinaryAvailable: h.mockIsBinaryAvailable
}))

vi.mock("../electron/toolchain/registry", () => ({
  TOOL_REGISTRY: {
    rojo:     { id: "rojo",     binaryName: "rojo",     category: "sync" },
    argon:    { id: "argon",    binaryName: "argon",    category: "sync" },
    selene:   { id: "selene",   binaryName: "selene",   category: "linter" },
    stylua:   { id: "stylua",   binaryName: "stylua",   category: "formatter" },
    "luau-lsp": { id: "luau-lsp", binaryName: "luau-lsp", category: "lsp" }
  },
  getDefaultToolId: (cat: string) => {
    const defaults: Record<string, string> = {
      sync: "argon", linter: "selene", formatter: "stylua", lsp: "luau-lsp"
    }
    return defaults[cat] ?? null
  }
}))

// ── Import under test ─────────────────────────────────────────────────────────

import {
  hasProjectConfig,
  getActiveTool,
  setProjectTool,
  setGlobalDefault,
  getToolchainConfig,
  initProjectConfig
} from "../electron/toolchain/config"

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROJECT = "/project/my-game"

function projectConfigPath() {
  return join(PROJECT, ".luano", "toolchain.json")
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockExistsSync.mockReturnValue(false)
  h.mockStoreGet.mockReturnValue(undefined)
})

// ── hasProjectConfig ──────────────────────────────────────────────────────────

describe("hasProjectConfig", () => {
  it("returns false when no .luano/toolchain.json exists", () => {
    expect(hasProjectConfig(PROJECT)).toBe(false)
  })

  it("returns true when .luano/toolchain.json exists", () => {
    h.mockExistsSync.mockImplementation((p: string) =>
      p === projectConfigPath()
    )
    expect(hasProjectConfig(PROJECT)).toBe(true)
  })
})

// ── getActiveTool ─────────────────────────────────────────────────────────────

describe("getActiveTool — resolution priority", () => {
  it("returns bundled default when no project or global config", () => {
    expect(getActiveTool("sync")).toBe("argon")
    expect(getActiveTool("linter")).toBe("selene")
    expect(getActiveTool("lsp")).toBe("luau-lsp")
  })

  it("returns global default when set and no project config", () => {
    h.mockStoreGet.mockImplementation((key: string) =>
      key === "toolchain" ? { defaults: { sync: "rojo" } } : undefined
    )
    expect(getActiveTool("sync")).toBe("rojo")
  })

  it("returns project-level tool when project config exists", () => {
    h.mockExistsSync.mockImplementation((p: string) => p === projectConfigPath())
    h.mockReadFileSync.mockReturnValue(JSON.stringify({ sync: "rojo" }))

    expect(getActiveTool("sync", PROJECT)).toBe("rojo")
  })

  it("project config takes priority over global default", () => {
    h.mockExistsSync.mockImplementation((p: string) => p === projectConfigPath())
    h.mockReadFileSync.mockReturnValue(JSON.stringify({ sync: "rojo" }))
    h.mockStoreGet.mockImplementation((key: string) =>
      key === "toolchain" ? { defaults: { sync: "argon" } } : undefined
    )

    expect(getActiveTool("sync", PROJECT)).toBe("rojo")
  })

  it("falls back to global when project config missing the category", () => {
    h.mockExistsSync.mockImplementation((p: string) => p === projectConfigPath())
    h.mockReadFileSync.mockReturnValue(JSON.stringify({ linter: "selene" }))
    h.mockStoreGet.mockImplementation((key: string) =>
      key === "toolchain" ? { defaults: { sync: "rojo" } } : undefined
    )

    expect(getActiveTool("sync", PROJECT)).toBe("rojo")
  })

  it("returns null for unknown category with no defaults", () => {
    expect(getActiveTool("unknown_cat" as never)).toBeNull()
  })

  it("handles corrupted project config gracefully (falls back to bundled)", () => {
    h.mockExistsSync.mockImplementation((p: string) => p === projectConfigPath())
    h.mockReadFileSync.mockReturnValue("not valid json{{")

    expect(getActiveTool("sync", PROJECT)).toBe("argon")
  })
})

// ── setProjectTool ────────────────────────────────────────────────────────────

describe("setProjectTool", () => {
  it("writes updated config with new tool selection", () => {
    h.mockExistsSync.mockReturnValue(false) // no existing config
    setProjectTool(PROJECT, "sync", "rojo")

    const written = JSON.parse(h.mockWriteFileSync.mock.calls[0][1] as string)
    expect(written.sync).toBe("rojo")
  })

  it("removes category when toolId is null", () => {
    h.mockExistsSync.mockImplementation((p: string) => p === projectConfigPath())
    h.mockReadFileSync.mockReturnValue(JSON.stringify({ sync: "rojo", linter: "selene" }))

    setProjectTool(PROJECT, "sync", null)

    const written = JSON.parse(h.mockWriteFileSync.mock.calls[0][1] as string)
    expect(written).not.toHaveProperty("sync")
    expect(written.linter).toBe("selene")
  })
})

// ── setGlobalDefault ──────────────────────────────────────────────────────────

describe("setGlobalDefault", () => {
  it("persists new global default to store", () => {
    h.mockStoreGet.mockReturnValue(undefined) // no existing config
    setGlobalDefault("sync", "rojo")

    expect(h.mockStoreSet).toHaveBeenCalledWith(
      "toolchain",
      expect.objectContaining({ defaults: expect.objectContaining({ sync: "rojo" }) })
    )
  })

  it("removes category when toolId is null", () => {
    h.mockStoreGet.mockImplementation((key: string) =>
      key === "toolchain" ? { defaults: { sync: "rojo", linter: "selene" } } : undefined
    )
    setGlobalDefault("sync", null)

    const saved = h.mockStoreSet.mock.calls[0][1] as { defaults: Record<string, string> }
    expect(saved.defaults).not.toHaveProperty("sync")
    expect(saved.defaults.linter).toBe("selene")
  })
})

// ── getToolchainConfig ────────────────────────────────────────────────────────

describe("getToolchainConfig", () => {
  it("returns bundled defaults when nothing is configured", () => {
    const { selections } = getToolchainConfig()
    expect(selections.sync).toBe("argon")
    expect(selections.linter).toBe("selene")
    expect(selections.formatter).toBe("stylua")
    expect(selections.lsp).toBe("luau-lsp")
  })

  it("installed map reflects isBinaryAvailable for each tool", () => {
    h.mockIsBinaryAvailable.mockImplementation((name: string) => name === "selene")
    const { installed } = getToolchainConfig()
    expect(installed.selene).toBe(true)
    expect(installed.rojo).toBe(false)
  })

  it("projectOnly mode returns null for categories not in project config", () => {
    h.mockExistsSync.mockImplementation((p: string) => p === projectConfigPath())
    h.mockReadFileSync.mockReturnValue(JSON.stringify({ sync: "rojo" }))

    const { selections } = getToolchainConfig(PROJECT, true)
    expect(selections.sync).toBe("rojo")
    expect(selections.linter).toBeNull()
  })
})

// ── initProjectConfig ─────────────────────────────────────────────────────────

describe("initProjectConfig", () => {
  it("creates .luano/toolchain.json with resolved defaults", () => {
    h.mockExistsSync.mockReturnValue(false)
    initProjectConfig(PROJECT)

    expect(h.mockWriteFileSync).toHaveBeenCalled()
    const written = JSON.parse(h.mockWriteFileSync.mock.calls[0][1] as string)
    expect(written.sync).toBe("argon")
    expect(written.linter).toBe("selene")
  })

  it("is a no-op when project config already exists", () => {
    h.mockExistsSync.mockImplementation((p: string) => p === projectConfigPath())
    initProjectConfig(PROJECT)

    expect(h.mockWriteFileSync).not.toHaveBeenCalled()
  })
})
