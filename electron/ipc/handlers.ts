import { ipcMain, dialog, app, BrowserWindow, WebContents } from "electron"
import { join } from "path"
import { copyFileSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs"
import { is } from "@electron-toolkit/utils"
import * as pty from "node-pty"
import { rojoManager, lspManager } from "../main"
import { readDir, readFile, writeFile, createFile, createFolder, renameEntry, deleteEntry, moveEntry, initProject } from "../file/project"
import { watchProject } from "../file/watcher"
import { lintFile } from "../sidecar/selene"
import { formatFile } from "../sidecar/stylua"
import {
  chat, chatStream, planChat, abortAgent,
  setApiKey,
  setOpenAIKey, getOpenAIKey,
  setProvider, setModel, getProviderAndModel,
  MODELS, getTokenUsage, resetTokenUsage
} from "../ai/provider"
import { isPro, hasFeature, type ProFeature } from "../pro"
import { activateLicense, deactivateLicense, getLicenseInfo, validateLicense as revalidateLicense } from "../pro/license"
import {
  getMemories, addMemory, updateMemory, deleteMemory,
  buildMemoryContext, loadInstructions,
  buildMemoryDetectPrompt, parseMemoryDetectResponse,
  estimateMessagesTokens, buildCompressionPrompt,
  type MemoryType
} from "../ai/memory"

// ── Pro modules (centralized loader — gracefully absent in Community edition) ─
import {
  agentChat, inlineEdit,
  buildGlobalSummary, buildSystemPrompt, buildDocsContext,
  analyzeTopology, analyzeCrossScript,
  performanceLint, performanceLintFile,
  loadSchemas, addSchema, deleteSchema, generateDataModule, generateMigration,
  getConsoleOutput, isStudioConnected,
  telemetryEnabled, setTelemetry, telemetryStats, recordDiff, recordQuery,
  getBridgeTree, getBridgeLogs, isBridgeConnected, clearBridgeLogs,
  queueScript, getCommandResult,
  getLastCheckpoint, revertCheckpoint,
  evaluateCode, evaluateFiles,
  type DataStoreSchema
} from "../pro/modules"

// Track AI-generated file contents for telemetry diff comparison
const aiGeneratedFiles = new Map<string, string>()

/** Common shape for AI context data from renderer */
interface AIContext {
  globalSummary: string
  projectPath?: string
  currentFile?: string
  currentFileContent?: string
  docsContext?: string
  sessionHandoff?: string
  attachedFiles?: Array<{ path: string; content: string }>
  memories?: string
  instructions?: string
}

/** Extract last user message and build RAG docs context */
async function buildRAGContext(messages: unknown[]): Promise<{ lastUserMsg: string; docsContext: string }> {
  const msgList = messages as Array<{ role: string; content: string }>
  const lastMsg = [...msgList].reverse().find((m) => m.role === "user")
  const lastUserMsg = lastMsg?.content ?? ""
  const docsContext = lastUserMsg ? await buildDocsContext(lastUserMsg) : ""
  return { lastUserMsg, docsContext }
}

/** Read .luano/progress.md if it exists, for agent session continuity */
function readProgressFile(projectPath?: string): string {
  if (!projectPath) return ""
  const progressPath = join(projectPath, ".luano", "progress.md")
  if (!existsSync(progressPath)) return ""
  try {
    const content = readFileSync(progressPath, "utf-8").trim()
    return content ? `\n\nPrevious progress notes:\n${content}` : ""
  } catch { return "" }
}

const PROGRESS_INSTRUCTION = `# Progress tracking
For multi-step tasks, maintain a progress file at .luano/progress.md in the project root. Update it after each major step with: what was done, what remains, and any decisions made.`

/**
 * Build a complete system prompt with all context layers.
 *
 * Layer order (matches Claude Code's prompt structure):
 *   1. Base system prompt (identity + context + tone — from buildSystemPrompt)
 *   2. Project instructions (LUANO.md — user-defined, like CLAUDE.md)
 *   3. Memories (persistent cross-session context)
 *   4. Progress tracking (agent mode only)
 *   5. Session handoff (compressed context from prior session)
 */
function buildFullSystemPrompt(
  ctx: AIContext,
  opts?: { docsContext?: string; bridgeContext?: string; includeProgress?: boolean }
): string {
  const layers = [
    buildSystemPrompt({
      globalSummary: ctx.globalSummary ?? "",
      currentFile: ctx.currentFile,
      currentFileContent: ctx.currentFileContent,
      docsContext: opts?.docsContext || undefined,
      bridgeContext: opts?.bridgeContext,
      attachedFiles: ctx.attachedFiles
    })
  ]

  if (ctx.projectPath) {
    const instructions = loadInstructions(ctx.projectPath)
    if (instructions) layers.push(`# Project instructions\n${instructions}`)
    const memory = buildMemoryContext(ctx.projectPath)
    if (memory) layers.push(memory)
  }

  if (opts?.includeProgress && ctx.projectPath) {
    layers.push(PROGRESS_INSTRUCTION)
    const progress = readProgressFile(ctx.projectPath)
    if (progress) layers.push(progress)
  }

  if (ctx.sessionHandoff) layers.push(`# Session context\n${ctx.sessionHandoff}`)

  // Always append language-matching rule (Pro prompt may omit it)
  layers.push("# Language\nAlways respond in the same language the user writes in.")

  return layers.join("\n\n")
}

/** Recursively collect all .lua/.luau files in a project */
function collectLuauFiles(dir: string): string[] {
  const results: string[] = []
  const SKIP = new Set(["node_modules", ".git", "Packages", "DevPackages"])
  const walk = (d: string): void => {
    if (!existsSync(d)) return
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(lua|luau)$/i.test(e.name)) results.push(full)
    }
  }
  walk(dir)
  return results
}

const PRO_REQUIRED = (feature: ProFeature) => ({
  success: false,
  error: "pro_required",
  feature,
  message: `This feature requires Luano Pro. Upgrade at luano.dev/pricing`
})

// ── Terminal (node-pty) ────────────────────────────────────────────────────────
interface PtyEntry {
  proc: pty.IPty
  sender: WebContents
}
const ptyMap = new Map<string, PtyEntry>()

function spawnPty(id: string, sender: WebContents, cwd?: string): void {
  const shell = process.platform === "win32" ? "powershell.exe" : (process.env["SHELL"] ?? "bash")
  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: cwd ?? process.env["HOME"] ?? process.cwd(),
    env: process.env as Record<string, string>
  })

  ptyMap.set(id, { proc, sender })

  proc.onData((data) => {
    if (!sender.isDestroyed()) {
      sender.send(`terminal:data:${id}`, data)
    }
  })

  proc.onExit(() => {
    ptyMap.delete(id)
    if (!sender.isDestroyed()) {
      sender.send(`terminal:exit:${id}`)
    }
  })
}

export function registerIpcHandlers(): void {
  // ── Pro 상태 ──────────────────────────────────────────────────────────────
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

  // ── 라이센스 ──────────────────────────────────────────────────────────────
  ipcMain.handle("license:activate", (_, key: string) => activateLicense(key))
  ipcMain.handle("license:deactivate", () => deactivateLicense())
  ipcMain.handle("license:info", () => getLicenseInfo())
  ipcMain.handle("license:validate", async () => ({ valid: await revalidateLicense() }))

  // ── 프로젝트 ──────────────────────────────────────────────────────────────
  ipcMain.handle("project:open-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle("project:open", async (_, projectPath: string) => {
    watchProject(projectPath)
    await lspManager.start(projectPath)
    rojoManager.serve(projectPath)
    return { success: true, lspPort: lspManager.getPort() }
  })

  // ── 파일 ──────────────────────────────────────────────────────────────────
  ipcMain.handle("file:read", (_, filePath: string) => readFile(filePath))
  ipcMain.handle("file:write", (_, filePath: string, content: string) => {
    // Telemetry: if this file was AI-generated, record the diff
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
      title: "이동할 폴더 선택"
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true }
    const destPath = moveEntry(srcPath, result.filePaths[0])
    return { success: true, path: destPath }
  })

  ipcMain.handle("project:init", (_, projectPath: string) => {
    const resourcesDir = is.dev
      ? join(app.getAppPath(), "resources")
      : process.resourcesPath
    initProject(projectPath, resourcesDir)
    return { success: true }
  })

  // ── Rojo ──────────────────────────────────────────────────────────────────
  ipcMain.handle("rojo:serve", (_, projectPath: string) => {
    rojoManager.serve(projectPath)
    return { success: true }
  })
  ipcMain.handle("rojo:stop", () => {
    rojoManager.stop()
    return { success: true }
  })
  ipcMain.handle("rojo:status", () => rojoManager.getStatus())

  // ── 린트/포맷 ─────────────────────────────────────────────────────────────
  ipcMain.handle("lint:format", async (_, filePath: string) => {
    const success = await formatFile(filePath)
    return { success }
  })
  ipcMain.handle("lint:check", async (_, filePath: string) => {
    return lintFile(filePath)
  })

  // ── AI 키 관리 ────────────────────────────────────────────────────────────
  ipcMain.handle("ai:setKey", (_, key: string) => {
    setApiKey(key)
    return { success: true }
  })
  ipcMain.handle("ai:set-openai-key", (_, key: string) => {
    setOpenAIKey(key)
    return { success: true }
  })
  ipcMain.handle("ai:get-openai-key", () => {
    const key = getOpenAIKey()
    return key ? "***set***" : null
  })
  ipcMain.handle("ai:set-provider", (_, provider: string) => {
    setProvider(provider as "anthropic" | "openai")
    return { success: true }
  })
  ipcMain.handle("ai:set-model", (_, model: string) => {
    setModel(model)
    return { success: true }
  })
  ipcMain.handle("ai:get-provider-model", () => {
    return { ...getProviderAndModel(), models: MODELS }
  })
  ipcMain.handle("ai:token-usage", () => getTokenUsage())
  ipcMain.handle("ai:reset-token-usage", () => {
    resetTokenUsage()
    return { success: true }
  })

  // ── AI 컨텍스트 ───────────────────────────────────────────────────────────
  ipcMain.handle("ai:build-context", async (_, projectPath: string) => {
    const globalSummary = await buildGlobalSummary(projectPath)
    return { globalSummary }
  })

  // ── AI 채팅 (기본) ────────────────────────────────────────────────────────
  ipcMain.handle("ai:chat", async (_, messages: unknown[], contextData: unknown) => {
    const ctx = contextData as AIContext
    return chat(messages as never, buildFullSystemPrompt(ctx))
  })

  ipcMain.handle(
    "ai:chat-stream",
    async (_, messages: unknown[], contextData: unknown, streamChannel: string) => {
      const ctx = contextData as AIContext
      const { lastUserMsg, docsContext } = await buildRAGContext(messages)
      await chatStream(messages as never, buildFullSystemPrompt(ctx, { docsContext }), streamChannel)
      recordQuery({ userQuery: lastUserMsg, apisReferenced: [], ragHit: !!docsContext })
      return { success: true }
    }
  )

  // ── Plan Chat ─────────────────────────────────────────────────────────────
  ipcMain.handle("ai:plan-chat", async (_, messages: unknown[], contextData: unknown) => {
    const ctx = contextData as AIContext
    const { docsContext } = await buildRAGContext(messages)
    return planChat(messages as never, buildFullSystemPrompt(ctx, { docsContext }))
  })

  // ── Inline Edit (Cmd+K) [Pro] ──────────────────────────────────────────────
  ipcMain.handle(
    "ai:inline-edit",
    async (
      _,
      filePath: string,
      fileContent: string,
      instruction: string,
      contextData: unknown
    ) => {
      if (!hasFeature("inline-edit")) return PRO_REQUIRED("inline-edit")
      const ctx = contextData as { globalSummary: string; currentFile?: string }
      const systemPrompt = buildSystemPrompt({
        globalSummary: ctx.globalSummary ?? "",
        currentFile: filePath
      })
      return inlineEdit(filePath, fileContent, instruction, systemPrompt)
    }
  )

  // ── Agent Abort ────────────────────────────────────────────────────────────
  ipcMain.on("ai:abort", () => { abortAgent() })

  // ── Agent Chat (Tool Use) [Pro] ────────────────────────────────────────────
  ipcMain.handle(
    "ai:agent-chat",
    async (_, messages: unknown[], contextData: unknown, streamChannel: string) => {
      if (!hasFeature("agent")) return PRO_REQUIRED("agent")
      const ctx = contextData as AIContext

      const { lastUserMsg, docsContext } = await buildRAGContext(messages)

      // Include live Studio state when bridge is connected
      let bridgeContext: string | undefined
      if (isBridgeConnected()) {
        const tree = getBridgeTree()
        const logs = getBridgeLogs()
        const lines: string[] = ["Roblox Studio plugin is connected and live."]
        if (tree) {
          const childCount = tree.children?.length ?? 0
          lines.push(`DataModel root: ${tree.name} [${tree.class}] with ${childCount} top-level services.`)
        }
        const recentErrors = (logs as Array<{ kind: string; text: string }>).filter((l) => l.kind === "error").slice(-5)
        if (recentErrors.length > 0) {
          lines.push("Recent Studio errors:")
          recentErrors.forEach((e: { text: string }) => lines.push(`  [ERROR] ${e.text}`))
        }
        lines.push(
          "You can use read_instance_tree, get_runtime_logs, run_studio_script, and set_property tools to interact with the live Studio session."
        )
        bridgeContext = lines.join("\n")
      }

      const fullPrompt = buildFullSystemPrompt(ctx, { docsContext, bridgeContext, includeProgress: true })
      const result = await agentChat(messages as never, fullPrompt, streamChannel)
      recordQuery({ userQuery: lastUserMsg, apisReferenced: [], ragHit: !!docsContext })

      // Track AI-modified files for telemetry diff comparison
      for (const fp of result.modifiedFiles) {
        try {
          const content = readFileSync(fp, "utf-8")
          aiGeneratedFiles.set(fp, content)
        } catch { /* skip unreadable */ }
      }

      // Notify renderer that a checkpoint is available for revert
      if (result.modifiedFiles.length > 0) {
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send("agent:checkpoint-available", {
            fileCount: result.modifiedFiles.length,
            files: result.modifiedFiles
          })
        })
      }

      return result
    }
  )

  // ── Agent Checkpoint Revert ──────────────────────────────────────────────
  ipcMain.handle("agent:revert", async () => {
    const checkpoint = getLastCheckpoint()
    if (!checkpoint) return { success: false, message: "No checkpoint available" }
    const reverted = revertCheckpoint(checkpoint)
    return { success: true, reverted }
  })

  // ── Studio Bridge (legacy MCP) [Pro] ───────────────────────────────────────
  ipcMain.handle("studio:get-console", async () => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    return getConsoleOutput()
  })

  ipcMain.handle("studio:is-connected", async () => {
    if (!hasFeature("studio-bridge")) return false
    return isStudioConnected()
  })

  // ── Live Bridge [Pro] ─────────────────────────────────────────────────────
  ipcMain.handle("bridge:get-tree", () => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    return getBridgeTree()
  })
  ipcMain.handle("bridge:get-logs", () => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    return getBridgeLogs()
  })
  ipcMain.handle("bridge:is-connected", () => {
    return isBridgeConnected()
  })
  ipcMain.handle("bridge:clear-logs", () => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    clearBridgeLogs(); return { success: true }
  })
  ipcMain.handle("bridge:run-script", (_, code: string) => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    const id = queueScript(code)
    return { id }
  })
  ipcMain.handle("bridge:get-command-result", (_, id: string) => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    return getCommandResult(id)
  })

  function getPluginsDir(): string | null {
    if (process.platform === "win32") {
      const localAppData = process.env["LOCALAPPDATA"] ?? join(app.getPath("home"), "AppData", "Local")
      return join(localAppData, "Roblox", "Plugins")
    }
    if (process.platform === "darwin") {
      return join(app.getPath("home"), "Library", "Application Support", "Roblox", "Plugins")
    }
    return null
  }

  ipcMain.handle("bridge:is-plugin-installed", () => {
    const dir = getPluginsDir()
    if (!dir) return false
    return existsSync(join(dir, "LuanoPlugin.lua"))
  })

  ipcMain.handle("bridge:install-plugin", () => {
    try {
      const pluginsDir = getPluginsDir()
      if (!pluginsDir) return { success: false, error: "Roblox Studio plugins not supported on this platform" }

      const resourcesDir = is.dev
        ? join(app.getAppPath(), "resources")
        : process.resourcesPath
      const srcPath = join(resourcesDir, "studio-plugin/LuanoPlugin.lua")

      if (!existsSync(pluginsDir)) {
        mkdirSync(pluginsDir, { recursive: true })
      }

      const destPath = join(pluginsDir, "LuanoPlugin.lua")
      copyFileSync(srcPath, destPath)
      return { success: true, path: destPath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── 파일 검색 ─────────────────────────────────────────────────────────────
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

  // ── Terminal (node-pty) ───────────────────────────────────────────────────
  ipcMain.handle("terminal:create", (event, cwd?: string) => {
    try {
      const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      spawnPty(id, event.sender, cwd)
      return { id }
    } catch (err) {
      return { id: "", error: String(err) }
    }
  })

  ipcMain.handle("terminal:write", (_, id: string, data: string) => {
    ptyMap.get(id)?.proc.write(data)
    return { success: true }
  })

  ipcMain.handle("terminal:resize", (_, id: string, cols: number, rows: number) => {
    ptyMap.get(id)?.proc.resize(cols, rows)
    return { success: true }
  })

  ipcMain.handle("terminal:kill", (_, id: string) => {
    const entry = ptyMap.get(id)
    if (entry) {
      entry.proc.kill()
      ptyMap.delete(id)
    }
    return { success: true }
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

  // ── AI Evaluator [Pro] ────────────────────────────────────────────────────
  ipcMain.handle("ai:evaluate", async (_, filePath: string, content: string, instruction?: string) => {
    if (!hasFeature("agent")) return PRO_REQUIRED("agent")
    return evaluateCode(filePath, content, instruction)
  })

  ipcMain.handle("ai:evaluate-batch", async (_, files: Array<{ path: string; content: string }>, instruction?: string) => {
    if (!hasFeature("agent")) return PRO_REQUIRED("agent")
    return evaluateFiles(files, instruction)
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

  // ── Batch Operations ─────────────────────────────────────────────────────
  ipcMain.handle("batch:format-all", async (_, projectPath: string) => {
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

  // ── Memory ─────────────────────────────────────────────────────────────────

  ipcMain.handle("memory:list", (_, projectPath: string) => getMemories(projectPath))

  ipcMain.handle("memory:add", (_, projectPath: string, type: MemoryType, content: string) =>
    addMemory(projectPath, type, content)
  )

  ipcMain.handle("memory:update", (_, projectPath: string, id: string, content: string) =>
    updateMemory(projectPath, id, content)
  )

  ipcMain.handle("memory:delete", (_, projectPath: string, id: string) =>
    deleteMemory(projectPath, id)
  )

  ipcMain.handle("memory:context", (_, projectPath: string) =>
    buildMemoryContext(projectPath)
  )

  // ── Project Instructions ──────────────────────────────────────────────────

  ipcMain.handle("instructions:load", (_, projectPath: string) =>
    loadInstructions(projectPath)
  )

  // ── Context Compression ───────────────────────────────────────────────────

  ipcMain.handle("ai:compress-messages", async (_, messages: Array<{ role: string; content: string }>) => {
    const prompt = buildCompressionPrompt(messages)
    return chat([{ role: "user", content: prompt }], "You are a concise summarizer.")
  })

  ipcMain.handle("ai:estimate-tokens", (_, messages: Array<{ role: string; content: string }>) =>
    estimateMessagesTokens(messages)
  )

  // ── Auto Memory Detection ─────────────────────────────────────────────────

  ipcMain.handle("memory:auto-detect", async (_, projectPath: string, userMsg: string, assistantMsg: string) => {
    const detectPrompt = buildMemoryDetectPrompt(userMsg, assistantMsg)
    try {
      const response = await chat([{ role: "user", content: detectPrompt }], "You extract memories from conversations. Be very selective.")
      return parseMemoryDetectResponse(response, projectPath)
    } catch {
      return []
    }
  })

  // ── Error Explainer ───────────────────────────────────────────────────────
  ipcMain.handle("ai:explain-error", async (_, errorText: string, contextData: unknown) => {
    const ctx = contextData as AIContext
    return chat(
      [{ role: "user", content: `Explain this Roblox Studio error. Possible causes and fix:\n\n${errorText}` }],
      buildFullSystemPrompt(ctx)
    )
  })
}
