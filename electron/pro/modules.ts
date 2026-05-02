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
import { log } from "../logger"

/**
 * Load a Pro module relative to this file. Returns null if the file doesn't
 * exist (public mirror build) and lets no-op fallbacks take over.
 *
 * IMPORTANT: only a TOP-LEVEL MODULE_NOT_FOUND on `id` itself is swallowed.
 * If the Pro module loads fine but IT imports something missing, Node raises
 * MODULE_NOT_FOUND for the transitive miss too — we must NOT swallow that,
 * or a real "forgot to ship a dep" bug looks identical to "Free edition,
 * use no-op fallback".
 *
 * Detection: Node's MODULE_NOT_FOUND error carries `requireStack` (array of
 * files that were loading when the miss happened). If requireStack is empty
 * (or its first entry is this file), the miss is the top-level `id`. Any
 * other requireStack means a transitive failure — log and rethrow.
 *
 * Fallback (old Node versions without requireStack): check that the missing
 * module path in `err.message` matches the resolved `id` path.
 */

/**
 * Pure predicate: returns true iff the MODULE_NOT_FOUND error originated from
 * `currentFile` (the swallow case — the file itself is absent). Returns false
 * for transitive misses (Pro file loaded fine but one of its own deps is
 * missing).
 *
 * Exported for unit-testing. Production code below calls it via `tryRequire`.
 *
 * @internal
 */
export function isTopLevelMiss(err: unknown, currentFile: string): boolean {
  const e = err as NodeJS.ErrnoException & { requireStack?: string[] }
  const stack = e.requireStack
  if (!stack || stack.length === 0) return true
  // Win32: drive-letter casing can differ between Node's requireStack[0] and
  // __filename (e.g. `c:\foo\modules.js` vs `C:\foo\modules.js`). Normalise
  // to lowercase before comparing so both classify as top-level correctly.
  if (process.platform === "win32") {
    return stack[0].toLowerCase() === currentFile.toLowerCase()
  }
  return stack[0] === currentFile
}

// Exported for unit-testing the error-discrimination contract. The runtime
// does not import this name from outside; production callers in this file
// still reach it directly as a local binding.
export function tryRequire<T>(id: string): T | null {
  const resolvedId = join(__dirname, id)
  try {
    return require(resolvedId)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") {
      const e = err as NodeJS.ErrnoException & { requireStack?: string[] }
      const stack = e.requireStack
      // Top-level miss: the failed require was issued from THIS file
      // (modules.ts). Node populates `requireStack[0]` with the file that
      // ran the failed `require()` — modules.ts in our case. Higher entries
      // are the chain of files that triggered modules.ts to load.
      //
      // Earlier this also constrained `stack.length === 1`, which only held
      // when modules.ts was loaded as a direct entry. In production it's
      // always loaded transitively (main → handlers → ai-handlers → here),
      // so the deeper-stack case is the normal one.
      if (isTopLevelMiss(err, __filename)) {
        // Sanity check: verify the missing module path in the error message
        // names the id we requested. If it names something else (e.g. a
        // package.json `main` quirk pointing to a sub-module), the error is
        // actually transitive — log + rethrow rather than silently swallowing.
        const msg = (e.message || "")
        if (!msg.includes(id) && !msg.includes(resolvedId)) {
          log.error(`[pro/modules] transitive miss loading ${id}:`, err)
          throw err
        }
        return null
      }
      // Transitive miss — Pro file existed and started loading but then
      // failed to resolve one of its own requires. Real bug; surface it.
      log.error(`[pro/modules] transitive miss loading ${id} (requireStack=${stack?.join(",")}):`, err)
      throw err
    }
    // Non-missing error (syntax, runtime throw, etc.) — log loudly and
    // re-throw so crashes surface in dev and are captured by Sentry in prod.
    log.error(`[pro/modules] failed to load ${id}:`, err)
    throw err
  }
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
 * Free-edition system prompt. Ported from Claude Code's actual prompt
 * modules (Piebald-AI/claude-code-system-prompts).
 *
 * Three modes:
 * - chat: no tools, no mutation. Answer + code in markdown.
 * - plan: read-only planning subagent, structure follows CC's
 *         agent-prompt-plan-mode-enhanced.md with Luano tool names.
 * - agent: full tool use (fallback when Pro context.ts is absent).
 *
 * Text bodies that appear in CC verbatim are marked "ported from CC:".
 * Luano-specific deltas (Luau domain, our tool names, no Bash) are
 * called out inline.
 */
function freeSystemPrompt(opts: Record<string, any>): string {
  const sections: string[] = []
  const mode = opts.mode as ("chat" | "agent" | "plan" | undefined)

  // ── Identity (mode-aware) ─────────────────────────────────────────────────
  if (mode === "chat") {
    // CC has no direct "no-tools chat mode" equivalent — this is Luano-specific.
    // Tone and IMPORTANT URL rule are ported from CC's main prompt.
    sections.push(`You are Luano, an AI coding assistant for Roblox (Luau) development, built on Claude.

You are in Chat mode. You do NOT have tools, filesystem access, a terminal, or a live Studio session. You cannot edit files or run commands. The user applies any code you write manually.

Answer questions directly. Write code in markdown blocks. Never say "I'll add this" or "I'll modify that" — you can't. If the user needs real edits, tell them to switch to Agent mode.

IMPORTANT: Assist with legitimate Roblox/Luau development. Refuse requests to write cheats, exploits, griefing tools, or content that clearly violates Roblox's Terms of Service — even as "just example code." The model without tools can still generate harmful code.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or the project's files.`)
  } else if (mode === "plan") {
    // Ported from CC's agent-prompt-plan-mode-enhanced.md.
    // Deltas:
    // - Luano uses Read / Glob / Grep / SearchDocs (no Bash in this project).
    // - "Critical Files for Implementation" format is CC's required ending.
    // - 40-line hard limit is from CC's phase-four-of-plan-mode.md.
    sections.push(`You are a software architect and planning specialist for Luano. Your role is to explore the codebase and design implementation plans for Roblox (Luau) projects.

=== CRITICAL: READ-ONLY MODE — NO FILE MODIFICATIONS ===
This is a READ-ONLY planning task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, no Create)
- Modifying existing files (no Edit, MultiEdit, Patch)
- Deleting files (no Delete)
- Running commands that change state (RunScript, SetProperty, InsertModel all forbidden)

Your role is EXCLUSIVELY to explore the codebase and design an implementation plan. Attempting to edit files will fail.

## Your Process

1. **Understand Requirements**: Focus on the requirements the user provided.

2. **Explore Thoroughly**:
   - Read any files the user provided in the initial prompt.
   - Find existing patterns and conventions using Glob, Grep, and Read.
   - Use SearchDocs for Roblox API questions.
   - Understand the current Rojo structure and module layout.
   - Identify similar features as reference.
   - Trace through relevant code paths.

3. **Design Solution**:
   - Create an implementation approach that fits the current project.
   - Consider trade-offs (server vs. client, module boundaries, DataStore schema impact).
   - Follow existing patterns where appropriate.

4. **Detail the Plan**:
   - Provide a step-by-step implementation strategy.
   - Identify dependencies and sequencing.
   - Anticipate potential challenges (Humanoid respawn, remote validation, etc.).

## Required Output

- List the paths of files to be modified and what changes in each (one bullet per file).
- Reference existing functions to reuse, with file_path:line_number.
- End with the single verification command (typically running Lint on the edited files after switching to Agent mode).

End your response with:

### Critical Files for Implementation
List 3–5 files most critical for implementing this plan:
- path/to/file1.luau
- path/to/file2.luau
- path/to/file3.luau

REMEMBER: You can ONLY explore and plan. You CANNOT and MUST NOT write, edit, or modify any files. The user will review your plan and switch to Agent mode to execute.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs returned by SearchDocs or provided by the user.`)
  } else {
    // Free-mode Agent fallback. Mirrors Pro identity but without the full
    // Pro prompt (context.ts) — used when Pro files are absent from the build.
    sections.push(`You are Luano, an AI coding assistant for Roblox (Luau) development, built on Claude. You help users with software engineering tasks on Roblox projects: writing and debugging Luau code, integrating with Roblox Studio, setting up projects. Use the tools available to you to make changes directly rather than describing them in chat.

IMPORTANT: Assist with legitimate Roblox/Luau development. Refuse requests to build cheats, exploits, griefing tools, or content that clearly violates Roblox's Terms of Service.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user, project files, or Roblox Creator Docs returned by SearchDocs.`)
  }

  // ── Principles (shared via prompt-fragments — ported from CC) ─────────────
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
// Post-consolidation MCP only owns Roblox-official tools (InsertModel via
// Creator Store). Runtime I/O (logs, RunScript, tree, SetProperty) lives in
// the Bridge — see electron/bridge/server.ts.

const mcp = tryRequire<{
  isMcpConnected: () => Promise<boolean>
  mcpShutdown: () => void
}>("../mcp/client")

export const isStudioConnected = mcp?.isMcpConnected ?? (() => Promise.resolve(false))
export const mcpShutdown = mcp?.mcpShutdown ?? (() => undefined)

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
  agentChat: (
    messages: any[],
    systemPrompt: string,
    streamChannel: string,
    projectRoot?: string,
    planMode?: boolean,
    options?: { senderId?: number; studioContext?: string }
  ) => Promise<{ modifiedFiles: string[] }>
  inlineEdit: (filePath: string, fileContent: string, instruction: string, systemPrompt: string) => Promise<string>
  getLastCheckpoint: () => any
  revertCheckpoint: (checkpoint: any) => string[]
  clearLastCheckpoint: () => void
  getActiveSessionSenderId: () => number | undefined
  forceResetSessionState: () => void
  redactSecrets: (text: string) => string
}>("../ai/agent")

export const agentChat = agent?.agentChat
  ?? (async (): Promise<{ modifiedFiles: string[] }> => { throw new Error("Agent mode requires Luano Pro") })

export const inlineEdit = agent?.inlineEdit
  ?? (async (): Promise<string> => { throw new Error("Inline edit requires Luano Pro") })

export const getLastCheckpoint = agent?.getLastCheckpoint ?? (() => null)
export const revertCheckpoint = agent?.revertCheckpoint ?? (() => [])
/** C2: clear checkpoint on project switch. No-op in Free mode. */
export const clearLastCheckpoint: () => void = agent?.clearLastCheckpoint ?? (() => {})

/** Active session's owning renderer id, or undefined when no session is
 *  running / the session was started without a sender. Used by `ai:abort`
 *  to gate which renderer can cancel the session. No-op stub in Free mode. */
export const getActiveSessionSenderId = agent?.getActiveSessionSenderId ?? (() => undefined)

/** Synchronous force-reset of session mutex / sender id / abort controller —
 *  used by render-process-gone in main.ts when async cleanup can't be relied
 *  on. No-op in Free mode. */
export const forceResetSessionState: () => void = agent?.forceResetSessionState ?? (() => {})

/** Conservative log redactor for runtime data flowing into LLM context.
 *  M6: warn when security-critical fallback is active — redactSecrets is a
 *  no-op in Free builds which is acceptable (agent loop doesn't run), but
 *  surfacing the warning helps catch misconfigured Pro builds early. */
export const redactSecrets: (text: string) => string = (() => {
  if (agent?.redactSecrets) return agent.redactSecrets
  log.warn("[pro/modules] redactSecrets not available — using identity fallback (expected in Free builds)")
  return (text: string) => text
})()

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
