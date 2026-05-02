import { contextBridge, ipcRenderer, webFrame } from "electron"

// Preload runs in sandbox mode, so `node:crypto` isn't in the allowed
// module list. The Web Crypto API (`crypto.randomUUID`) ships in every
// Chromium-based renderer context Electron uses and is a drop-in
// replacement for the unique IPC channel IDs we need here.
const randomUUID = (): string => crypto.randomUUID()

export interface ToolEvent {
  tool: string
  input: Record<string, unknown>
  output: string
  success: boolean
}

/**
 * Channels the renderer is allowed to listen on via on()/off().
 *
 * Two entry formats are intentional here:
 *   - Prefix strings (e.g. "file:", "ai:stream:") — matched via startsWith().
 *     These allow any sub-channel under that prefix. Keep prefixes tightly
 *     scoped; a broad prefix like "ai:" would inadvertently permit channels
 *     that have dedicated handling (see ai:todos-updated note below).
 *   - Exact strings (e.g. "bridge:update") — matched by equality for channels
 *     where no sub-channel expansion is needed or desired.
 *
 * NOTE: "ai:todos-updated" is NOT listed here. onTodosUpdated() subscribes
 * directly on ipcRenderer.on() (see below) to keep this channel's typing
 * self-contained. Adding it here would require routing through the generic
 * api.on() handler which loses the typed callback signature. This is an
 * intentional documented bypass — not an oversight.
 */
const ALLOWED_CHANNELS = [
  "file:",
  "bridge:update",
  "bridge:token-invalidated",
  "ai:token-usage",
  "ai:stream:",
  "ai:agent:",
  "ai:history-compressed",
  "agent:checkpoint-available",
  "terminal:data:",
  "terminal:exit:",
  "sync:",
  "updater:",
  "sidecar:",
  "lint:",
  "toolchain:",
  "menu:",
  "window:"
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
  closeProject: () => ipcRenderer.invoke("project:close"),
  initProject: (path: string) => ipcRenderer.invoke("project:init", path),
  untrustProject: (path: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("project:untrust", path),

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

  // ── Sync (Rojo / Argon) ──────────────────────────────────────────────────
  syncServe: (projectPath: string) => ipcRenderer.invoke("sync:serve", projectPath),
  syncStop: () => ipcRenderer.invoke("sync:stop"),
  syncGetStatus: () => ipcRenderer.invoke("sync:status"),

  // ── Lint ──────────────────────────────────────────────────────────────────
  formatFile: (path: string) => ipcRenderer.invoke("lint:format", path),
  lintFile: (path: string) => ipcRenderer.invoke("lint:check", path),

  // ── AI Keys ──────────────────────────────────────────────────────────────────
  aiSetKey: (key: string) => ipcRenderer.invoke("ai:setKey", key),
  aiGetKey: () => ipcRenderer.invoke("ai:get-key"),
  aiSetOpenAIKey: (key: string) => ipcRenderer.invoke("ai:set-openai-key", key),
  aiGetOpenAIKey: () => ipcRenderer.invoke("ai:get-openai-key"),
  aiSetGeminiKey: (key: string) => ipcRenderer.invoke("ai:set-gemini-key", key),
  aiGetGeminiKey: () => ipcRenderer.invoke("ai:get-gemini-key"),
  aiSetLocalEndpoint: (endpoint: string) => ipcRenderer.invoke("ai:set-local-endpoint", endpoint),
  aiGetLocalEndpoint: () => ipcRenderer.invoke("ai:get-local-endpoint"),
  aiSetLocalKey: (key: string) => ipcRenderer.invoke("ai:set-local-key", key),
  aiGetLocalKey: () => ipcRenderer.invoke("ai:get-local-key"),
  aiSetLocalModel: (model: string) => ipcRenderer.invoke("ai:set-local-model", model),
  aiGetLocalModel: () => ipcRenderer.invoke("ai:get-local-model"),
  aiFetchLocalModels: () => ipcRenderer.invoke("ai:fetch-local-models"),
  aiSetProvider: (provider: string) => ipcRenderer.invoke("ai:set-provider", provider),
  aiSetModel: (model: string) => ipcRenderer.invoke("ai:set-model", model),
  aiGetProviderModel: () => ipcRenderer.invoke("ai:get-provider-model"),
  aiSetAdvisor: (enabled: boolean) => ipcRenderer.invoke("ai:set-advisor", enabled),
  aiGetAdvisor: () => ipcRenderer.invoke("ai:get-advisor"),
  aiSetThinkingEffort: (effort: string) => ipcRenderer.invoke("ai:set-thinking-effort", effort),
  aiGetThinkingEffort: () => ipcRenderer.invoke("ai:get-thinking-effort"),
  aiSetAutoAccept: (enabled: boolean) => ipcRenderer.invoke("ai:set-auto-accept", enabled),
  aiGetAutoAccept: () => ipcRenderer.invoke("ai:get-auto-accept"),
  managedFetchUsage: () => ipcRenderer.invoke("managed:fetch-usage"),
  onManagedCapExceeded: (cb: () => void): (() => void) => {
    const handler = () => cb()
    ipcRenderer.on("managed:cap-exceeded", handler)
    return () => ipcRenderer.removeListener("managed:cap-exceeded", handler)
  },
  onManagedRequestCompleted: (cb: (info: {
    duration_ms: number
    cached_ratio: number
    input_tok: number
    output_tok: number
    model: string
  }) => void): (() => void) => {
    const handler = (_: unknown, info: {
      duration_ms: number
      cached_ratio: number
      input_tok: number
      output_tok: number
      model: string
    }) => cb(info)
    ipcRenderer.on("managed:request-completed", handler)
    return () => ipcRenderer.removeListener("managed:request-completed", handler)
  },
  isDirectory: (p: string): Promise<boolean> => ipcRenderer.invoke("file:is-directory", p),
  probeRojo: (folderPath: string): Promise<boolean> => ipcRenderer.invoke("project:probe-rojo", folderPath),
  projectExists: (folderPath: string): Promise<boolean> => ipcRenderer.invoke("project:exists", folderPath),
  menuSetProjectState: (hasProject: boolean) => ipcRenderer.invoke("menu:set-project-state", hasProject),
  aiGetTokenUsage: () => ipcRenderer.invoke("ai:token-usage"),
  aiResetTokenUsage: () => ipcRenderer.invoke("ai:reset-token-usage"),
  onTokenUsage: (cb: (usage: { input: number; output: number; cacheRead: number }) => void): (() => void) => {
    const handler = (_: unknown, usage: { input: number; output: number; cacheRead: number }) => cb(usage)
    ipcRenderer.on("ai:token-usage", handler)
    return () => ipcRenderer.removeListener("ai:token-usage", handler)
  },
  onTodosUpdated: (cb: (todos: Array<{ content: string; status: string }>) => void): (() => void) => {
    const handler = (_: unknown, todos: Array<{ content: string; status: string }>) => cb(todos)
    ipcRenderer.on("ai:todos-updated", handler)
    return () => ipcRenderer.removeListener("ai:todos-updated", handler)
  },
  onHistoryCompressed: (cb: (info: { lossy: boolean; reason: string }) => void): (() => void) => {
    const handler = (_: unknown, info: { lossy: boolean; reason: string }) => cb(info)
    ipcRenderer.on("ai:history-compressed", handler)
    return () => ipcRenderer.removeListener("ai:history-compressed", handler)
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
    onChunk: (chunk: string | null) => void,
    onAdvisor?: (active: boolean) => void,
    onThinking?: (active: boolean) => void
  ): Promise<void> => {
    const channel = `ai:stream:${randomUUID()}`
    ipcRenderer.on(channel, (_, chunk) => onChunk(chunk as string | null))
    if (onAdvisor) {
      ipcRenderer.on(`${channel}:advisor`, (_, active) => onAdvisor(active as boolean))
    }
    if (onThinking) {
      ipcRenderer.on(`${channel}:thinking`, (_, active) => onThinking(active as boolean))
    }
    return ipcRenderer.invoke("ai:chat-stream", messages, context, channel).finally(() => {
      ipcRenderer.removeAllListeners(channel)
      ipcRenderer.removeAllListeners(`${channel}:advisor`)
      ipcRenderer.removeAllListeners(`${channel}:thinking`)
    }) as Promise<void>
  },

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
    onRound?: (info: { round: number; max: number }) => void,
    onAdvisor?: (active: boolean) => void,
    onThinking?: (active: boolean) => void,
    onApprovalRequest?: (req: { id: string; tool: string; input: Record<string, unknown>; preview?: unknown }) => void,
    onAskUserRequest?: (req: { id: string; questions: unknown[] }) => void,
    onApprovalResolved?: (req: { id: string }) => void,
    planMode?: boolean
  ): Promise<{ modifiedFiles: string[] }> => {
    const channel = `ai:agent:${randomUUID()}`
    ipcRenderer.on(channel, (_, chunk) => onChunk(chunk as string | null))
    ipcRenderer.on(`${channel}:tool`, (_, event) => onTool(event as ToolEvent))
    if (onRound) {
      ipcRenderer.on(`${channel}:round`, (_, info) => onRound(info as { round: number; max: number }))
    }
    if (onAdvisor) {
      ipcRenderer.on(`${channel}:advisor`, (_, active) => onAdvisor(active as boolean))
    }
    if (onThinking) {
      ipcRenderer.on(`${channel}:thinking`, (_, active) => onThinking(active as boolean))
    }
    if (onApprovalRequest) {
      ipcRenderer.on(`${channel}:approve-tool`, (_, req) => onApprovalRequest(req as { id: string; tool: string; input: Record<string, unknown>; preview?: unknown }))
    }
    if (onAskUserRequest) {
      ipcRenderer.on(`${channel}:ask-user`, (_, req) => onAskUserRequest(req as { id: string; questions: unknown[] }))
    }
    if (onApprovalResolved) {
      ipcRenderer.on(`${channel}:approve-tool-resolved`, (_, req) => onApprovalResolved(req as { id: string }))
    }
    return ipcRenderer
      .invoke("ai:agent-chat", messages, context, channel, planMode === true)
      .finally(() => {
        ipcRenderer.removeAllListeners(channel)
        ipcRenderer.removeAllListeners(`${channel}:tool`)
        ipcRenderer.removeAllListeners(`${channel}:round`)
        ipcRenderer.removeAllListeners(`${channel}:advisor`)
        ipcRenderer.removeAllListeners(`${channel}:thinking`)
        ipcRenderer.removeAllListeners(`${channel}:approve-tool`)
        ipcRenderer.removeAllListeners(`${channel}:ask-user`)
        ipcRenderer.removeAllListeners(`${channel}:approve-tool-resolved`)
      }) as Promise<{ modifiedFiles: string[] }>
  },

  // ── Agent Abort ───────────────────────────────────────────────────────────
  aiAbort: (): void => { ipcRenderer.send("ai:abort") },

  // ── Tool Approval (destructive ops) ──────────────────────────────────────
  sendToolApproval: (id: string, approved: boolean): void =>
    ipcRenderer.send("ai:tool-approval", { id, approved }),

  // ── Ask User (interactive question UI) ───────────────────────────────────
  sendAskUserResponse: (id: string, answers: Record<string, string>): void =>
    ipcRenderer.send("ai:ask-user-response", { id, answers }),

  // ── Agent Revert (checkpoint rollback) ──────────────────────────────────
  aiRevert: (): Promise<{ success: boolean; reverted?: string[] }> =>
    ipcRenderer.invoke("agent:revert"),

  // ── Agent Checkpoint listener ───────────────────────────────────────────
  onCheckpointAvailable: (cb: (info: { fileCount: number; files: string[] }) => void): (() => void) => {
    const handler = (_: unknown, info: { fileCount: number; files: string[] }) => cb(info)
    ipcRenderer.on("agent:checkpoint-available", handler)
    return () => ipcRenderer.removeListener("agent:checkpoint-available", handler)
  },

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
  bridgeGetToken: (): Promise<string | { success: false; error: string; message: string }> =>
    ipcRenderer.invoke("bridge:get-token"),
  onBridgeTokenInvalidated: (cb: () => void): (() => void) => {
    const handler = () => cb()
    ipcRenderer.on("bridge:token-invalidated", handler)
    return () => ipcRenderer.removeListener("bridge:token-invalidated", handler)
  },

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
  // Parameter types are intentionally `unknown` here — the renderer's typed
  // contract lives in src/types/ipc/datastore.d.ts (DatastoreApi) which
  // augments Window.api with the precise shape. Preload's job is to forward
  // the IPC call; ambient renderer-side types aren't visible to tsconfig.node.
  datastoreLoadSchemas: (projectPath: string) =>
    ipcRenderer.invoke("datastore:load-schemas", projectPath),
  datastoreSaveSchema: (projectPath: string, schema: unknown) =>
    ipcRenderer.invoke("datastore:save-schema", projectPath, schema),
  datastoreDeleteSchema: (projectPath: string, name: string) =>
    ipcRenderer.invoke("datastore:delete-schema", projectPath, name),
  datastoreGenerateCode: (schema: unknown) =>
    ipcRenderer.invoke("datastore:generate-code", schema),
  datastoreGenerateMigration: (oldSchema: unknown, newSchema: unknown) =>
    ipcRenderer.invoke("datastore:generate-migration", oldSchema, newSchema),

  // ── Custom Skills ──────────────────────────────────────────────────────────
  skillsLoad: (projectPath: string): Promise<unknown[]> =>
    ipcRenderer.invoke("skills:load", projectPath),
  skillsSave: (projectPath: string, skills: unknown[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("skills:save", projectPath, skills),

  // ── Telemetry (AI sqlite, local only) ─────────────────────────────────────
  telemetryIsEnabled: () => ipcRenderer.invoke("telemetry:is-enabled"),
  telemetrySetEnabled: (enabled: boolean) => ipcRenderer.invoke("telemetry:set-enabled", enabled),
  telemetryStats: () => ipcRenderer.invoke("telemetry:stats"),

  // ── Crash Reports (Sentry, separate consent) ──────────────────────────────
  crashReportsIsEnabled: (): Promise<boolean> => ipcRenderer.invoke("crash-reports:is-enabled"),
  crashReportsSetEnabled: (enabled: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("crash-reports:set-enabled", enabled),
  crashReportsIsPrompted: (): Promise<boolean> => ipcRenderer.invoke("crash-reports:is-prompted"),
  crashReportsMarkPrompted: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("crash-reports:mark-prompted"),

  // ── Usage Analytics (PostHog) — independent of crashReports ─────────────
  analyticsUsageIsEnabled: (): Promise<boolean> => ipcRenderer.invoke("analytics-usage:is-enabled"),
  analyticsUsageSetEnabled: (enabled: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("analytics-usage:set-enabled", enabled),

  // ── Third-Party Licenses ──────────────────────────────────────────────────
  licensesOpen: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("licenses:open"),

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

  // ── Project Instructions ────────────────────────────────────────────────
  instructionsLoad: (projectPath: string): Promise<string> =>
    ipcRenderer.invoke("instructions:load", projectPath),

  // ── Context Compression ─────────────────────────────────────────────────
  aiCompressMessages: (messages: Array<{ role: string; content: string }>): Promise<string> =>
    ipcRenderer.invoke("ai:compress-messages", messages),
  aiEstimateTokens: (messages: Array<{ role: string; content: string }>): Promise<number> =>
    ipcRenderer.invoke("ai:estimate-tokens", messages),

  // ── Toolchain ──────────────────────────────────────────────────────────────
  toolchainRegistry: () => ipcRenderer.invoke("toolchain:registry"),
  toolchainGetConfig: (projectPath?: string, projectOnly?: boolean) =>
    ipcRenderer.invoke("toolchain:get-config", projectPath, projectOnly),
  toolchainSetTool: (category: string, toolId: string | null, projectPath?: string) =>
    ipcRenderer.invoke("toolchain:set-tool", category, toolId, projectPath),
  toolchainDownload: (toolId: string) =>
    ipcRenderer.invoke("toolchain:download", toolId),
  toolchainRemove: (toolId: string) =>
    ipcRenderer.invoke("toolchain:remove", toolId),
  toolchainDownloadStatus: (toolId: string) =>
    ipcRenderer.invoke("toolchain:download-status", toolId),
  toolchainCheckUpdates: (installedIds: string[]) =>
    ipcRenderer.invoke("toolchain:check-updates", installedIds),
  toolchainFetchMetadata: () =>
    ipcRenderer.invoke("toolchain:fetch-metadata"),
  // M3: downloadUrl removed — the handler ignores renderer-supplied URLs to
  // prevent arbitrary-origin downloads. latestVersion is the only param needed.
  toolchainUpdateTool: (toolId: string, latestVersion?: string) =>
    ipcRenderer.invoke("toolchain:update-tool", toolId, latestVersion),
  toolchainDownloadMultiple: (toolIds: string[]) =>
    ipcRenderer.invoke("toolchain:download-multiple", toolIds),
  toolchainIsMinimumReady: () =>
    ipcRenderer.invoke("toolchain:is-minimum-ready"),
  toolchainHasProjectConfig: (projectPath: string) =>
    ipcRenderer.invoke("toolchain:has-project-config", projectPath),
  toolchainInitProjectConfig: (projectPath: string) =>
    ipcRenderer.invoke("toolchain:init-project-config", projectPath),

  // ── Package Manager (Wally / pesde) ────────────────────────────────────────
  packageManagerRun: (
    projectPath: string,
    command: "init" | "install" | "update" | "add",
    packageName?: string
  ) => ipcRenderer.invoke("package-manager:run", projectPath, command, packageName),
  packageManagerMigrateToPesde: (projectPath: string) =>
    ipcRenderer.invoke("package-manager:migrate-to-pesde", projectPath),
  packageManagerMigrateToWally: (projectPath: string, options?: { force?: boolean }) =>
    ipcRenderer.invoke("package-manager:migrate-to-wally", projectPath, options),

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
  },

  // ── UI Scale ──────────────────────────────────────────────────────────────
  setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),

  // ── Window / Titlebar ────────────────────────────────────────────────────
  // Exposed to the renderer because the OS draws min/max/close *inside* our
  // titlebar (titleBarOverlay) — it can't read our CSS variables, so theme
  // changes need to be pushed.
  platform: process.platform,
  setTitleBarOverlay: (opts: { color: string; symbolColor: string }): Promise<void> =>
    ipcRenderer.invoke("window:set-overlay-colors", opts),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:is-maximized"),

  // ── Sentry context (sync, called once at renderer boot) ──────────────────
  sentryGetContext: (): {
    anonymousId: string
    version: string
    environment: string
    crashReportsEnabled: boolean
    analyticsEnabled: boolean
  } | null => {
    try {
      return ipcRenderer.sendSync("sentry:context-sync") as {
        anonymousId: string
        version: string
        environment: string
        crashReportsEnabled: boolean
        analyticsEnabled: boolean
      }
    } catch {
      // Main process has Sentry disabled (no DSN) — handler isn't registered.
      return null
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("api", api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}

export type LuanoAPI = typeof api
