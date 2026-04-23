import { ipcMain, dialog, app, shell } from "electron"
import { join, basename, extname } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, statSync } from "fs"
import { homedir } from "os"
import { resolve as pathResolve } from "path"
import { is } from "@electron-toolkit/utils"
import { syncManager, lspManager } from "../main"
import { readDir, readFile, writeFile, createFile, createFolder, renameEntry, deleteEntry, moveEntry, initProject, ensureLintConfig } from "../file/project"
import { watchProject, stopWatcher } from "../file/watcher"
import { cleanupPtys } from "./terminal-handlers"
import { lintFile } from "../sidecar/selene"
import { formatFile } from "../sidecar/stylua"
import { hasFeature } from "../pro"
import {
  analyzeTopology, analyzeCrossScript,
  performanceLint, performanceLintFile,
  loadSchemas, addSchema, deleteSchema, generateDataModule, generateMigration,
  recordDiff,
  telemetryEnabled, setTelemetry, telemetryStats,
  type DataStoreSchema
} from "../pro/modules"
import { aiGeneratedFiles, PRO_REQUIRED, collectLuauFiles, setCurrentProject, getCurrentProject } from "./shared"
import { store } from "../store"
import { isPro } from "../pro"
import { activateLicense, deactivateLicense, getLicenseInfo, validateLicense as revalidateLicense } from "../pro/license"
import { getToolchainConfig, getActiveTool, setProjectTool, setGlobalDefault, isMinimumToolchainReady, hasProjectConfig, initProjectConfig } from "../toolchain/config"
import { downloadTool, downloadMultiple, getDownloadStatus, removeTool, checkToolUpdates, updateTool, fetchToolMetadata } from "../toolchain/downloader"
import { TOOL_REGISTRY, CATEGORIES, type ToolCategory } from "../toolchain/registry"

/**
 * Parse a CC-style skill .md file:
 *   ---
 *   name: Refactor
 *   description: Refactor selected code
 *   ---
 *   Prompt body, with {selection} and {file} templating.
 *
 * Missing fields fall back to the filename (minus .md) for the command.
 * Returns null only if the file is completely empty.
 * Tolerates CRLF line endings — authored on Windows is common.
 */
function parseMarkdownSkill(raw: string, filename: string): {
  command: string
  label: string
  description: string
  prompt: string
  custom: boolean
} | null {
  // Normalize CRLF so the frontmatter regex matches Windows-authored files.
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const base = basename(filename, extname(filename))
  const meta: Record<string, string> = {}
  let body = normalized
  if (fmMatch) {
    body = fmMatch[2]
    for (const line of fmMatch[1].split("\n")) {
      const idx = line.indexOf(":")
      if (idx <= 0) continue
      const k = line.slice(0, idx).trim().toLowerCase()
      const v = line.slice(idx + 1).trim()
      if (k) meta[k] = v
    }
  }
  body = body.trim()
  if (!body) return null
  const name = meta.name || base
  return {
    command: "/" + (meta.command || base).replace(/^\//, ""),
    label: name,
    description: meta.description || "",
    prompt: body,
    custom: true
  }
}

export function registerProjectHandlers(): void {
  // ── Pro Status ──────────────────────────────────────────────────────────────
  ipcMain.handle("pro:status", () => ({
    isPro: isPro(),
    features: {
      agent: hasFeature("agent"),
      inlineEdit: hasFeature("inline-edit"),
      rag: hasFeature("rag"),
      studioBridge: hasFeature("studio-bridge"),
      crossScript: hasFeature("cross-script"),
      perfLint: hasFeature("perf-lint"),
      datastoreSchema: hasFeature("datastore-schema"),
      skills: true
    }
  }))

  // ── License ──────────────────────────────────────────────────────────────
  ipcMain.handle("license:activate", async (_, key: string) => {
    const result = await activateLicense(key)
    const { invalidateManagedLicenseCache } = await import("../ai/provider")
    invalidateManagedLicenseCache()
    return result
  })
  ipcMain.handle("license:deactivate", async () => {
    const result = await deactivateLicense()
    const { invalidateManagedLicenseCache } = await import("../ai/provider")
    invalidateManagedLicenseCache()
    return result
  })
  ipcMain.handle("license:info", () => getLicenseInfo())
  ipcMain.handle("license:validate", async () => ({ valid: await revalidateLicense() }))

  // ── Project ──────────────────────────────────────────────────────────────
  ipcMain.handle("project:open-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle("project:open", async (_, projectPath: string) => {
    setCurrentProject(projectPath)
    // Seed selene.toml with the Roblox stdlib config before the LSP/linter
    // starts — otherwise Selene flags every game:GetService/script/Instance
    // usage as an error and the AI agent "fixes" valid code.
    const resourcesDir = is.dev
      ? join(app.getAppPath(), "resources")
      : process.resourcesPath
    ensureLintConfig(projectPath, resourcesDir)
    watchProject(projectPath)
    await lspManager.start(projectPath)
    // Only auto-start sync if this is actually a Rojo project. Folders opened
    // via the 'Open As-Is' dialog path shouldn't trigger a sync attempt that's
    // guaranteed to surface a 'No default.project.json' error toast.
    if (existsSync(join(projectPath, "default.project.json"))) {
      syncManager.serve(projectPath)
    }
    return { success: true, lspPort: lspManager.getPort() }
  })

  // Release all main-process holds on the current project folder
  // (watcher / LSP cwd / sync cwd) so the user can delete or move it.
  ipcMain.handle("project:close", async () => {
    stopWatcher()
    syncManager.stop()
    await lspManager.stop()
    cleanupPtys()
    setCurrentProject(null)
    return { success: true }
  })

  // ── File ──────────────────────────────────────────────────────────────────
  ipcMain.handle("file:read", (_, filePath: string) => {
    try { return readFile(filePath) } catch (err) {
      // Only swallow missing-file errors (e.g. file deleted between reads).
      // Other errors (EACCES, EISDIR, etc.) re-throw so renderer sees the real failure.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
      throw err
    }
  })
  ipcMain.handle("file:write", (_, filePath: string, content: string) => {
    const aiContent = aiGeneratedFiles.get(filePath)
    if (aiContent && content !== aiContent) {
      const fileType = filePath.includes(".server.") ? "server"
        : filePath.includes(".client.") ? "client" : "module"
      recordDiff({
        aiGenerated: aiContent,
        userEdited: content,
        fileType,
        apisUsed: [],
        lintErrorsBefore: 0,
        lintErrorsAfter: 0,
        accepted: true
      })
      aiGeneratedFiles.delete(filePath)
    }
    writeFile(filePath, content)
    return { success: true }
  })
  ipcMain.handle("file:read-dir", (_, dirPath: string) => readDir(dirPath))
  ipcMain.handle("file:watch", (_, projectPath: string) => {
    watchProject(projectPath)
    return { success: true }
  })
  ipcMain.handle("file:create-file", (_, dirPath: string, name: string) => {
    const fullPath = createFile(dirPath, name)
    return { success: true, path: fullPath }
  })
  ipcMain.handle("file:create-folder", (_, dirPath: string, name: string) => {
    const fullPath = createFolder(dirPath, name)
    return { success: true, path: fullPath }
  })
  ipcMain.handle("file:rename", (_, oldPath: string, newName: string) => {
    const newPath = renameEntry(oldPath, newName)
    return { success: true, path: newPath }
  })
  ipcMain.handle("file:delete", (_, entryPath: string) => {
    deleteEntry(entryPath)
    return { success: true }
  })
  // Used by drag-drop: verify a dropped path is a real directory (not a file,
  // not a symlink, not a missing path) before passing to project open.
  // lstatSync so symlinks report as symlinks instead of chasing to the target.
  ipcMain.handle("file:is-directory", (_, p: string) => {
    try {
      if (typeof p !== "string" || p.length === 0) return false
      const st = lstatSync(p)
      return st.isDirectory() && !st.isSymbolicLink()
    } catch {
      return false
    }
  })

  ipcMain.handle("file:move", async (_, srcPath: string) => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select destination folder"
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true }
    const destPath = moveEntry(srcPath, result.filePaths[0])
    return { success: true, path: destPath }
  })

  ipcMain.handle("project:init", (_, projectPath: string) => {
    const resourcesDir = is.dev
      ? join(app.getAppPath(), "resources")
      : process.resourcesPath
    try {
      initProject(projectPath, resourcesDir)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ── Sync (Rojo / Argon) ──────────────────────────────────────────────────
  ipcMain.handle("sync:serve", (_, projectPath: string) => {
    syncManager.serve(projectPath)
    return { success: true }
  })
  ipcMain.handle("sync:stop", () => {
    syncManager.stop()
    return { success: true }
  })
  ipcMain.handle("sync:status", () => syncManager.getStatus())

  // ── Lint/Format ─────────────────────────────────────────────────────────────
  ipcMain.handle("lint:format", async (_, filePath: string) => {
    const activeFmt = getActiveTool("formatter", getCurrentProject() ?? undefined)
    if (activeFmt !== "stylua") return { success: false }
    const success = await formatFile(filePath)
    return { success }
  })
  ipcMain.handle("lint:check", async (_, filePath: string) => {
    const activeLint = getActiveTool("linter", getCurrentProject() ?? undefined)
    if (activeLint !== "selene") return []
    return lintFile(filePath)
  })

  // ── File Search ─────────────────────────────────────────────────────────────
  // Bounded by time, file size, and result count so a malformed query on a
  // large repo (or a compromised renderer pointing at a huge tree) can't
  // freeze the main process. Also scoped to the currently-open project so
  // renderer input can't walk arbitrary filesystem paths.
  ipcMain.handle("file:search", (_, projectPath: string, query: string) => {
    if (!query.trim()) return []
    const current = getCurrentProject()
    // path.resolve normalizes slashes, `..`, and (on Windows) drive-letter
    // casing so `C:/proj`, `C:\proj`, and `C:\Proj\..\Proj` all compare
    // equal to the currently-open project. Without this, a renderer that
    // normalizes paths differently from shared.ts silently gets empty
    // results, and path-traversal-style strings aren't caught either.
    if (!current) return []
    try {
      if (pathResolve(projectPath) !== pathResolve(current)) return []
    } catch {
      return []
    }

    const MAX_FILE_BYTES = 2 * 1024 * 1024  // skip > 2MB files (logs, minified bundles)
    const TIMEOUT_MS = 5_000
    const MAX_RESULTS = 500
    const startedAt = Date.now()

    const results: Array<{ file: string; line: number; text: string }> = []
    const lowerQuery = query.toLowerCase()

    const SEARCH_EXTS = /\.(lua|luau|json|md|toml|txt)$/i
    const SKIP_DIRS = new Set(["node_modules", ".git", "Packages", "DevPackages"])

    const walk = (dir: string): void => {
      if (results.length >= MAX_RESULTS) return
      if (Date.now() - startedAt > TIMEOUT_MS) return
      if (!existsSync(dir)) return
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }

      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return
        if (Date.now() - startedAt > TIMEOUT_MS) return
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (SEARCH_EXTS.test(entry.name)) {
          try {
            const st = statSync(fullPath)
            if (st.size > MAX_FILE_BYTES) continue
            const lines = readFileSync(fullPath, "utf-8").split("\n")
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                results.push({ file: fullPath, line: i + 1, text: lines[i].trim() })
                if (results.length >= MAX_RESULTS) return
              }
            }
          } catch { /* skip unreadable */ }
        }
      }
    }

    walk(projectPath)
    return results
  })

  // ── Topology ──────────────────────────────────────────────────────────────
  ipcMain.handle("topology:analyze", (_, projectPath: string) => {
    return analyzeTopology(projectPath)
  })

  // ── Cross-Script Analysis [Pro] ─────────────────────────────────────────────
  ipcMain.handle("analysis:cross-script", (_, projectPath: string) => {
    if (!hasFeature("cross-script")) return PRO_REQUIRED("cross-script")
    return analyzeCrossScript(projectPath)
  })

  ipcMain.handle("analysis:perf-lint", (_, projectPath: string) => {
    if (!hasFeature("perf-lint")) return PRO_REQUIRED("perf-lint")
    return performanceLint(projectPath)
  })

  ipcMain.handle("analysis:perf-lint-file", (_, filePath: string, content: string) => {
    if (!hasFeature("perf-lint")) return PRO_REQUIRED("perf-lint")
    return performanceLintFile(filePath, content)
  })

  // ── DataStore Schema [Pro] ────────────────────────────────────────────────
  ipcMain.handle("datastore:load-schemas", (_, projectPath: string) => {
    if (!hasFeature("datastore-schema")) return PRO_REQUIRED("datastore-schema")
    return loadSchemas(projectPath)
  })

  ipcMain.handle("datastore:save-schema", (_, projectPath: string, schema: DataStoreSchema) => {
    if (!hasFeature("datastore-schema")) return PRO_REQUIRED("datastore-schema")
    return addSchema(projectPath, schema)
  })

  ipcMain.handle("datastore:delete-schema", (_, projectPath: string, name: string) => {
    if (!hasFeature("datastore-schema")) return PRO_REQUIRED("datastore-schema")
    return deleteSchema(projectPath, name)
  })

  ipcMain.handle("datastore:generate-code", (_, schema: DataStoreSchema) => {
    if (!hasFeature("datastore-schema")) return PRO_REQUIRED("datastore-schema")
    return generateDataModule(schema)
  })

  ipcMain.handle("datastore:generate-migration", (_, oldSchema: DataStoreSchema, newSchema: DataStoreSchema) => {
    if (!hasFeature("datastore-schema")) return PRO_REQUIRED("datastore-schema")
    return generateMigration(oldSchema, newSchema)
  })

  // ── Custom Skills (Free) ────────────────────────────────────────────────────
  // Two formats supported, both merged:
  //   (1) Legacy JSON: `.luano/skills.json` — array of Skill objects.
  //   (2) Markdown: `.luano/skills/*.md` (project) AND `~/.luano/skills/*.md` (global)
  //       Matches Claude Code's format — frontmatter (name, description) + body is the prompt.
  ipcMain.handle("skills:load", (_, projectPath: string) => {
    const skills: Array<Record<string, unknown>> = []

    // (1) Legacy JSON
    const jsonPath = join(projectPath, ".luano", "skills.json")
    if (existsSync(jsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(jsonPath, "utf-8"))
        if (Array.isArray(parsed)) skills.push(...parsed)
      } catch { /* bad json, skip */ }
    }

    // (2) Markdown, per-project then global. Project skills override global on name conflict.
    const globalDir = join(homedir(), ".luano", "skills")
    const projectDir = join(projectPath, ".luano", "skills")
    const seen = new Set<string>(skills.map((s) => String(s.command ?? "")).filter(Boolean))

    for (const dir of [globalDir, projectDir]) {
      if (!existsSync(dir)) continue
      let entries: string[] = []
      try { entries = readdirSync(dir).filter((f) => f.endsWith(".md")) } catch { continue }
      for (const fname of entries) {
        const full = join(dir, fname)
        let raw: string
        try { raw = readFileSync(full, "utf-8") } catch { continue }
        const parsed = parseMarkdownSkill(raw, fname)
        if (!parsed) continue
        // Project dir runs after global, so duplicates (same command) override.
        const existing = skills.findIndex((s) => s.command === parsed.command)
        if (existing >= 0) skills[existing] = parsed
        else if (!seen.has(parsed.command)) { skills.push(parsed); seen.add(parsed.command) }
      }
    }
    return skills
  })

  ipcMain.handle("skills:save", (_, projectPath: string, skills: unknown[]) => {
    const dir = join(projectPath, ".luano")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "skills.json"), JSON.stringify(skills, null, 2), "utf-8")
    return { success: true }
  })

  // ── Telemetry (AI sqlite, local only) ─────────────────────────────────────
  ipcMain.handle("telemetry:is-enabled", () => telemetryEnabled())
  ipcMain.handle("telemetry:set-enabled", (_, enabled: unknown) => {
    setTelemetry(enabled === true)
    return { success: true }
  })
  ipcMain.handle("telemetry:stats", () => telemetryStats())

  // ── Crash Reports (Sentry, separate consent) ──────────────────────────────
  // `crashReports` is a distinct store key from `telemetryEnabled` so users
  // can opt into crash reports without sharing AI training data, and vice
  // versa. Sentry SDK is only initialised if `crashReports === true` at app
  // launch, so toggling ON here takes effect on next launch (told via a
  // restart hint in the renderer dialog). Toggling OFF takes effect
  // immediately — `beforeSend` re-checks the store every event.
  ipcMain.handle("crash-reports:is-enabled", () => store.get("crashReports") === true)
  ipcMain.handle("crash-reports:set-enabled", (_, enabled: unknown) => {
    // Coerce so a buggy/compromised renderer can't poison the store with
    // strings, objects, etc. Only true ever enables; everything else is off.
    store.set("crashReports", enabled === true)
    return { success: true }
  })
  ipcMain.handle("crash-reports:is-prompted", () => store.get("crashReportsPrompted") === true)
  ipcMain.handle("crash-reports:mark-prompted", () => {
    store.set("crashReportsPrompted", true)
    return { success: true }
  })

  // ── Third-Party Licenses ──────────────────────────────────────────────────
  // Hands the bundled THIRD_PARTY_LICENSES.txt to the user's default text
  // viewer. File lives under process.resourcesPath in packaged builds and
  // under the repo's resources/ folder in dev so either environment works.
  ipcMain.handle("licenses:open", async () => {
    const prodPath = join(process.resourcesPath ?? app.getAppPath(), "THIRD_PARTY_LICENSES.txt")
    const devPath = join(app.getAppPath(), "resources", "THIRD_PARTY_LICENSES.txt")
    const target = existsSync(prodPath) ? prodPath : existsSync(devPath) ? devPath : null
    if (!target) return { success: false, error: "licenses file not found" }
    const err = await shell.openPath(target)
    return err ? { success: false, error: err } : { success: true }
  })

  // ── Batch Operations ─────────────────────────────────────────────────────
  ipcMain.handle("batch:format-all", async (_, projectPath: string) => {
    const activeFmt = getActiveTool("formatter", projectPath)
    if (activeFmt !== "stylua") return { formatted: 0, failed: 0, total: 0 }
    const files = collectLuauFiles(projectPath)
    let formatted = 0
    let failed = 0
    for (const f of files) {
      try {
        const ok = await formatFile(f)
        if (ok) formatted++; else failed++
      } catch { failed++ }
    }
    return { formatted, failed, total: files.length }
  })

  ipcMain.handle("batch:lint-all", async (_, projectPath: string) => {
    const activeLint = getActiveTool("linter", projectPath)
    if (activeLint !== "selene") return { results: [], total: 0 }
    const files = collectLuauFiles(projectPath)
    const results: Array<{ file: string; diagnostics: unknown }> = []
    for (const f of files) {
      try {
        const diag = await lintFile(f)
        results.push({ file: f, diagnostics: diag })
      } catch { /* skip */ }
    }
    return { results, total: files.length }
  })

  // ── Performance Monitoring ───────────────────────────────────────────────
  ipcMain.handle("perf:stats", () => {
    const mem = process.memoryUsage()
    return {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
      uptime: Math.round(process.uptime())
    }
  })

  // ── Toolchain ───────────────────────────────────────────────────────────
  ipcMain.handle("toolchain:registry", () => ({
    tools: TOOL_REGISTRY,
    categories: CATEGORIES
  }))

  ipcMain.handle("toolchain:get-config", (_, projectPath?: string, projectOnly?: boolean) =>
    getToolchainConfig(projectPath, projectOnly)
  )

  ipcMain.handle("toolchain:set-tool", (_, category: ToolCategory, toolId: string | null, projectPath?: string) => {
    if (projectPath) {
      setProjectTool(projectPath, category, toolId)
    } else {
      setGlobalDefault(category, toolId)
    }

    // Restart sync if the sync tool was changed and a project is active
    if (category === "sync" && projectPath && toolId) {
      try {
        syncManager.serve(projectPath)
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }

    return { success: true }
  })

  ipcMain.handle("toolchain:download", async (_, toolId: string) => {
    return downloadTool(toolId)
  })

  ipcMain.handle("toolchain:remove", (_, toolId: string) => {
    return removeTool(toolId)
  })

  ipcMain.handle("toolchain:download-status", (_, toolId: string) => {
    return { status: getDownloadStatus(toolId) }
  })

  ipcMain.handle("toolchain:check-updates", (_, installedIds: string[]) =>
    checkToolUpdates(installedIds)
  )

  ipcMain.handle("toolchain:fetch-metadata", () =>
    fetchToolMetadata()
  )

  ipcMain.handle("toolchain:update-tool", (_, toolId: string, downloadUrl: string, latestVersion?: string) =>
    updateTool(toolId, downloadUrl, latestVersion)
  )

  ipcMain.handle("toolchain:download-multiple", async (_, toolIds: string[]) =>
    downloadMultiple(toolIds)
  )

  ipcMain.handle("toolchain:is-minimum-ready", () =>
    isMinimumToolchainReady()
  )

  ipcMain.handle("toolchain:has-project-config", (_, projectPath: string) =>
    hasProjectConfig(projectPath)
  )

  ipcMain.handle("toolchain:init-project-config", (_, projectPath: string) => {
    initProjectConfig(projectPath)
    return { success: true }
  })
}
