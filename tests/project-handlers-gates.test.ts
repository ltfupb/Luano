/**
 * tests/project-handlers-gates.test.ts
 *
 * Focused tests for the trust-boundary gates in electron/ipc/project-handlers.ts:
 *   - project:open requires path-from-dialog or path-matches-current
 *   - project:open-folder populates the dialog-confirmed set
 *   - path-bearing handlers (toolchain:get-config, file:watch) reject arg
 *     mismatches against the current project
 *   - file:search walk yields to the event loop every N entries
 *
 * Strategy: capture every ipcMain.handle registration, stub fs/dialog and all
 * side-effect-heavy peers, then drive handlers directly with synthesized events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, writeFileSync as realWriteFileSync, realpathSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

type HandlerFn = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, HandlerFn>()

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  syncServe: vi.fn(),
  syncStop: vi.fn(),
  lspStart: vi.fn().mockResolvedValue(undefined),
  lspStop: vi.fn().mockResolvedValue(undefined),
  watchProject: vi.fn()
}))

vi.mock("electron", () => ({
  ipcMain: {
    handle: (ch: string, fn: HandlerFn) => { handlers.set(ch, fn) }
  },
  dialog: { showOpenDialog: h.showOpenDialog },
  app: {
    getAppPath: () => "/app",
    getPath: () => "/tmp/luano-test"
  },
  shell: { openPath: vi.fn() }
}))
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))
vi.mock("../electron/main", () => ({
  syncManager: { serve: h.syncServe, stop: h.syncStop, getStatus: vi.fn() },
  lspManager: { start: h.lspStart, stop: h.lspStop, getPort: () => 0 }
}))
// Use REAL createFile/createFolder/renameEntry/moveEntry so the basename
// validation path runs end-to-end from the handler. Everything else stays
// mocked to keep the test hermetic.
vi.mock("../electron/file/project", async () => {
  const actual = await vi.importActual<typeof import("../electron/file/project")>(
    "../electron/file/project"
  )
  return {
    ...actual,
    readDir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    deleteEntry: vi.fn(),
    initProject: vi.fn(),
    ensureLintConfig: vi.fn()
  }
})
vi.mock("../electron/file/watcher", () => ({
  watchProject: h.watchProject,
  stopWatcher: vi.fn()
}))
vi.mock("../electron/ipc/terminal-handlers", () => ({
  cleanupPtys: vi.fn()
}))
vi.mock("../electron/sidecar/selene", () => ({ lintFile: vi.fn() }))
vi.mock("../electron/sidecar/stylua", () => ({ formatFile: vi.fn() }))
vi.mock("../electron/pro", () => ({
  hasFeature: vi.fn().mockReturnValue(false),
  isPro: vi.fn().mockReturnValue(false)
}))
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
  // C2 + M11: added by wave-fix-5
  clearLastCheckpoint: vi.fn(),
  // M1: forceResetSessionState called on project switch
  forceResetSessionState: vi.fn()
}))
vi.mock("../electron/store", () => ({
  store: { get: vi.fn(), set: vi.fn() }
}))
// M11 + C2: abortAgent imported from provider in project-handlers
vi.mock("../electron/ai/provider", () => ({
  abortAgent: vi.fn()
}))
vi.mock("../electron/pro/license", () => ({
  activateLicense: vi.fn(),
  deactivateLicense: vi.fn(),
  getLicenseInfo: vi.fn(),
  validateLicense: vi.fn().mockResolvedValue(false)
}))
vi.mock("../electron/toolchain/config", () => ({
  getToolchainConfig: vi.fn().mockReturnValue({ tools: {} }),
  getActiveTool: vi.fn(),
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
  TOOL_REGISTRY: {},
  CATEGORIES: []
}))

// shared.ts also pulls heavy deps; keep a lightweight reimplementation that
// delegates to the real validatePath so project-handlers sees the same gate.
// We mirror the canonical-pinning behavior of production shared.ts: store
// realpath-resolved project root, compare canonical-to-canonical. Without
// this the file:search canonicalization step would reject every legit call.
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
    PRO_REQUIRED: () => ({ success: false, error: "pro_required" }),
    collectLuauFiles: vi.fn().mockReturnValue([]),
    canonicalizeProjectRoot,
    setCurrentProject: (p: string | null) => {
      project = p === null ? null : canonicalizeProjectRoot(p)
    },
    getCurrentProject: () => project,
    requireInProject: (p: string): string => {
      if (!project) throw new Error("No project is open")
      if (typeof p !== "string" || p.length === 0) throw new Error("Invalid path")
      return validatePath(p, project)
    },
    requireMatchesCurrentProject: (p: string): string => {
      if (!project) throw new Error("No project is open")
      if (typeof p !== "string" || p.length === 0) {
        throw new Error("projectPath does not match current project")
      }
      if (canonicalizeProjectRoot(p) !== project) {
        throw new Error("projectPath does not match current project")
      }
      return project
    }
  }
})

// ── Import under test after mocks ───────────────────────────────────────────
import { registerProjectHandlers } from "../electron/ipc/project-handlers"
import { setCurrentProject } from "../electron/ipc/shared"

let testRoot: string
let projectRoot: string

beforeEach(() => {
  handlers.clear()
  vi.clearAllMocks()
  testRoot = join(tmpdir(), `luano-proj-gates-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(testRoot, { recursive: true })
  testRoot = realpathSync(testRoot)
  projectRoot = join(testRoot, "project")
  mkdirSync(projectRoot)
  registerProjectHandlers()
})

afterEach(() => {
  setCurrentProject(null)
  handlers.clear()
  try { rmSync(testRoot, { recursive: true, force: true }) } catch { /* best effort */ }
})

describe("project:open dialog-confirmed gate", () => {
  it("rejects a path that was never surfaced through the folder picker", async () => {
    setCurrentProject(null)
    const open = handlers.get("project:open")!
    const result = await open({}, projectRoot) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not confirmed/)
  })

  it("accepts a path that was just returned by project:open-folder (one-shot)", async () => {
    // Drive the real picker handler so it adds the path to the confirmed set,
    // then re-drive project:open with the same path.
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [projectRoot] })
    const picker = handlers.get("project:open-folder")!
    const picked = await picker({}) as string
    expect(picked).toBe(projectRoot)

    const open = handlers.get("project:open")!
    const result = await open({}, projectRoot) as { success: boolean }
    expect(result.success).toBe(true)

    // The confirmation is one-shot — a forged retry without a fresh picker
    // must now be refused, even though the current project is already set.
    // (Re-opening the same project still works via the isCurrent branch,
    //  so we test the rejection path by asking for a *different* path.)
    const other = join(testRoot, "other")
    mkdirSync(other)
    const second = await open({}, other) as { success: boolean; error?: string }
    expect(second.success).toBe(false)
    expect(second.error).toMatch(/not confirmed/)
  })

  it("accepts a path equal to the currently-open project (re-open / reload)", async () => {
    setCurrentProject(projectRoot)
    const open = handlers.get("project:open")!
    const result = await open({}, projectRoot) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it("project:open-folder returns null on cancel and does not register a path", async () => {
    h.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const picker = handlers.get("project:open-folder")!
    const picked = await picker({})
    expect(picked).toBeNull()

    // Nothing was confirmed, so project:open on that path must still refuse.
    const open = handlers.get("project:open")!
    const result = await open({}, projectRoot) as { success: boolean }
    expect(result.success).toBe(false)
  })

  it("accepts a previously-opened path on a fresh launch (recent-list flow)", async () => {
    // Simulate a recent-list click: the user previously opened projectRoot
    // (going through the dialog), the app restarted (which clears the
    // dialogConfirmedPaths in-memory set + resets _currentProject), and now
    // the user clicks the path from their recent-projects list.
    //
    // Step 1: open via dialog so the trusted-projects allowlist learns the
    // canonical path. After project:close the in-memory dialog set is empty
    // and the current project is null, but the persisted allowlist remains.
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [projectRoot] })
    const picker = handlers.get("project:open-folder")!
    await picker({})

    const open = handlers.get("project:open")!
    const first = await open({}, projectRoot) as { success: boolean }
    expect(first.success).toBe(true)

    const close = handlers.get("project:close")!
    await close({})

    // Step 2: re-open without going through the dialog again. With only the
    // dialog/current gates this would refuse — the third (trusted) gate is
    // the recent-projects fix.
    const second = await open({}, projectRoot) as { success: boolean; error?: string }
    expect(second.success).toBe(true)
    expect(second.error).toBeUndefined()
  })

  it("still refuses a path that was never opened, even after another path was trusted", async () => {
    // Trust projectRoot via the dialog flow.
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [projectRoot] })
    const picker = handlers.get("project:open-folder")!
    await picker({})

    const open = handlers.get("project:open")!
    const first = await open({}, projectRoot) as { success: boolean }
    expect(first.success).toBe(true)

    const close = handlers.get("project:close")!
    await close({})

    // A different path that was never confirmed must still refuse — trusting
    // one path doesn't open the gate for arbitrary disk locations.
    const stranger = join(testRoot, "stranger")
    mkdirSync(stranger)
    const result = await open({}, stranger) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not confirmed/)
  })
})

describe("handlers gated by requireMatchesCurrentProject", () => {
  it("toolchain:get-config falls back to global config (no throw) for an unconfirmed projectPath", () => {
    // Race-safe degrade: a stale projectPath from the renderer (e.g. mid-switch
    // race, dev hot-reload) should NOT throw. Falling back to global defaults
    // keeps openPath's Promise.all alive and matches the read-only nature of
    // the call. The pathSafeToProbe gate still bounds writes — see set-tool.
    setCurrentProject(projectRoot)
    const h2 = handlers.get("toolchain:get-config")!
    const other = join(testRoot, "other-project")
    expect(() => h2({}, other, false)).not.toThrow()
  })

  it("toolchain:get-config returns global config when no projectPath is supplied", () => {
    setCurrentProject(projectRoot)
    const h2 = handlers.get("toolchain:get-config")!
    // Undefined projectPath → skip the gate entirely.
    expect(() => h2({})).not.toThrow()
  })

  it("toolchain:set-tool refuses an unconfirmed projectPath (write path stays gated)", () => {
    setCurrentProject(projectRoot)
    const setTool = handlers.get("toolchain:set-tool")!
    const other = join(testRoot, "other-project")
    const result = setTool({}, "linter", "selene", other) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not confirmed/)
  })

  it("file:watch throws when the supplied path does not match the current project", () => {
    setCurrentProject(projectRoot)
    const watch = handlers.get("file:watch")!
    const other = join(testRoot, "other-project")
    expect(() => watch({}, other)).toThrow(/does not match/)
    expect(h.watchProject).not.toHaveBeenCalled()
  })

  it("file:watch succeeds when path equals the current project", () => {
    setCurrentProject(projectRoot)
    const watch = handlers.get("file:watch")!
    const result = watch({}, projectRoot) as { success: boolean }
    expect(result.success).toBe(true)
    expect(h.watchProject).toHaveBeenCalledWith(projectRoot)
  })

  it("file:watch throws when no project is open", () => {
    setCurrentProject(null)
    const watch = handlers.get("file:watch")!
    expect(() => watch({}, projectRoot)).toThrow(/No project/)
  })
})

describe("toolchain:has-project-config / init pre-open probe gate", () => {
  it("has-project-config returns false silently for an unconfirmed path (no throw)", () => {
    // No project open, no dialog confirmation, no trust. Renderer-forged
    // path probe must NOT throw — silently returns false.
    setCurrentProject(null)
    const probe = handlers.get("toolchain:has-project-config")!
    const result = probe({}, projectRoot) as boolean
    expect(result).toBe(false)
  })

  it("has-project-config accepts a freshly-picked dialog path WITHOUT consuming it", async () => {
    // Drive the dialog to populate dialogConfirmedPaths.
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [projectRoot] })
    const picker = handlers.get("project:open-folder")!
    await picker({})

    // Pre-open probe: project is not open yet, but the dialog confirmation
    // is fresh. Probe must succeed (returning false because no .luano dir
    // exists in the temp project, which is the correct shape).
    const probe = handlers.get("toolchain:has-project-config")!
    const result = probe({}, projectRoot) as boolean
    expect(result).toBe(false) // path accepted, but no toolchain.json present

    // CRITICAL: probing must NOT consume the dialog entry. project:open
    // following the probe must still find the entry and succeed.
    const open = handlers.get("project:open")!
    const opened = await open({}, projectRoot) as { success: boolean }
    expect(opened.success).toBe(true)
  })

  it("init-project-config refuses an unconfirmed path with a clear error", () => {
    setCurrentProject(null)
    const init = handlers.get("toolchain:init-project-config")!
    const result = init({}, projectRoot) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not confirmed/)
  })
})

describe("file:search walk yields to the event loop", () => {
  it("invokes setImmediate at least once when walking > YIELD_EVERY (200) entries", async () => {
    setCurrentProject(projectRoot)
    // Seed the project with > 200 .lua files so the walk crosses a yield
    // boundary. All files contain the query to guarantee the read path runs.
    const fileCount = 250
    for (let i = 0; i < fileCount; i++) {
      realWriteFileSync(join(projectRoot, `file-${i}.lua`), "-- needle\n")
    }

    // Spy on setImmediate to count yields. The walk awaits
    // `new Promise((r) => setImmediate(r))` every 200 entries seen.
    const immSpy = vi.spyOn(globalThis, "setImmediate")

    const search = handlers.get("file:search")!
    const results = await search({}, projectRoot, "needle") as Array<unknown>

    // We should have found at least some matches (MAX_RESULTS caps at 500,
    // we seeded 250 so every file matches — cap doesn't hit).
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(500)
    // Most importantly, setImmediate was called at least once — proves the
    // yield boundary was crossed.
    expect(immSpy).toHaveBeenCalled()

    immSpy.mockRestore()
  })

  it("returns empty array when projectPath mismatches the current project", async () => {
    setCurrentProject(projectRoot)
    const search = handlers.get("file:search")!
    const other = join(testRoot, "other-project")
    const results = await search({}, other, "anything") as Array<unknown>
    expect(results).toEqual([])
  })
})

describe("file:create-file / file:rename name validation", () => {
  it("file:create-file refuses a name containing path separators", async () => {
    setCurrentProject(projectRoot)
    const create = handlers.get("file:create-file")!
    const result = await create({}, projectRoot, "../escape.lua") as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/path separators|traversal/)
    // File not created outside the project root
    expect(realWriteFileSync).toBeDefined() // ensure import exists
  })

  it("file:create-folder refuses a name with forward-slash segment", async () => {
    setCurrentProject(projectRoot)
    const create = handlers.get("file:create-folder")!
    const result = await create({}, projectRoot, "inner/nested") as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/path separators/)
  })

  it("file:create-file refuses a Windows reserved name", async () => {
    setCurrentProject(projectRoot)
    const create = handlers.get("file:create-file")!
    const result = await create({}, projectRoot, "CON.lua") as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/reserved/)
  })

  it("file:create-file accepts a benign name and creates it inside the project", async () => {
    setCurrentProject(projectRoot)
    const create = handlers.get("file:create-file")!
    const result = await create({}, projectRoot, "init.lua") as {
      success: boolean
      path?: string
    }
    expect(result.success).toBe(true)
    expect(result.path).toBe(join(projectRoot, "init.lua"))
  })

  it("file:rename refuses a newName containing path separators", async () => {
    setCurrentProject(projectRoot)
    // Seed a file to rename
    const orig = join(projectRoot, "orig.lua")
    realWriteFileSync(orig, "")
    const rename = handlers.get("file:rename")!
    const result = await rename({}, orig, "../../escape.lua") as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/path separators|traversal/)
  })
})

describe("project:untrust + trust persistence", () => {
  it("project:init of a dialog-confirmed path populates the trust allowlist (subsequent project:open succeeds)", async () => {
    // Step 1: confirm via dialog
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [projectRoot] })
    const picker = handlers.get("project:open-folder")!
    await picker({})

    // Step 2: init — should also record as trusted
    const init = handlers.get("project:init")!
    const initResult = await init({}, projectRoot) as { success: boolean }
    expect(initResult.success).toBe(true)

    // Step 3: close so there is no current project
    const close = handlers.get("project:close")!
    await close({})

    // Step 4: re-open via recent-list (no dialog, no current project)
    // Should succeed because init recorded it as trusted.
    const open = handlers.get("project:open")!
    const result = await open({}, projectRoot) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it("allowlist survives a fresh registerProjectHandlers call when store returns pre-seeded paths", async () => {
    const { store } = await import("../electron/store")
    const storeMock = store as { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }

    // Seed the mock store with projectRoot as a pre-trusted path.
    storeMock.get.mockImplementation((key: unknown) => {
      if (key === "trustedProjectPaths") return [projectRoot]
      return undefined
    })

    // Re-register handlers so the IIFE re-reads the store.
    handlers.clear()
    registerProjectHandlers()

    // No dialog, no current project — path is trusted via store seed.
    const open = handlers.get("project:open")!
    const result = await open({}, projectRoot) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Reset mock to avoid side-effects in subsequent tests.
    storeMock.get.mockReturnValue(undefined)
    handlers.clear()
    registerProjectHandlers()
  })

  it("project:untrust removes path from allowlist (subsequent project:open without dialog must refuse)", async () => {
    // Step 1: open legitimately so path gets trusted.
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [projectRoot] })
    const picker = handlers.get("project:open-folder")!
    await picker({})
    const open = handlers.get("project:open")!
    const first = await open({}, projectRoot) as { success: boolean }
    expect(first.success).toBe(true)

    // Step 2: close
    const close = handlers.get("project:close")!
    await close({})

    // Step 3: untrust the path
    const untrust = handlers.get("project:untrust")!
    const untrustResult = await untrust({}, projectRoot) as { success: boolean }
    expect(untrustResult.success).toBe(true)

    // Step 4: attempt re-open without dialog — must now be refused
    const second = await open({}, projectRoot) as { success: boolean; error?: string }
    expect(second.success).toBe(false)
    expect(second.error).toMatch(/not confirmed/)
  })
})

describe("project:open dialog-confirmed TOCTOU re-verification", () => {
  it("rejects a forged path that is NOT the same canonical directory", async () => {
    // project:open-folder confirms `projectRoot`. A compromised renderer then
    // calls project:open with a completely different path — rejected because
    // it's not in the confirmed set and doesn't match the current project.
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [projectRoot] })
    const picker = handlers.get("project:open-folder")!
    await picker({})

    const other = join(testRoot, "forged-target")
    mkdirSync(other)
    const open = handlers.get("project:open")!
    const result = await open({}, other) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not confirmed/)
  })

  it("project:open-folder refuses to confirm a symlink (returns null)", async () => {
    if (process.platform === "win32") return // skip — symlink creation on Win needs admin
    // Drop a symlink pointing at a real directory. The picker confirmation
    // must lstat and refuse — otherwise an attacker could pick the symlink,
    // get it confirmed, and swap the target post-hoc.
    const realDir = join(testRoot, "real")
    mkdirSync(realDir)
    const linkDir = join(testRoot, "link")
    const { symlinkSync } = await import("fs")
    try {
      symlinkSync(realDir, linkDir)
    } catch {
      return // environment without symlink perms — skip
    }
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [linkDir] })
    const picker = handlers.get("project:open-folder")!
    const picked = await picker({})
    expect(picked).toBeNull()
  })
})
