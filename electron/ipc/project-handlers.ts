import { ipcMain, dialog, app } from "electron"
import { join } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { is } from "@electron-toolkit/utils"
import { syncManager, lspManager } from "../main"
import { readDir, readFile, writeFile, createFile, createFolder, renameEntry, deleteEntry, moveEntry, initProject } from "../file/project"
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
import { isPro } from "../pro"
import { activateLicense, deactivateLicense, getLicenseInfo, validateLicense as revalidateLicense } from "../pro/license"
import { getToolchainConfig, getActiveTool, setProjectTool, setGlobalDefault, isMinimumToolchainReady, hasProjectConfig, initProjectConfig } from "../toolchain/config"
import { downloadTool, downloadMultiple, getDownloadStatus, removeTool, checkToolUpdates, updateTool, fetchToolMetadata } from "../toolchain/downloader"
import { TOOL_REGISTRY, CATEGORIES, type ToolCategory } from "../toolchain/registry"

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
  ipcMain.handle("license:activate", (_, key: string) => activateLicense(key))
  ipcMain.handle("license:deactivate", () => deactivateLicense())
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
    watchProject(projectPath)
    await lspManager.start(projectPath)
    syncManager.serve(projectPath)
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
  ipcMain.handle("file:read", (_, filePath: string) => readFile(filePath))
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
  ipcMain.handle("file:search", (_, projectPath: string, query: string) => {
    if (!query.trim()) return []
    const results: Array<{ file: string; line: number; text: string }> = []
    const lowerQuery = query.toLowerCase()

    const SEARCH_EXTS = /\.(lua|luau|json|md|toml|txt)$/i
    const SKIP_DIRS = new Set(["node_modules", ".git", "Packages", "DevPackages"])

    const walk = (dir: string): void => {
      if (!existsSync(dir)) return
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }

      for (const entry of entries) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (SEARCH_EXTS.test(entry.name)) {
          try {
            const lines = readFileSync(fullPath, "utf-8").split("\n")
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                results.push({ file: fullPath, line: i + 1, text: lines[i].trim() })
                if (results.length >= 500) return
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
  ipcMain.handle("skills:load", (_, projectPath: string) => {
    const skillsPath = join(projectPath, ".luano", "skills.json")
    if (!existsSync(skillsPath)) return []
    try {
      return JSON.parse(readFileSync(skillsPath, "utf-8"))
    } catch {
      return []
    }
  })

  ipcMain.handle("skills:save", (_, projectPath: string, skills: unknown[]) => {
    const dir = join(projectPath, ".luano")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "skills.json"), JSON.stringify(skills, null, 2), "utf-8")
    return { success: true }
  })

  // ── Telemetry ──────────────────────────────────────────────────────────────
  ipcMain.handle("telemetry:is-enabled", () => telemetryEnabled())
  ipcMain.handle("telemetry:set-enabled", (_, enabled: boolean) => {
    setTelemetry(enabled)
    return { success: true }
  })
  ipcMain.handle("telemetry:stats", () => telemetryStats())

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
