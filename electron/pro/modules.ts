/**
 * electron/pro/modules.ts — Centralized Pro module loader
 *
 * All dynamic require() calls for Pro-only backend modules in one place.
 * In Community edition these modules are absent; typed stubs are used instead.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

function tryRequire<T>(id: string): T | null {
  try { return require(id) } catch { return null }
}

// ── AI Context ──────────────────────────────────────────────────────────────

const ctx = tryRequire<{
  buildGlobalSummary: (projectPath: string) => Promise<{ globalSummary: string }>
  buildSystemPrompt: (opts: Record<string, any>) => string
  buildDocsContext: (query: string, projectPath?: string) => Promise<string>
}>("../ai/context")

export const buildGlobalSummary = ctx?.buildGlobalSummary
  ?? (async (): Promise<{ globalSummary: string }> => ({ globalSummary: "" }))

export const buildSystemPrompt = ctx?.buildSystemPrompt
  ?? ((opts: Record<string, any>) =>
    `You are a Luau/Roblox coding assistant.\n\nProject context:\n${opts.globalSummary ?? ""}`)

export const buildDocsContext = ctx?.buildDocsContext
  ?? (async (): Promise<string> => "")

// ── Topology ────────────────────────────────────────────────────────────────

export const analyzeTopology =
  tryRequire<{ analyzeTopology: (p: string) => any }>("../topology/analyzer")?.analyzeTopology
  ?? (() => ({ scripts: [], remotes: [], edges: [] }))

// ── Cross-Script Analysis ───────────────────────────────────────────────────

export const analyzeCrossScript =
  tryRequire<{ analyzeCrossScript: (p: string) => any }>("../analysis/cross-script")?.analyzeCrossScript
  ?? (() => ({ scripts: [], remoteLinks: [] }))

// ── Performance Lint ────────────────────────────────────────────────────────

const perf = tryRequire<{
  performanceLint: (p: string) => any
  performanceLintFile: (f: string, c: string) => any
}>("../analysis/performance-lint")

export const performanceLint = perf?.performanceLint ?? (() => [])
export const performanceLintFile = perf?.performanceLintFile ?? (() => [])

// ── DataStore Schema ────────────────────────────────────────────────────────

export interface DataStoreSchema { name: string; version: number; fields: unknown[] }

const ds = tryRequire<{
  loadSchemas: (p: string) => any
  addSchema: (p: string, s: DataStoreSchema) => any
  deleteSchema: (p: string, n: string) => any
  generateDataModule: (s: DataStoreSchema) => any
  generateMigration: (o: DataStoreSchema, n: DataStoreSchema) => any
}>("../datastore/schema")

export const loadSchemas = ds?.loadSchemas ?? (() => ({ schemas: [] }))
export const addSchema = ds?.addSchema ?? (() => ({ success: true }))
export const deleteSchema = ds?.deleteSchema ?? (() => ({ success: true }))
export const generateDataModule = ds?.generateDataModule ?? (() => "")
export const generateMigration = ds?.generateMigration ?? (() => "")

// ── MCP Client ──────────────────────────────────────────────────────────────

const mcp = tryRequire<{
  getConsoleOutput: () => any
  isStudioConnected: () => any
}>("../mcp/client")

export const getConsoleOutput = mcp?.getConsoleOutput ?? (async () => null)
export const isStudioConnected = mcp?.isStudioConnected ?? (() => false)

// ── Bridge Server ───────────────────────────────────────────────────────────

const bridge = tryRequire<{
  startBridgeServer: (port?: number) => void
  setBridgeWindow: (win: any) => void
  getBridgeTree: () => any
  getBridgeLogs: () => any
  isBridgeConnected: () => boolean
  clearBridgeLogs: () => void
  queueScript: (code: string) => string
  getCommandResult: (id: string) => any
}>("../bridge/server")

export const startBridgeServer = bridge?.startBridgeServer ?? (() => {})
export const setBridgeWindow = bridge?.setBridgeWindow ?? (() => {})
export const getBridgeTree = bridge?.getBridgeTree ?? (() => null)
export const getBridgeLogs = bridge?.getBridgeLogs ?? (() => [])
export const isBridgeConnected = bridge?.isBridgeConnected ?? (() => false)
export const clearBridgeLogs = bridge?.clearBridgeLogs ?? (() => {})
export const queueScript = bridge?.queueScript ?? (() => "")
export const getCommandResult = bridge?.getCommandResult ?? (() => null)

// ── Agent Checkpoint ────────────────────────────────────────────────────────

const agent = tryRequire<{
  getLastCheckpoint: () => any
  revertCheckpoint: (checkpoint: any) => string[]
}>("../ai/agent")

export const getLastCheckpoint = agent?.getLastCheckpoint ?? (() => null)
export const revertCheckpoint = agent?.revertCheckpoint ?? (() => [])

// ── Telemetry ───────────────────────────────────────────────────────────────

const tele = tryRequire<{
  isEnabled: () => boolean
  setEnabled: (enabled: boolean) => void
  getStats: () => any
  recordDiff: (entry: any) => void
  recordQuery: (entry: any) => void
}>("../telemetry/collector")

export const telemetryEnabled = tele?.isEnabled ?? (() => false)
export const setTelemetry = tele?.setEnabled ?? (() => {})
export const telemetryStats = tele?.getStats ?? (() => null)
export const recordDiff = tele?.recordDiff ?? (() => {})
export const recordQuery = tele?.recordQuery ?? (() => {})

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
