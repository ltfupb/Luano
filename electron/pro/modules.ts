/**
 * electron/pro/modules.ts — Centralized Pro module loader
 *
 * All dynamic require() calls for Pro-only backend modules in one place.
 * In Free edition these modules are absent; typed stubs are used instead.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

import { join } from "path"
import {
  TONE_PRINCIPLES,
  TONE_PRINCIPLES_WITH_TOOLS,
  DOING_TASKS_PRINCIPLES,
  LANGUAGE_PRINCIPLES
} from "../ai/prompt-fragments"

function tryRequire<T>(id: string): T | null {
  try { return require(join(__dirname, id)) } catch { return null }
}

// ── AI Context ──────────────────────────────────────────────────────────────

const ctx = tryRequire<{
  buildGlobalSummary: (projectPath: string) => Promise<{ globalSummary: string }>
  buildSystemPrompt: (opts: Record<string, any>) => string
  buildDocsContext: (query: string, projectPath?: string) => Promise<string>
}>("../ai/context")

export const buildGlobalSummary = ctx?.buildGlobalSummary
  ?? (async (): Promise<{ globalSummary: string }> => ({ globalSummary: "" }))

/**
 * Free-edition system prompt. CC-style structure: identity first, then
 * principles (tone, doing tasks, language), then dynamic context last.
 *
 * Three modes share principles but diverge on identity and capability:
 * - chat: no tools, no mutation, reply with code in markdown.
 * - plan: read-only, propose a plan for the user to approve. Free-form
 *         output — format is the model's call, not a fixed template.
 * - agent: full tool use (fallback when Pro context.ts is absent).
 */
function freeSystemPrompt(opts: Record<string, any>): string {
  const sections: string[] = []
  const mode = opts.mode as ("chat" | "agent" | "plan" | undefined)

  // ── Identity (mode-aware, CC-style) ───────────────────────────────────────
  if (mode === "chat") {
    sections.push(`You are Luano, an AI coding assistant for Roblox (Luau) development, built on Claude.

You are in Chat mode. You do NOT have tools, filesystem access, a terminal, or a live Studio session. You cannot edit files or run commands. The user applies any code you write manually.

Answer questions directly. Write code in markdown blocks. Never say "I'll add this" or "I'll modify that" — you can't. If the user needs real edits, tell them to switch to Agent mode.

IMPORTANT: You must NEVER generate or guess URLs. Only use URLs the user provided.`)
  } else if (mode === "plan") {
    sections.push(`You are Luano, an AI coding assistant for Roblox (Luau) development, built on Claude.

You are in Plan mode. Your job is to make a plan together with the user. You CANNOT edit files, run tools that mutate state, or execute code. When you have tool access, you can Read, Grep, and SearchDocs to build context.

How to work in Plan mode:
1. Read the relevant code to understand current state.
2. Ask a clarifying question if requirements are ambiguous. One question at a time.
3. Propose a plan in whatever shape fits the task. Bulleted list of files to touch, a walkthrough of the change, a decision tree — trust your judgment on format. Keep it short enough to review in one glance.
4. Surface risks and open questions honestly.
5. The user approves, adjusts, or rejects. When approved, they switch to Agent mode to execute.

Don't propose code changes you can't later implement. Don't propose boilerplate you haven't seen the project use.

IMPORTANT: You must NEVER generate or guess URLs. Only use URLs the user provided or ones returned by SearchDocs.`)
  } else {
    sections.push(`You are Luano, an AI coding assistant for Roblox (Luau) development, built on Claude.

You help users with software engineering tasks: writing and debugging Luau code, integrating with Roblox Studio, setting up projects. Use the tools available to you to make changes directly rather than describing them in chat.

IMPORTANT: Assist with legitimate Roblox/Luau development. Refuse requests to build cheats, exploits, or content that violates Roblox's Terms of Service.

IMPORTANT: You must NEVER generate or guess URLs. Only use URLs from user-provided context or Roblox Creator Docs returned by SearchDocs.`)
  }

  // ── Principles (shared — keep Pro/Free aligned via prompt-fragments) ──────
  sections.push(mode === "chat" || mode === "plan" ? TONE_PRINCIPLES : TONE_PRINCIPLES_WITH_TOOLS)
  sections.push(DOING_TASKS_PRINCIPLES)
  sections.push(LANGUAGE_PRINCIPLES)

  // ── Project context (dynamic — never cached) ──────────────────────────────
  if (opts.globalSummary) {
    sections.push(`# Project context\n${opts.globalSummary}`)
  }
  if (opts.currentFile) {
    const fileSection = opts.currentFileContent
      ? `# Active file\nPath: ${opts.currentFile}\n\`\`\`luau\n${opts.currentFileContent.slice(0, 3000)}\n\`\`\``
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

  return sections.join("\n\n")
}

// Route: chat/plan modes ALWAYS use free prompt (skip Pro's tool-heavy prefix).
// Agent mode uses Pro prompt if available, free otherwise.
export const buildSystemPrompt = (opts: Record<string, any>): string => {
  if (opts.mode === "chat" || opts.mode === "plan") return freeSystemPrompt(opts)
  return ctx?.buildSystemPrompt ? ctx.buildSystemPrompt(opts) : freeSystemPrompt(opts)
}

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
  agentChat: (messages: any[], systemPrompt: string, streamChannel: string, projectRoot?: string, autoAccept?: boolean) => Promise<{ modifiedFiles: string[] }>
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
