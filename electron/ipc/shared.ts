import { join } from "path"
import { existsSync, readFileSync, readdirSync } from "fs"
import { buildSystemPrompt, buildDocsContext, buildGlobalSummary } from "../pro/modules"
import { buildMemoryIndex, loadInstructions } from "../ai/memory"
import { isAdvisorAvailable } from "../ai/provider"
import type { ProFeature } from "../pro"

// ── Shared types ─────────────────────────────────────────────────────────────

/** Common shape for AI context data from renderer */
export interface AIContext {
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

// ── Shared state ─────────────────────────────────────────────────────────────

/** Track AI-generated file contents for telemetry diff comparison */
export const aiGeneratedFiles = new Map<string, string>()

/** Current active project path — set on project:open, used for config lookups */
let _currentProjectPath: string | null = null
export function setCurrentProject(path: string | null): void { _currentProjectPath = path }
export function getCurrentProject(): string | null { return _currentProjectPath }

// ── Helpers ──────────────────────────────────────────────────────────────────

export const PRO_REQUIRED = (feature: ProFeature) => ({
  success: false,
  error: "pro_required",
  feature,
  message: `This feature requires Luano Pro. Start your free 7-day trial at luano.dev/pricing`
})

/** Extract last user message and build RAG docs context */
export async function buildRAGContext(messages: unknown[]): Promise<{ lastUserMsg: string; docsContext: string }> {
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
export function buildFullSystemPrompt(
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
    const memoryIndex = buildMemoryIndex(ctx.projectPath)
    if (memoryIndex) layers.push(memoryIndex)
  }

  if (opts?.includeProgress && ctx.projectPath) {
    layers.push(PROGRESS_INSTRUCTION)
    const progress = readProgressFile(ctx.projectPath)
    if (progress) layers.push(progress)
  }

  if (ctx.sessionHandoff) layers.push(`# Session context\n${ctx.sessionHandoff}`)

  if (isAdvisorAvailable()) {
    layers.push(`# Advisor tool
You have access to an advisor tool (Opus). Use it strategically:
- Before starting substantive work (architecture decisions, complex refactors)
- When stuck or unsure about the best approach
- Before completing a task (final review of your plan)
Keep advisor queries concise — under 100 words, enumerated when possible.
Do NOT call advisor for simple file reads, small edits, or routine tasks.`)
  }

  layers.push("# Language\nAlways respond in the same language the user writes in.")

  return layers.join("\n\n")
}

/** Recursively collect all .lua/.luau files in a project */
export function collectLuauFiles(dir: string): string[] {
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

export { buildGlobalSummary }
