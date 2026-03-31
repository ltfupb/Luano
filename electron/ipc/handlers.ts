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
  chat, chatStream, inlineEdit, agentChat, planChat, abortAgent,
  setApiKey, getApiKey,
  setOpenAIKey, getOpenAIKey,
  setProvider, setModel, getProviderAndModel,
  MODELS
} from "../ai/provider"
import { isPro, hasFeature, type ProFeature } from "../pro"

// ── Pro modules (centralized loader — gracefully absent in Community edition) ─
import {
  buildGlobalSummary, buildSystemPrompt, buildDocsContext,
  analyzeTopology, analyzeCrossScript,
  performanceLint, performanceLintFile,
  loadSchemas, addSchema, deleteSchema, generateDataModule, generateMigration,
  getConsoleOutput, isStudioConnected,
  telemetryEnabled, setTelemetry, telemetryStats, recordDiff, recordQuery,
  getBridgeTree, getBridgeLogs, isBridgeConnected, clearBridgeLogs,
  queueScript, getCommandResult,
  getLastCheckpoint, revertCheckpoint,
  type DataStoreSchema
} from "../pro/modules"

// Track AI-generated file contents for telemetry diff comparison
const aiGeneratedFiles = new Map<string, string>()

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

  // ── AI 컨텍스트 ───────────────────────────────────────────────────────────
  ipcMain.handle("ai:build-context", async (_, projectPath: string) => {
    const globalSummary = await buildGlobalSummary(projectPath)
    return { globalSummary }
  })

  // ── AI 채팅 (기본) ────────────────────────────────────────────────────────
  ipcMain.handle("ai:chat", async (_, messages: unknown[], contextData: unknown) => {
    const ctx = contextData as {
      globalSummary: string
      currentFile?: string
      currentFileContent?: string
    }
    const systemPrompt = buildSystemPrompt({
      globalSummary: ctx.globalSummary ?? "",
      currentFile: ctx.currentFile,
      currentFileContent: ctx.currentFileContent
    })
    return chat(messages as never, systemPrompt)
  })

  ipcMain.handle(
    "ai:chat-stream",
    async (_, messages: unknown[], contextData: unknown, streamChannel: string) => {
      const ctx = contextData as {
        globalSummary: string
        currentFile?: string
        currentFileContent?: string
        attachedFiles?: Array<{ path: string; content: string }>
      }

      // RAG: 마지막 유저 메시지로 문서 검색
      const msgList = messages as Array<{ role: string; content: string }>
      const lastMsg = [...msgList].reverse().find((m) => m.role === "user")
      const docsContext = lastMsg ? await buildDocsContext(lastMsg.content) : ""

      const systemPrompt = buildSystemPrompt({
        globalSummary: ctx.globalSummary ?? "",
        currentFile: ctx.currentFile,
        currentFileContent: ctx.currentFileContent,
        docsContext: docsContext || undefined,
        attachedFiles: ctx.attachedFiles
      })

      await chatStream(messages as never, systemPrompt, streamChannel)
      const userQuery = lastMsg?.content ?? ""
      recordQuery({ userQuery, apisReferenced: [], ragHit: !!docsContext })
      return { success: true }
    }
  )

  // ── Plan Chat ─────────────────────────────────────────────────────────────
  ipcMain.handle("ai:plan-chat", async (_, messages: unknown[], contextData: unknown) => {
    const ctx = contextData as {
      globalSummary: string
      currentFile?: string
      currentFileContent?: string
    }
    const msgList = messages as Array<{ role: string; content: string }>
    const lastMsg = [...msgList].reverse().find((m) => m.role === "user")
    const docsContext = lastMsg ? await buildDocsContext(lastMsg.content) : ""
    const systemPrompt = buildSystemPrompt({
      globalSummary: ctx.globalSummary ?? "",
      currentFile: ctx.currentFile,
      currentFileContent: ctx.currentFileContent,
      docsContext: docsContext || undefined
    })
    return planChat(messages as never, systemPrompt)
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
      const ctx = contextData as {
        globalSummary: string
        currentFile?: string
        currentFileContent?: string
        attachedFiles?: Array<{ path: string; content: string }>
      }

      const msgList = messages as Array<{ role: string; content: string }>
      const lastMsg = [...msgList].reverse().find((m) => m.role === "user")
      const docsContext = lastMsg ? await buildDocsContext(lastMsg.content) : ""

      // Phase 4: include live Studio state when bridge is connected
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

      const systemPrompt = buildSystemPrompt({
        globalSummary: ctx.globalSummary ?? "",
        currentFile: ctx.currentFile,
        currentFileContent: ctx.currentFileContent,
        docsContext: docsContext || undefined,
        bridgeContext,
        attachedFiles: ctx.attachedFiles
      })

      const result = await agentChat(messages as never, systemPrompt, streamChannel)
      recordQuery({ userQuery: lastMsg?.content ?? "", apisReferenced: [], ragHit: !!docsContext })

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

  ipcMain.handle("bridge:install-plugin", () => {
    try {
      const resourcesDir = is.dev
        ? join(app.getAppPath(), "resources")
        : process.resourcesPath
      const srcPath = join(resourcesDir, "studio-plugin/LuanoPlugin.lua")

      // Windows: %LOCALAPPDATA%\Roblox\Plugins
      const localAppData = process.env["LOCALAPPDATA"] ?? join(app.getPath("home"), "AppData", "Local")
      const pluginsDir = join(localAppData, "Roblox", "Plugins")

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

  // ── Error Explainer ───────────────────────────────────────────────────────
  ipcMain.handle("ai:explain-error", async (_, errorText: string, contextData: unknown) => {
    const ctx = contextData as { globalSummary: string; projectPath?: string }
    const systemPrompt = buildSystemPrompt({ globalSummary: ctx.globalSummary ?? "" })

    return chat(
      [
        {
          role: "user",
          content: `Explain the following Roblox Studio error. Include possible causes and how to fix it:\n\n${errorText}`
        }
      ],
      systemPrompt
    )
  })
}
