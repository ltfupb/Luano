import { contextBridge, ipcRenderer } from "electron"
import { electronAPI } from "@electron-toolkit/preload"

export interface ToolEvent {
  tool: string
  input: Record<string, unknown>
  output: string
  success: boolean
}

/** Channels the renderer is allowed to listen on via on()/off() */
const ALLOWED_CHANNELS = [
  "file:",
  "bridge:update",
  "ai:token-usage",
  "ai:stream:",
  "ai:agent:",
  "agent:checkpoint-available",
  "terminal:data:",
  "terminal:exit:",
  "rojo:status",
  "updater:",
  "sidecar:",
  "lint:"
]

const api = {
  // ── Pro Status ──────────────────────────────────────────────────────────────
  getProStatus: () => ipcRenderer.invoke("pro:status"),

  // ── License ──────────────────────────────────────────────────────────────
  licenseActivate: (key: string) => ipcRenderer.invoke("license:activate", key),
  licenseDeactivate: () => ipcRenderer.invoke("license:deactivate"),
  licenseInfo: () => ipcRenderer.invoke("license:info"),
  licenseValidate: () => ipcRenderer.invoke("license:validate"),

  // ── Project ──────────────────────────────────────────────────────────────
  openFolder: () => ipcRenderer.invoke("project:open-folder"),
  openProject: (path: string) => ipcRenderer.invoke("project:open", path),
  initProject: (path: string) => ipcRenderer.invoke("project:init", path),

  // ── File ──────────────────────────────────────────────────────────────────
  readFile: (path: string) => ipcRenderer.invoke("file:read", path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke("file:write", path, content),
  readDir: (path: string) => ipcRenderer.invoke("file:read-dir", path),
  watchProject: (path: string) => ipcRenderer.invoke("file:watch", path),
  createFile: (dirPath: string, name: string) => ipcRenderer.invoke("file:create-file", dirPath, name),
  createFolder: (dirPath: string, name: string) => ipcRenderer.invoke("file:create-folder", dirPath, name),
  renameEntry: (oldPath: string, newName: string) => ipcRenderer.invoke("file:rename", oldPath, newName),
  deleteEntry: (entryPath: string) => ipcRenderer.invoke("file:delete", entryPath),
  moveEntry: (srcPath: string) => ipcRenderer.invoke("file:move", srcPath),
  searchFiles: (projectPath: string, query: string) =>
    ipcRenderer.invoke("file:search", projectPath, query),

  // ── Rojo ──────────────────────────────────────────────────────────────────
  rojoServe: (projectPath: string) => ipcRenderer.invoke("rojo:serve", projectPath),
  rojoStop: () => ipcRenderer.invoke("rojo:stop"),
  rojoGetStatus: () => ipcRenderer.invoke("rojo:status"),

  // ── Lint ──────────────────────────────────────────────────────────────────
  formatFile: (path: string) => ipcRenderer.invoke("lint:format", path),
  lintFile: (path: string) => ipcRenderer.invoke("lint:check", path),

  // ── AI Keys ──────────────────────────────────────────────────────────────────
  aiSetKey: (key: string) => ipcRenderer.invoke("ai:setKey", key),
  aiGetKey: () => ipcRenderer.invoke("ai:get-key"),
  aiSetOpenAIKey: (key: string) => ipcRenderer.invoke("ai:set-openai-key", key),
  aiGetOpenAIKey: () => ipcRenderer.invoke("ai:get-openai-key"),
  aiSetProvider: (provider: string) => ipcRenderer.invoke("ai:set-provider", provider),
  aiSetModel: (model: string) => ipcRenderer.invoke("ai:set-model", model),
  aiGetProviderModel: () => ipcRenderer.invoke("ai:get-provider-model"),
  aiGetTokenUsage: () => ipcRenderer.invoke("ai:token-usage"),
  aiResetTokenUsage: () => ipcRenderer.invoke("ai:reset-token-usage"),
  onTokenUsage: (cb: (usage: { input: number; output: number; cacheRead: number }) => void): (() => void) => {
    const handler = (_: unknown, usage: { input: number; output: number; cacheRead: number }) => cb(usage)
    ipcRenderer.on("ai:token-usage", handler)
    return () => ipcRenderer.removeListener("ai:token-usage", handler)
  },

  // ── AI Context ───────────────────────────────────────────────────────────
  buildContext: (projectPath: string, filePath?: string) =>
    ipcRenderer.invoke("ai:build-context", projectPath, filePath),

  // ── AI Chat ───────────────────────────────────────────────────────────────
  aiChat: (messages: unknown[], context: unknown) =>
    ipcRenderer.invoke("ai:chat", messages, context),

  aiChatStream: (
    messages: unknown[],
    context: unknown,
    onChunk: (chunk: string | null) => void
  ): Promise<void> => {
    const channel = `ai:stream:${Date.now()}`
    ipcRenderer.on(channel, (_, chunk) => onChunk(chunk as string | null))
    return ipcRenderer.invoke("ai:chat-stream", messages, context, channel).finally(() => {
      ipcRenderer.removeAllListeners(channel)
    }) as Promise<void>
  },

  // ── Plan Chat ────────────────────────────────────────────────────────────
  aiPlanChat: (messages: unknown[], context: unknown): Promise<string[]> =>
    ipcRenderer.invoke("ai:plan-chat", messages, context),

  // ── Inline Edit (Cmd+K) ───────────────────────────────────────────────────
  inlineEdit: (
    filePath: string,
    fileContent: string,
    instruction: string,
    context: unknown
  ): Promise<string> =>
    ipcRenderer.invoke("ai:inline-edit", filePath, fileContent, instruction, context),

  // ── Agent Chat ────────────────────────────────────────────────────────────
  aiAgentChat: (
    messages: unknown[],
    context: unknown,
    onChunk: (chunk: string | null) => void,
    onTool: (event: ToolEvent) => void,
    onRound?: (info: { round: number; max: number }) => void
  ): Promise<{ modifiedFiles: string[] }> => {
    const channel = `ai:agent:${Date.now()}`
    ipcRenderer.on(channel, (_, chunk) => onChunk(chunk as string | null))
    ipcRenderer.on(`${channel}:tool`, (_, event) => onTool(event as ToolEvent))
    if (onRound) {
      ipcRenderer.on(`${channel}:round`, (_, info) => onRound(info as { round: number; max: number }))
    }
    return ipcRenderer
      .invoke("ai:agent-chat", messages, context, channel)
      .finally(() => {
        ipcRenderer.removeAllListeners(channel)
        ipcRenderer.removeAllListeners(`${channel}:tool`)
        ipcRenderer.removeAllListeners(`${channel}:round`)
      }) as Promise<{ modifiedFiles: string[] }>
  },

  // ── Agent Abort ───────────────────────────────────────────────────────────
  aiAbort: (): void => { ipcRenderer.send("ai:abort") },

  // ── Agent Revert (checkpoint rollback) ──────────────────────────────────
  aiRevert: (): Promise<{ success: boolean; reverted?: string[] }> =>
    ipcRenderer.invoke("agent:revert"),

  // ── Agent Checkpoint listener ───────────────────────────────────────────
  onCheckpointAvailable: (cb: (info: { fileCount: number; files: string[] }) => void): (() => void) => {
    const handler = (_: unknown, info: { fileCount: number; files: string[] }) => cb(info)
    ipcRenderer.on("agent:checkpoint-available", handler)
    return () => ipcRenderer.removeListener("agent:checkpoint-available", handler)
  },

  // ── Studio Bridge (legacy MCP) ────────────────────────────────────────────
  studioGetConsole: (): Promise<string | null> =>
    ipcRenderer.invoke("studio:get-console"),

  studioIsConnected: (): Promise<boolean> =>
    ipcRenderer.invoke("studio:is-connected"),

  // ── Live Bridge ───────────────────────────────────────────────────────────
  bridgeGetTree: () => ipcRenderer.invoke("bridge:get-tree"),
  bridgeGetLogs: () => ipcRenderer.invoke("bridge:get-logs"),
  bridgeIsConnected: (): Promise<boolean> => ipcRenderer.invoke("bridge:is-connected"),
  bridgeClearLogs: () => ipcRenderer.invoke("bridge:clear-logs"),
  bridgeRunScript: (code: string): Promise<{ id: string }> =>
    ipcRenderer.invoke("bridge:run-script", code),
  bridgeGetCommandResult: (id: string) => ipcRenderer.invoke("bridge:get-command-result", id),
  bridgeIsPluginInstalled: (): Promise<boolean> =>
    ipcRenderer.invoke("bridge:is-plugin-installed"),
  bridgeInstallPlugin: (): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke("bridge:install-plugin"),

  // ── Terminal (node-pty) ───────────────────────────────────────────────────
  terminalCreate: (cwd?: string): Promise<{ id: string; error?: string }> =>
    ipcRenderer.invoke("terminal:create", cwd),
  terminalWrite: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke("terminal:write", id, data),
  terminalResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke("terminal:resize", id, cols, rows),
  terminalKill: (id: string): Promise<void> =>
    ipcRenderer.invoke("terminal:kill", id),

  // ── Topology ──────────────────────────────────────────────────────────────
  analyzeTopology: (projectPath: string) =>
    ipcRenderer.invoke("topology:analyze", projectPath),

  // ── Cross-Script Analysis ────────────────────────────────────────────────
  analyzeCrossScript: (projectPath: string) =>
    ipcRenderer.invoke("analysis:cross-script", projectPath),
  perfLint: (projectPath: string) =>
    ipcRenderer.invoke("analysis:perf-lint", projectPath),
  perfLintFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("analysis:perf-lint-file", filePath, content),

  // ── DataStore Schema ─────────────────────────────────────────────────────
  datastoreLoadSchemas: (projectPath: string) =>
    ipcRenderer.invoke("datastore:load-schemas", projectPath),
  datastoreSaveSchema: (projectPath: string, schema: unknown) =>
    ipcRenderer.invoke("datastore:save-schema", projectPath, schema),
  datastoreDeleteSchema: (projectPath: string, name: string) =>
    ipcRenderer.invoke("datastore:delete-schema", projectPath, name),
  datastoreGenerateCode: (schema: unknown): Promise<string> =>
    ipcRenderer.invoke("datastore:generate-code", schema),
  datastoreGenerateMigration: (oldSchema: unknown, newSchema: unknown): Promise<string> =>
    ipcRenderer.invoke("datastore:generate-migration", oldSchema, newSchema),

  // ── Custom Skills ──────────────────────────────────────────────────────────
  skillsLoad: (projectPath: string): Promise<unknown[]> =>
    ipcRenderer.invoke("skills:load", projectPath),
  skillsSave: (projectPath: string, skills: unknown[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("skills:save", projectPath, skills),

  // ── Telemetry ──────────────────────────────────────────────────────────────
  telemetryIsEnabled: () => ipcRenderer.invoke("telemetry:is-enabled"),
  telemetrySetEnabled: (enabled: boolean) => ipcRenderer.invoke("telemetry:set-enabled", enabled),
  telemetryStats: () => ipcRenderer.invoke("telemetry:stats"),

  // ── Error Explainer ───────────────────────────────────────────────────────
  explainError: (errorText: string, context: unknown): Promise<string> =>
    ipcRenderer.invoke("ai:explain-error", errorText, context),

  // ── Auto-update ───────────────────────────────────────────────────────────
  updaterCheck: () => ipcRenderer.invoke("updater:check"),
  updaterDownload: () => ipcRenderer.invoke("updater:download"),
  updaterInstall: () => ipcRenderer.invoke("updater:install"),
  updaterStatus: () => ipcRenderer.invoke("updater:status"),

  // ── AI Evaluator ─────────────────────────────────────────────────────────
  aiEvaluate: (filePath: string, content: string, instruction?: string) =>
    ipcRenderer.invoke("ai:evaluate", filePath, content, instruction),
  aiEvaluateBatch: (files: Array<{ path: string; content: string }>, instruction?: string) =>
    ipcRenderer.invoke("ai:evaluate-batch", files, instruction),

  // ── Performance Monitoring ───────────────────────────────────────────────
  perfStats: () => ipcRenderer.invoke("perf:stats"),

  // ── Batch Operations ─────────────────────────────────────────────────────
  batchFormatAll: (projectPath: string) => ipcRenderer.invoke("batch:format-all", projectPath),
  batchLintAll: (projectPath: string) => ipcRenderer.invoke("batch:lint-all", projectPath),

  // ── Memory ──────────────────────────────────────────────────────────────
  memoryList: (projectPath: string) =>
    ipcRenderer.invoke("memory:list", projectPath),
  memoryAdd: (projectPath: string, type: string, content: string) =>
    ipcRenderer.invoke("memory:add", projectPath, type, content),
  memoryUpdate: (projectPath: string, id: string, content: string) =>
    ipcRenderer.invoke("memory:update", projectPath, id, content),
  memoryDelete: (projectPath: string, id: string) =>
    ipcRenderer.invoke("memory:delete", projectPath, id),
  memoryContext: (projectPath: string): Promise<string> =>
    ipcRenderer.invoke("memory:context", projectPath),
  memoryAutoDetect: (projectPath: string, userMsg: string, assistantMsg: string) =>
    ipcRenderer.invoke("memory:auto-detect", projectPath, userMsg, assistantMsg),

  // ── Project Instructions ────────────────────────────────────────────────
  instructionsLoad: (projectPath: string): Promise<string> =>
    ipcRenderer.invoke("instructions:load", projectPath),

  // ── Context Compression ─────────────────────────────────────────────────
  aiCompressMessages: (messages: Array<{ role: string; content: string }>): Promise<string> =>
    ipcRenderer.invoke("ai:compress-messages", messages),
  aiEstimateTokens: (messages: Array<{ role: string; content: string }>): Promise<number> =>
    ipcRenderer.invoke("ai:estimate-tokens", messages),

  // ── Event Listeners ─────────────────────────────────────────────────────────
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (!ALLOWED_CHANNELS.some((prefix) => channel.startsWith(prefix))) {
      console.warn(`[preload] Blocked listen on unauthorized channel: ${channel}`)
      return () => {}
    }
    const handler = (_: unknown, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => { ipcRenderer.removeListener(channel, handler) }
  },
  off: (channel: string) => {
    if (!ALLOWED_CHANNELS.some((prefix) => channel.startsWith(prefix))) return
    ipcRenderer.removeAllListeners(channel)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI)
    contextBridge.exposeInMainWorld("api", api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}

export type LuanoAPI = typeof api
