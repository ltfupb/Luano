// Global type augmentations for Luano renderer
// Non-module .d.ts — all declarations are automatically global

// ── Vite ?worker imports ──────────────────────────────────────────────────────
declare module "*?worker" {
  const WorkerConstructor: new () => Worker
  export default WorkerConstructor
}

// ── Topology types ────────────────────────────────────────────────────────────
type ScriptKind = "server" | "client" | "shared"

type EdgeKind =
  | "require"
  | "fire_server"
  | "fire_client"
  | "fire_all"
  | "receives_server"
  | "receives_client"

interface TopologyScriptNode {
  id: string
  name: string
  path: string
  kind: ScriptKind
  group: string
}

interface TopologyRemoteNode {
  id: string
  name: string
}

interface TopologyEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  label?: string
}

interface TopologyResult {
  scripts: TopologyScriptNode[]
  remotes: TopologyRemoteNode[]
  edges: TopologyEdge[]
}

// ── Bridge types ──────────────────────────────────────────────────────────────
interface BridgeInstanceNode {
  name: string
  class: string
  children?: BridgeInstanceNode[]
}

interface BridgeLogEntry {
  text: string
  kind: "output" | "warn" | "error"
  ts: number
}

interface BridgeCommandResult {
  id: string
  success: boolean
  result: string
}

// ── Window.api augmentation ───────────────────────────────────────────────────
interface Window {
  api: {
    // Project
    openFolder: () => Promise<string | null>
    openProject: (path: string) => Promise<{ success: boolean; lspPort: number }>
    initProject: (path: string) => Promise<{ success: boolean }>

    // File
    readFile: (path: string) => Promise<string>
    writeFile: (path: string, content: string) => Promise<{ success: boolean }>
    readDir: (path: string) => Promise<import("./stores/projectStore").FileEntry[]>
    watchProject: (path: string) => Promise<{ success: boolean }>
    createFile: (dirPath: string, name: string) => Promise<{ success: boolean; path: string }>
    createFolder: (dirPath: string, name: string) => Promise<{ success: boolean; path: string }>
    renameEntry: (oldPath: string, newName: string) => Promise<{ success: boolean; path: string }>
    deleteEntry: (entryPath: string) => Promise<{ success: boolean }>
    moveEntry: (srcPath: string) => Promise<{ success: boolean; canceled?: boolean; path?: string }>
    searchFiles: (projectPath: string, query: string) => Promise<Array<{ file: string; line: number; text: string }>>

    // Rojo
    rojoServe: (projectPath: string) => Promise<{ success: boolean }>
    rojoStop: () => Promise<{ success: boolean }>
    rojoGetStatus: () => Promise<string>

    // Lint
    formatFile: (path: string) => Promise<{ success: boolean }>
    lintFile: (path: string) => Promise<unknown>

    // AI Keys
    aiSetKey: (key: string) => Promise<{ success: boolean }>
    aiGetKey: () => Promise<string | null>
    aiSetOpenAIKey: (key: string) => Promise<{ success: boolean }>
    aiGetOpenAIKey: () => Promise<string | null>
    aiSetProvider: (provider: string) => Promise<{ success: boolean }>
    aiSetModel: (model: string) => Promise<{ success: boolean }>
    aiGetProviderModel: () => Promise<{
      provider: string
      model: string
      models: {
        anthropic: Array<{ id: string; label: string }>
        openai: Array<{ id: string; label: string }>
      }
    }>

    // Token usage
    aiGetTokenUsage: () => Promise<{ input: number; output: number; cacheRead: number }>
    aiResetTokenUsage: () => Promise<{ success: boolean }>
    onTokenUsage: (cb: (usage: { input: number; output: number; cacheRead: number }) => void) => () => void

    // AI Context
    buildContext: (projectPath: string, filePath?: string) => Promise<{ globalSummary: string }>

    // AI Chat
    aiChat: (messages: unknown[], context: unknown) => Promise<string>
    aiChatStream: (
      messages: unknown[],
      context: unknown,
      onChunk: (chunk: string | null) => void
    ) => Promise<void>

    // Plan Chat
    aiPlanChat: (messages: unknown[], context: unknown) => Promise<string[]>

    // Inline Edit (Cmd+K)
    inlineEdit: (
      filePath: string,
      fileContent: string,
      instruction: string,
      context: unknown
    ) => Promise<string>

    // Agent Chat (Tool Use)
    aiAgentChat: (
      messages: unknown[],
      context: unknown,
      onChunk: (chunk: string | null) => void,
      onTool: (event: {
        tool: string
        input: Record<string, unknown>
        output: string
        success: boolean
      }) => void,
      onRound?: (info: { round: number; max: number }) => void
    ) => Promise<{ modifiedFiles: string[] }>

    // Agent Abort
    aiAbort: () => void

    // Agent Revert (checkpoint rollback)
    aiRevert: () => Promise<{ success: boolean; reverted?: string[] }>

    // Agent Checkpoint listener
    onCheckpointAvailable: (cb: (info: { fileCount: number; files: string[] }) => void) => () => void

    // Studio Bridge (legacy MCP)
    studioGetConsole: () => Promise<string | null>
    studioIsConnected: () => Promise<boolean>

    // Live Bridge
    bridgeGetTree: () => Promise<BridgeInstanceNode | null>
    bridgeGetLogs: () => Promise<BridgeLogEntry[]>
    bridgeIsConnected: () => Promise<boolean>
    bridgeClearLogs: () => Promise<{ success: boolean }>
    bridgeRunScript: (code: string) => Promise<{ id: string }>
    bridgeGetCommandResult: (id: string) => Promise<BridgeCommandResult | null>
    bridgeIsPluginInstalled: () => Promise<boolean>
    bridgeInstallPlugin: () => Promise<{ success: boolean; path?: string; error?: string }>

    // Terminal (node-pty)
    terminalCreate: (cwd?: string) => Promise<{ id: string; error?: string }>
    terminalWrite: (id: string, data: string) => Promise<void>
    terminalResize: (id: string, cols: number, rows: number) => Promise<void>
    terminalKill: (id: string) => Promise<void>

    // Topology
    analyzeTopology: (projectPath: string) => Promise<TopologyResult>

    // Cross-script analysis
    analyzeCrossScript: (projectPath: string) => Promise<unknown>
    perfLint: (projectPath: string) => Promise<unknown>
    perfLintFile: (filePath: string, content: string) => Promise<unknown>

    // DataStore schema
    datastoreLoadSchemas: (projectPath: string) => Promise<unknown[]>
    datastoreSaveSchema: (projectPath: string, schema: unknown) => Promise<{ success: boolean }>
    datastoreDeleteSchema: (projectPath: string, name: string) => Promise<{ success: boolean }>
    datastoreGenerateCode: (schema: unknown) => Promise<string>
    datastoreGenerateMigration: (oldSchema: unknown, newSchema: unknown) => Promise<string>

    // Custom Skills
    skillsLoad: (projectPath: string) => Promise<unknown[]>
    skillsSave: (projectPath: string, skills: unknown[]) => Promise<{ success: boolean }>

    // Error Explainer
    explainError: (errorText: string, context: unknown) => Promise<string>

    // Pro Status
    getProStatus: () => Promise<{
      isPro: boolean
      features: Record<string, boolean>
    }>

    // License
    licenseActivate: (key: string) => Promise<{
      success: boolean
      error?: string
      customerName?: string
      customerEmail?: string
    }>
    licenseDeactivate: () => Promise<{ success: boolean; error?: string }>
    licenseInfo: () => Promise<{
      isActive: boolean
      customerName?: string
      customerEmail?: string
      activatedAt?: string
    }>
    licenseValidate: () => Promise<{ valid: boolean }>

    // Auto-update
    updaterCheck: () => Promise<{ success: boolean; version?: string; error?: string }>
    updaterDownload: () => Promise<{ success: boolean; error?: string }>
    updaterInstall: () => Promise<{ success: boolean }>
    updaterStatus: () => Promise<{
      status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error"
      version?: string
      progress?: number
      error?: string
    }>

    // AI Evaluator
    aiEvaluate: (filePath: string, content: string, instruction?: string) => Promise<{
      score: number
      issues: string[]
      suggestions: string[]
      summary: string
    }>
    aiEvaluateBatch: (
      files: Array<{ path: string; content: string }>,
      instruction?: string
    ) => Promise<Record<string, { score: number; issues: string[]; suggestions: string[]; summary: string }>>

    // Performance Monitoring
    perfStats: () => Promise<{
      heapUsed: number
      heapTotal: number
      rss: number
      uptime: number
    }>

    // Batch Operations
    batchFormatAll: (projectPath: string) => Promise<{ formatted: number; failed: number; total: number }>
    batchLintAll: (projectPath: string) => Promise<{
      results: Array<{ file: string; diagnostics: unknown }>
      total: number
    }>

    // Memory
    memoryList: (projectPath: string) => Promise<Array<{
      id: string
      type: "user" | "project" | "feedback"
      content: string
      createdAt: string
      updatedAt: string
    }>>
    memoryAdd: (projectPath: string, type: string, content: string) => Promise<{
      id: string; type: string; content: string; createdAt: string; updatedAt: string
    }>
    memoryUpdate: (projectPath: string, id: string, content: string) => Promise<{
      id: string; type: string; content: string; createdAt: string; updatedAt: string
    } | null>
    memoryDelete: (projectPath: string, id: string) => Promise<boolean>
    memoryContext: (projectPath: string) => Promise<string>
    memoryAutoDetect: (projectPath: string, userMsg: string, assistantMsg: string) => Promise<Array<{
      id: string; type: string; content: string
    }>>

    // Project Instructions
    instructionsLoad: (projectPath: string) => Promise<string>

    // Context Compression
    aiCompressMessages: (messages: Array<{ role: string; content: string }>) => Promise<string>
    aiEstimateTokens: (messages: Array<{ role: string; content: string }>) => Promise<number>

    // Telemetry
    telemetryIsEnabled: () => Promise<boolean>
    telemetrySetEnabled: (enabled: boolean) => Promise<{ success: boolean }>
    telemetryStats: () => Promise<{ diffs: number; queries: number; errorFixes: number } | null>

    // Toolchain
    toolchainRegistry: () => Promise<{
      tools: Record<string, {
        id: string; name: string; description: string
        category: string; bundled: boolean; version: string
        github: string; binaryName: string; configFiles?: string[]
      }>
      categories: Array<{ id: string; label: string; allowNone: boolean }>
    }>
    toolchainGetConfig: (projectPath?: string) => Promise<{
      selections: Record<string, string | null>
      installed: Record<string, boolean>
    }>
    toolchainSetTool: (category: string, toolId: string | null, projectPath?: string) => Promise<{ success: boolean }>
    toolchainDownload: (toolId: string) => Promise<{ success: boolean; error?: string }>
    toolchainRemove: (toolId: string) => Promise<{ success: boolean; error?: string }>
    toolchainDownloadStatus: (toolId: string) => Promise<{ status: string }>

    // Package Manager
    packageInstall: (projectPath: string) => Promise<{ success: boolean; output: string }>
    packageInit: (projectPath: string) => Promise<{ success: boolean; output: string }>

    // Events
    on: (channel: string, callback: (...args: unknown[]) => void) => () => void
    off: (channel: string) => void
  }
}
