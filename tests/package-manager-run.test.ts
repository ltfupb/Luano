/**
 * Tests for the `package-manager:run` IPC handler.
 *
 * Covers:
 *  - command whitelist (init/install/update/add accepted; others rejected)
 *  - package-name validation for `add` (regex, length cap, leading-dash guard)
 *  - dispatch by active tool (wally vs pesde)
 *  - missing binary surfaced clearly
 *  - error path when no tool is configured
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, realpathSync, writeFileSync, unlinkSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// ── Hoisted state ────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    mockRunWally: vi.fn<(args: string[], cwd: string) => Promise<{ exitCode: number; output: string }>>(),
    mockRunPesde: vi.fn<(args: string[], cwd: string) => Promise<{ exitCode: number; output: string }>>(),
    mockIsBinaryAvailable: vi.fn<(name: string) => boolean>(),
    mockGetActiveTool: vi.fn<(cat: string, projectPath: string) => string | null>()
  }
})

// ── Mocks (must be declared before importing the unit under test) ────────────

vi.mock("electron", () => ({
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown) => { h.handlers.set(ch, fn) }
  },
  app: { getPath: () => tmpdir() },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("../electron/main", () => ({
  syncManager: { start: vi.fn(), stop: vi.fn(), getStatus: vi.fn().mockReturnValue({ status: "stopped" }) },
  lspManager: { start: vi.fn(), stop: vi.fn() }
}))

vi.mock("../electron/file/project", async () => {
  const actual = await vi.importActual<typeof import("../electron/file/project")>("../electron/file/project")
  return { ...actual, watchProject: vi.fn() }
})
vi.mock("../electron/file/watcher", () => ({ watchProject: vi.fn(), stopWatcher: vi.fn() }))
vi.mock("../electron/ipc/terminal-handlers", () => ({ cleanupPtys: vi.fn() }))
vi.mock("../electron/sidecar/selene", () => ({ lintFile: vi.fn() }))
vi.mock("../electron/sidecar/stylua", () => ({ formatFile: vi.fn() }))

vi.mock("../electron/sidecar/wally", () => ({ runWally: h.mockRunWally }))
vi.mock("../electron/sidecar/pesde", () => ({ runPesde: h.mockRunPesde }))
vi.mock("../electron/sidecar", () => ({ isBinaryAvailable: h.mockIsBinaryAvailable }))

vi.mock("../electron/pro", () => ({ hasFeature: vi.fn().mockReturnValue(false), isPro: vi.fn().mockReturnValue(false) }))
vi.mock("../electron/pro/modules", () => ({
  analyzeTopology: vi.fn(),
  analyzeCrossScript: vi.fn(),
  performanceLint: vi.fn(),
  performanceLintFile: vi.fn(),
  loadSchemas: vi.fn(),
  addSchema: vi.fn(),
  deleteSchema: vi.fn(),
  generateDataModule: vi.fn(),
  generateMigration: vi.fn(),
  recordDiff: vi.fn(),
  telemetryEnabled: vi.fn().mockReturnValue(false),
  setTelemetry: vi.fn(),
  telemetryStats: vi.fn().mockResolvedValue({}),
  clearLastCheckpoint: vi.fn()
}))
vi.mock("../electron/store", () => ({ store: { get: vi.fn(), set: vi.fn() } }))
vi.mock("../electron/ai/provider", () => ({ abortAgent: vi.fn() }))
vi.mock("../electron/pro/license", () => ({
  activateLicense: vi.fn(),
  deactivateLicense: vi.fn(),
  getLicenseInfo: vi.fn(),
  validateLicense: vi.fn().mockResolvedValue(false)
}))
vi.mock("../electron/toolchain/config", () => ({
  getToolchainConfig: vi.fn().mockReturnValue({ tools: {} }),
  getActiveTool: h.mockGetActiveTool,
  setProjectTool: vi.fn(),
  setGlobalDefault: vi.fn(),
  isMinimumToolchainReady: vi.fn().mockReturnValue(false),
  hasProjectConfig: vi.fn().mockReturnValue(false),
  initProjectConfig: vi.fn()
}))
vi.mock("../electron/toolchain/downloader", () => ({
  downloadTool: vi.fn(),
  downloadMultiple: vi.fn(),
  getDownloadStatus: vi.fn().mockReturnValue("not-installed"),
  removeTool: vi.fn(),
  checkToolUpdates: vi.fn().mockResolvedValue([]),
  updateTool: vi.fn(),
  fetchToolMetadata: vi.fn()
}))
vi.mock("../electron/toolchain/registry", () => ({
  TOOL_REGISTRY: {
    wally: { id: "wally", name: "Wally", binaryName: "wally", category: "package-manager" },
    pesde: { id: "pesde", name: "pesde", binaryName: "pesde", category: "package-manager" }
  },
  CATEGORIES: []
}))

// shared.ts: lightweight reimplementation that delegates to the real validatePath
vi.mock("../electron/ipc/shared", async () => {
  const { validatePath } = await vi.importActual<typeof import("../electron/file/sandbox")>(
    "../electron/file/sandbox"
  )
  const { resolve: pathResolve, normalize } = await vi.importActual<typeof import("path")>("path")
  const fs = await vi.importActual<typeof import("fs")>("fs")
  const canonicalizeProjectRoot = (p: string): string => {
    const resolved = normalize(pathResolve(p))
    try { return fs.realpathSync.native(resolved) } catch { return resolved }
  }
  let project: string | null = null
  return {
    aiGeneratedFiles: new Map<string, string>(),
    PRO_REQUIRED: () => ({ success: false, error: "Pro required" }),
    collectLuauFiles: vi.fn(),
    setCurrentProject: (p: string | null) => { project = p ? canonicalizeProjectRoot(p) : null },
    getCurrentProject: () => project,
    requireInProject: (p: string): string => {
      if (!project) throw new Error("No project is open")
      return validatePath(p, project)
    },
    requireMatchesCurrentProject: (p: string): string => {
      if (!project) throw new Error("No project is open")
      const candidate = canonicalizeProjectRoot(p)
      if (candidate !== project) throw new Error(`Path is not the current project: ${p}`)
      return project
    },
    canonicalizeProjectRoot
  }
})

// ── Import under test after mocks are wired ─────────────────────────────────

import { registerProjectHandlers } from "../electron/ipc/project-handlers"
import { setCurrentProject } from "../electron/ipc/shared"

// ── Setup ────────────────────────────────────────────────────────────────────

let projectRoot: string

beforeEach(() => {
  h.handlers.clear()
  h.mockRunWally.mockReset()
  h.mockRunPesde.mockReset()
  h.mockIsBinaryAvailable.mockReset()
  h.mockGetActiveTool.mockReset()
  registerProjectHandlers()

  const dir = join(tmpdir(), `luano-pkg-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  // Canonicalize via realpathSync.native so the path matches what
  // requireMatchesCurrentProject's canonicalizer returns (Win32 namespace
  // prefix on Windows). Otherwise the handler-side canonical path differs
  // from the test-side projectRoot and assertions on `args` mismatch.
  projectRoot = realpathSync.native(dir)
  setCurrentProject(projectRoot)
})

afterEach(() => {
  setCurrentProject(null)
  try { rmSync(projectRoot, { recursive: true, force: true }) } catch { /* ignore */ }
})

// Helpers for seeding manifests on disk so the manifest-priority dispatch
// path can find them. Manifest contents don't matter — the handler only
// checks existence.
function seedWally(): void { writeFileSync(join(projectRoot, "wally.toml"), "[package]\nname = \"u/p\"\nversion = \"0.1.0\"\nrealm = \"shared\"\n") }
function seedPesde(): void { writeFileSync(join(projectRoot, "pesde.toml"), "name = \"u/p\"\nversion = \"0.1.0\"\n") }
function clearManifest(name: "wally.toml" | "pesde.toml"): void {
  const p = join(projectRoot, name)
  if (existsSync(p)) unlinkSync(p)
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("package-manager:run — command whitelist", () => {
  beforeEach(() => {
    seedWally()
    h.mockGetActiveTool.mockReturnValue("wally")
    h.mockIsBinaryAvailable.mockReturnValue(true)
    h.mockRunWally.mockResolvedValue({ exitCode: 0, output: "ok" })
  })

  it.each(["install", "update"])("accepts %s when wally manifest is present", async (cmd) => {
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, cmd) as { success: boolean }
    expect(result.success).toBe(true)
    expect(h.mockRunWally).toHaveBeenCalledWith([cmd], projectRoot)
  })

  it("accepts init via active toolchain selection (no manifest required)", async () => {
    clearManifest("wally.toml")
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "init") as { success: boolean }
    expect(result.success).toBe(true)
    expect(h.mockRunWally).toHaveBeenCalledWith(["init"], projectRoot)
  })

  it("rejects unknown command", async () => {
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "publish") as { success: boolean; error?: string }
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Unsupported command/) })
    expect(h.mockRunWally).not.toHaveBeenCalled()
  })
})

describe("package-manager:run — add command package-name validation", () => {
  beforeEach(() => {
    seedWally()
    h.mockGetActiveTool.mockReturnValue("wally")
    h.mockIsBinaryAvailable.mockReturnValue(true)
    h.mockRunWally.mockResolvedValue({ exitCode: 0, output: "ok" })
  })

  it.each([
    "Roblox/Roact",
    "Roblox/Roact@1.4.4",
    "user/pkg@^1.0.0",
    "user/pkg@~1.0",
    "user/pkg@>=1.0.0",
    "user/pkg@*"
  ])("accepts valid package spec %s", async (name) => {
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "add", name) as { success: boolean }
    expect(result.success).toBe(true)
    // After add, install is auto-chained — assert the add call happened.
    expect(h.mockRunWally).toHaveBeenCalledWith(["add", name], projectRoot)
  })

  it.each([
    "",
    "--help",
    "-rf",
    "user/pkg; rm -rf /",
    "user/pkg && curl evil",
    "user/pkg`whoami`",
    "user/pkg$(whoami)",
    "user/pkg with space",
    "user/pkg\nnewline"
  ])("rejects unsafe input %j", async (name) => {
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "add", name) as { success: boolean; error?: string }
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Invalid package name/) })
    expect(h.mockRunWally).not.toHaveBeenCalled()
  })

  it("rejects package name longer than 200 chars", async () => {
    const fn = h.handlers.get("package-manager:run")!
    const longName = "a".repeat(201)
    const result = await fn({}, projectRoot, "add", longName) as { success: boolean; error?: string }
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Invalid package name/) })
    expect(h.mockRunWally).not.toHaveBeenCalled()
  })

  it("rejects add without packageName", async () => {
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "add") as { success: boolean; error?: string }
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Invalid package name/) })
    expect(h.mockRunWally).not.toHaveBeenCalled()
  })
})

describe("package-manager:run — dispatch by manifest (manifest is source of truth)", () => {
  beforeEach(() => {
    h.mockIsBinaryAvailable.mockReturnValue(true)
    h.mockRunWally.mockResolvedValue({ exitCode: 0, output: "wally ok" })
    h.mockRunPesde.mockResolvedValue({ exitCode: 0, output: "pesde ok" })
  })

  it("dispatches to wally when wally.toml exists, regardless of active selection", async () => {
    seedWally()
    h.mockGetActiveTool.mockReturnValue("pesde")
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "install") as { success: boolean; tool?: string }
    expect(result).toMatchObject({ success: true, tool: "wally" })
    expect(h.mockRunWally).toHaveBeenCalled()
    expect(h.mockRunPesde).not.toHaveBeenCalled()
  })

  it("dispatches to pesde when pesde.toml exists, regardless of active selection", async () => {
    seedPesde()
    h.mockGetActiveTool.mockReturnValue("wally")
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "install") as { success: boolean; tool?: string }
    expect(result).toMatchObject({ success: true, tool: "pesde" })
    expect(h.mockRunPesde).toHaveBeenCalled()
    expect(h.mockRunWally).not.toHaveBeenCalled()
  })

  it("preserves packages across wally → pesde → wally active-tool round trip", async () => {
    // The configured packages live in wally.toml on disk — switching the
    // toolchain "active package manager" must NOT change which CLI runs
    // when the manifest is unambiguous, and must NOT touch the manifest file.
    seedWally()
    const fn = h.handlers.get("package-manager:run")!

    // 1) Active is wally — wally.toml dictates wally runs.
    h.mockGetActiveTool.mockReturnValue("wally")
    expect(((await fn({}, projectRoot, "install")) as { tool?: string }).tool).toBe("wally")

    // 2) User switches active to pesde. wally.toml is still on disk, no
    //    pesde.toml, so wally still runs.
    h.mockGetActiveTool.mockReturnValue("pesde")
    expect(((await fn({}, projectRoot, "install")) as { tool?: string }).tool).toBe("wally")

    // 3) User switches active back to wally — same outcome.
    h.mockGetActiveTool.mockReturnValue("wally")
    expect(((await fn({}, projectRoot, "install")) as { tool?: string }).tool).toBe("wally")

    // The wally.toml file content is untouched throughout — the handler
    // only reads `existsSync`, never modifies the manifest.
    expect(existsSync(join(projectRoot, "wally.toml"))).toBe(true)
    expect(existsSync(join(projectRoot, "pesde.toml"))).toBe(false)
  })

  it("when both manifests exist, active selection breaks the tie", async () => {
    seedWally()
    seedPesde()
    h.mockGetActiveTool.mockReturnValue("pesde")
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "install") as { tool?: string }
    expect(result.tool).toBe("pesde")
    expect(h.mockRunPesde).toHaveBeenCalled()
    expect(h.mockRunWally).not.toHaveBeenCalled()
  })

  it("when both manifests exist with no active selection, returns a clear error", async () => {
    seedWally()
    seedPesde()
    h.mockGetActiveTool.mockReturnValue(null)
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "install") as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Both wally.toml and pesde.toml/)
    expect(h.mockRunWally).not.toHaveBeenCalled()
    expect(h.mockRunPesde).not.toHaveBeenCalled()
  })

  it("install/update/add without any manifest returns a clear error pointing at init", async () => {
    h.mockGetActiveTool.mockReturnValue("wally")
    const fn = h.handlers.get("package-manager:run")!
    for (const cmd of ["install", "update"]) {
      const r = await fn({}, projectRoot, cmd) as { success: boolean; error?: string }
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/Run `init` first/)
    }
    const addResult = await fn({}, projectRoot, "add", "Roblox/Roact") as { success: boolean; error?: string }
    expect(addResult.success).toBe(false)
    expect(addResult.error).toMatch(/Run `init` first/)
    expect(h.mockRunWally).not.toHaveBeenCalled()
  })
})

describe("package-manager:run — add auto-installs", () => {
  beforeEach(() => {
    seedWally()
    h.mockGetActiveTool.mockReturnValue("wally")
    h.mockIsBinaryAvailable.mockReturnValue(true)
  })

  it("chains install after a successful add", async () => {
    h.mockRunWally
      .mockResolvedValueOnce({ exitCode: 0, output: "added" })   // add
      .mockResolvedValueOnce({ exitCode: 0, output: "installed" }) // install
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "add", "Roblox/Roact@1.4.4") as {
      success: boolean; output?: string
    }
    expect(result.success).toBe(true)
    expect(h.mockRunWally).toHaveBeenNthCalledWith(1, ["add", "Roblox/Roact@1.4.4"], projectRoot)
    expect(h.mockRunWally).toHaveBeenNthCalledWith(2, ["install"], projectRoot)
    expect(result.output).toContain("added")
    expect(result.output).toContain("installed")
  })

  it("does NOT run install when add itself fails", async () => {
    h.mockRunWally.mockResolvedValueOnce({ exitCode: 1, output: "package not found" })
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "add", "Roblox/DoesNotExist") as {
      success: boolean; error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/exited with code 1/)
    expect(h.mockRunWally).toHaveBeenCalledTimes(1)
  })

  it("surfaces install failure but acknowledges the manifest change", async () => {
    h.mockRunWally
      .mockResolvedValueOnce({ exitCode: 0, output: "added to manifest" })
      .mockResolvedValueOnce({ exitCode: 1, output: "network error" })
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "add", "Roblox/Roact") as {
      success: boolean; error?: string; output?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/added Roblox\/Roact to manifest but install failed/)
    expect(result.output).toContain("added to manifest")
    expect(result.output).toContain("network error")
  })
})

describe("package-manager:migrate-to-pesde", () => {
  it("converts wally.toml to pesde.toml and renames the original to .bak", async () => {
    seedWally()
    const fn = h.handlers.get("package-manager:migrate-to-pesde")!
    const result = await fn({}, projectRoot) as {
      success: boolean; migratedCount?: number; unmappedCount?: number; backupPath?: string
    }
    expect(result.success).toBe(true)
    expect(result.migratedCount).toBe(0)
    expect(result.unmappedCount).toBe(0)
    expect(existsSync(join(projectRoot, "pesde.toml"))).toBe(true)
    expect(existsSync(join(projectRoot, "wally.toml"))).toBe(false)
    expect(result.backupPath).toBeDefined()
    expect(existsSync(result.backupPath!)).toBe(true)
  })

  it("converts dependencies through pesde's wally adapter", async () => {
    writeFileSync(join(projectRoot, "wally.toml"),
      `[package]\nname = "user/repo"\nversion = "1.0.0"\nrealm = "shared"\n\n` +
      `[dependencies]\nRoact = "Roblox/roact@^1.4.4"\n\n` +
      `[dev-dependencies]\nTestEZ = "Roblox/testez@^0.4.0"\n`
    )
    const fn = h.handlers.get("package-manager:migrate-to-pesde")!
    const result = await fn({}, projectRoot) as { success: boolean; migratedCount?: number }
    expect(result.success).toBe(true)
    expect(result.migratedCount).toBe(2)

    const { readFileSync } = await import("fs")
    const pesdeToml = readFileSync(join(projectRoot, "pesde.toml"), "utf-8")
    expect(pesdeToml).toContain('Roact = { wally = "Roblox/roact", version = "^1.4.4" }')
    expect(pesdeToml).toContain('TestEZ = { wally = "Roblox/testez", version = "^0.4.0" }')
  })

  it("refuses migration when no wally.toml exists", async () => {
    const fn = h.handlers.get("package-manager:migrate-to-pesde")!
    const result = await fn({}, projectRoot) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/No wally.toml/)
  })

  it("refuses migration when pesde.toml already exists (no clobber)", async () => {
    seedWally()
    seedPesde()
    const fn = h.handlers.get("package-manager:migrate-to-pesde")!
    const result = await fn({}, projectRoot) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/pesde.toml already exists/)
    // Both files must remain untouched.
    expect(existsSync(join(projectRoot, "wally.toml"))).toBe(true)
    expect(existsSync(join(projectRoot, "pesde.toml"))).toBe(true)
  })

  it("rejects when projectPath is not the current project", async () => {
    seedWally()
    const fn = h.handlers.get("package-manager:migrate-to-pesde")!
    const result = await fn({}, "/some/other/path") as { success: boolean }
    expect(result.success).toBe(false)
    expect(existsSync(join(projectRoot, "wally.toml"))).toBe(true)
  })

  it("refuses migration when wally.toml exceeds the 1 MB read cap", async () => {
    // A hostile cloned repo could ship a multi-GB wally.toml; without the
    // statSync gate, readFileSync would OOM the main process the moment the
    // user clicks Migrate.
    const huge = "[package]\nname = \"u/r\"\nversion = \"0.1.0\"\nrealm = \"shared\"\n# " + "x".repeat(2 * 1024 * 1024)
    writeFileSync(join(projectRoot, "wally.toml"), huge)
    const fn = h.handlers.get("package-manager:migrate-to-pesde")!
    const result = await fn({}, projectRoot) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/too large/)
    // Original file untouched.
    expect(existsSync(join(projectRoot, "wally.toml"))).toBe(true)
    expect(existsSync(join(projectRoot, "pesde.toml"))).toBe(false)
  })
})

describe("package-manager:run — error paths", () => {
  it("returns init guidance when no manifest and no active tool", async () => {
    h.mockGetActiveTool.mockReturnValue(null)
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "init") as { success: boolean; error?: string }
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/Select one in the Toolchain panel/)
    })
  })

  it("returns error when binary is not installed", async () => {
    seedWally()
    h.mockGetActiveTool.mockReturnValue("wally")
    h.mockIsBinaryAvailable.mockReturnValue(false)
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "install") as { success: boolean; error?: string; tool?: string }
    expect(result).toMatchObject({
      success: false,
      tool: "wally",
      error: expect.stringMatching(/not installed/)
    })
  })

  it("propagates non-zero exit code as failure with output", async () => {
    seedWally()
    h.mockGetActiveTool.mockReturnValue("wally")
    h.mockIsBinaryAvailable.mockReturnValue(true)
    h.mockRunWally.mockResolvedValue({ exitCode: 1, output: "error: bad manifest" })
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, projectRoot, "install") as {
      success: boolean; error?: string; output?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/exited with code 1/)
    expect(result.output).toBe("error: bad manifest")
  })

  it("rejects when projectPath is not the current project", async () => {
    h.mockGetActiveTool.mockReturnValue("wally")
    h.mockIsBinaryAvailable.mockReturnValue(true)
    const fn = h.handlers.get("package-manager:run")!
    const result = await fn({}, "/some/other/path", "install") as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(h.mockRunWally).not.toHaveBeenCalled()
  })
})
