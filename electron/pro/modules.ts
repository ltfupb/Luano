/**
 * electron/pro/modules.ts — Centralized Pro module loader
 *
 * All dynamic require() calls for Pro-only backend modules in one place.
 * In Community edition these modules are absent; typed stubs are used instead.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

import { join } from "path"

function tryRequire<T>(id: string): T | null {
  try { return require(join(__dirname, id)) } catch { return null }
}

// ── Internal Keys (Pro-only, gitignored) ───────────────────────────────────

const keys = tryRequire<{
  INTERNAL_KEYS: Set<string>
}>("./internal-keys")

export const isInternalKey = (key: string): boolean =>
  keys?.INTERNAL_KEYS?.has(key) ?? false

// ── AI Context ──────────────────────────────────────────────────────────────

const ctx = tryRequire<{
  buildGlobalSummary: (projectPath: string) => Promise<{ globalSummary: string }>
  buildSystemPrompt: (opts: Record<string, any>) => string
  buildDocsContext: (query: string, projectPath?: string) => Promise<string>
}>("../ai/context")

export const buildGlobalSummary = ctx?.buildGlobalSummary
  ?? (async (): Promise<{ globalSummary: string }> => ({ globalSummary: "" }))

/** Community-edition system prompt — structured like Claude Code's own prompt. */
function communitySystemPrompt(opts: Record<string, any>): string {
  const sections: string[] = []

  // ── Identity
  sections.push(`You are Luano, an AI coding assistant specialized in Roblox (Luau) development.
You help users write, debug, and improve Luau code. You understand Roblox services, APIs, RemoteEvents, DataStores, and the client/server model.`)

  // ── Context
  if (opts.globalSummary) {
    sections.push(`# Project context\n${opts.globalSummary}`)
  }
  if (opts.currentFile) {
    const fileSection = opts.currentFileContent
      ? `# Active file\nPath: ${opts.currentFile}\n\`\`\`lua\n${opts.currentFileContent.slice(0, 3000)}\n\`\`\``
      : `# Active file\nPath: ${opts.currentFile}`
    sections.push(fileSection)
  }
  if (opts.docsContext) {
    sections.push(`# Roblox API reference\n${opts.docsContext}`)
  }
  if (opts.bridgeContext) {
    sections.push(`# Live Studio session\n${opts.bridgeContext}`)
  }
  if (opts.attachedFiles?.length) {
    const files = opts.attachedFiles.map((f: { path: string; content: string }) =>
      `## ${f.path}\n\`\`\`\n${f.content.slice(0, 2000)}\n\`\`\``
    ).join("\n\n")
    sections.push(`# Attached files\n${files}`)
  }

  // ── Tone and style
  sections.push(`# Tone and style
- Be concise and direct. Lead with the answer or action, not reasoning.
- When you modify files, state which files changed in one short line. Do not explain what the code does unless asked.
- Do not repeat the user's request back. Do not add summaries of what you did.
- For simple tasks, a 1-2 sentence response is ideal.
- Use code blocks for code only, not for file paths or short values.
- Skip filler phrases: "Sure!", "Of course!", "Here's what I did:", "I've made the following changes:".
- Match the user's language. If they write in Korean, respond in Korean.`)

  // ── Output efficiency
  sections.push(`# Output efficiency
Go straight to the point. Try the simplest approach first. Keep text output brief and direct.
Focus output on: decisions that need user input, status updates at milestones, and errors that change the plan.
If you can say it in one sentence, do not use three.`)

  return sections.join("\n\n")
}

export const buildSystemPrompt = ctx?.buildSystemPrompt ?? communitySystemPrompt

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
  mcpGetConsole: (maxLines?: number) => Promise<string | null>
  isMcpConnected: () => Promise<boolean>
}>("../mcp/client")

export const getConsoleOutput = mcp?.mcpGetConsole ?? (async () => null)
export const isStudioConnected = mcp?.isMcpConnected ?? (() => Promise.resolve(false))

// ── Bridge Server ───────────────────────────────────────────────────────────

const bridge = tryRequire<{
  startBridgeServer: (port?: number) => void
  stopBridgeServer: () => void
  setBridgeWindow: (win: any) => void
  getBridgeTree: () => any
  getBridgeLogs: () => any
  isBridgeConnected: () => boolean
  clearBridgeLogs: () => void
  queueScript: (code: string) => string
  consumeCommandResult: (id: string) => any
  getBridgeToken: () => string
}>("../bridge/server")

export const startBridgeServer = bridge?.startBridgeServer ?? (() => {})
export const stopBridgeServer = bridge?.stopBridgeServer ?? (() => {})
export const setBridgeWindow = bridge?.setBridgeWindow ?? (() => {})
export const getBridgeTree = bridge?.getBridgeTree ?? (() => null)
export const getBridgeLogs = bridge?.getBridgeLogs ?? (() => [])
export const isBridgeConnected = bridge?.isBridgeConnected ?? (() => false)
export const clearBridgeLogs = bridge?.clearBridgeLogs ?? (() => {})
export const queueScript = bridge?.queueScript ?? (() => "")
export const consumeCommandResult = bridge?.consumeCommandResult ?? (() => null)
export const getBridgeToken = bridge?.getBridgeToken ?? (() => "")

// ── Agent (chat + inline edit + checkpoint) ────────────────────────────────

const agent = tryRequire<{
  agentChat: (messages: any[], systemPrompt: string, streamChannel: string, projectRoot?: string) => Promise<{ modifiedFiles: string[] }>
  inlineEdit: (filePath: string, fileContent: string, instruction: string, systemPrompt: string) => Promise<string>
  getLastCheckpoint: () => any
  revertCheckpoint: (checkpoint: any) => string[]
}>("../ai/agent")

export const agentChat = agent?.agentChat
  ?? (async (): Promise<{ modifiedFiles: string[] }> => { throw new Error("Agent mode requires Luano Pro") })

export const inlineEdit = agent?.inlineEdit
  ?? (async (): Promise<string> => { throw new Error("Inline edit requires Luano Pro") })

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

// ── Evaluator (public module — not Pro-gated) ─────────────────────────────
// Re-exported here for consistent import pattern from handlers.ts

const evaluator = tryRequire<{
  evaluateCode: (filePath: string, content: string, instruction?: string) => Promise<any>
  evaluateFiles: (files: Array<{ path: string; content: string }>, instruction?: string) => Promise<any>
}>("../ai/evaluator")

export const evaluateCode = evaluator?.evaluateCode ?? (async () => ({
  score: 0, issues: ["Evaluator not available"], suggestions: [], summary: "N/A"
}))

export const evaluateFiles = evaluator?.evaluateFiles ?? (async () => ({}))

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
