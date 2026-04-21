/**
 * electron/ai/memory.ts — Persistent AI memory system
 *
 * Stores user preferences, project context, and feedback across sessions.
 * Data lives in .luano/memory.json per project.
 */

import { join, dirname, relative, sep } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { homedir } from "os"
import { randomUUID } from "crypto"

// ── Types ───────────────────────────────────────────────────────────────────

export type MemoryType = "user" | "project" | "feedback"

export interface Memory {
  id: string
  type: MemoryType
  content: string
  createdAt: string
  updatedAt: string
}

interface MemoryStore {
  memories: Memory[]
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function memoryPath(projectPath: string): string {
  return join(projectPath, ".luano", "memory.json")
}

function ensureLuanoDir(projectPath: string): void {
  const dir = join(projectPath, ".luano")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function loadStore(projectPath: string): MemoryStore {
  const fp = memoryPath(projectPath)
  if (!existsSync(fp)) return { memories: [] }
  try {
    return JSON.parse(readFileSync(fp, "utf-8")) as MemoryStore
  } catch {
    return { memories: [] }
  }
}

function saveStore(projectPath: string, store: MemoryStore): void {
  ensureLuanoDir(projectPath)
  writeFileSync(memoryPath(projectPath), JSON.stringify(store, null, 2), "utf-8")
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function getMemories(projectPath: string): Memory[] {
  return loadStore(projectPath).memories
}

export function getMemoriesByType(projectPath: string, type: MemoryType): Memory[] {
  return loadStore(projectPath).memories.filter((m) => m.type === type)
}

export function addMemory(
  projectPath: string,
  type: MemoryType,
  content: string
): Memory {
  const store = loadStore(projectPath)
  const now = new Date().toISOString()
  const memory: Memory = {
    id: `mem_${randomUUID()}`,
    type,
    content,
    createdAt: now,
    updatedAt: now
  }
  store.memories.push(memory)
  saveStore(projectPath, store)
  return memory
}

export function updateMemory(
  projectPath: string,
  id: string,
  content: string
): Memory | null {
  const store = loadStore(projectPath)
  const mem = store.memories.find((m) => m.id === id)
  if (!mem) return null
  mem.content = content
  mem.updatedAt = new Date().toISOString()
  saveStore(projectPath, store)
  return mem
}

export function deleteMemory(projectPath: string, id: string): boolean {
  const store = loadStore(projectPath)
  const before = store.memories.length
  store.memories = store.memories.filter((m) => m.id !== id)
  if (store.memories.length === before) return false
  saveStore(projectPath, store)
  return true
}

// ── Context Builder (2-tier: index always loaded, detail on demand) ─────────

/** Max tokens for the always-loaded index layer */
const MAX_INDEX_TOKENS = 300

/** Max tokens for the full detail layer */
const MAX_DETAIL_TOKENS = 600

/**
 * Layer 1: Lightweight index — always injected into system prompt.
 * One-line pointer per memory (~15 chars each). Keeps prompt small.
 */
export function buildMemoryIndex(projectPath: string): string {
  const memories = getMemories(projectPath)
  if (memories.length === 0) return ""

  const groups: Record<MemoryType, Memory[]> = { user: [], project: [], feedback: [] }
  for (const m of memories) {
    groups[m.type].push(m)
  }

  const lines: string[] = ["[Memories — use SearchDocs or ask for detail if needed]"]

  for (const [type, label] of [["feedback", "Feedback"], ["user", "User"], ["project", "Project"]] as const) {
    const items = groups[type]
    if (items.length > 0) {
      lines.push(`${label}:`)
      items.forEach((m) => {
        // Truncate to ~80 chars for index
        const short = m.content.length > 80 ? m.content.slice(0, 77) + "…" : m.content
        lines.push(`- [${m.id}] ${short}`)
      })
    }
  }

  let result = lines.join("\n")
  if (result.length > MAX_INDEX_TOKENS * 4) {
    result = result.slice(0, MAX_INDEX_TOKENS * 4) + "\n…(more memories available)"
  }
  return result
}

/**
 * Layer 2: Full detail — loaded on demand (e.g., when agent needs specifics).
 * Returns complete memory content grouped by type.
 */
export function buildMemoryDetail(projectPath: string, memoryId?: string): string {
  const memories = getMemories(projectPath)
  if (memories.length === 0) return "No memories stored."

  // Single memory lookup
  if (memoryId) {
    const mem = memories.find((m) => m.id === memoryId)
    if (!mem) return `Memory ${memoryId} not found.`
    return `[${mem.type}] ${mem.content} (created: ${mem.createdAt})`
  }

  // Full dump
  const groups: Record<MemoryType, Memory[]> = { user: [], project: [], feedback: [] }
  for (const m of memories) {
    groups[m.type].push(m)
  }

  const lines: string[] = ["[Full memory detail]"]

  if (groups.user.length > 0) {
    lines.push("User:")
    groups.user.forEach((m) => lines.push(`- ${m.content}`))
  }
  if (groups.feedback.length > 0) {
    lines.push("Feedback:")
    groups.feedback.forEach((m) => lines.push(`- ${m.content}`))
  }
  if (groups.project.length > 0) {
    lines.push("Project notes:")
    groups.project.forEach((m) => lines.push(`- ${m.content}`))
  }

  let result = lines.join("\n")
  if (result.length > MAX_DETAIL_TOKENS * 4) {
    result = result.slice(0, MAX_DETAIL_TOKENS * 4) + "\n…(truncated)"
  }
  return result
}

/**
 * Legacy compatibility — returns full context (used where index isn't enough).
 */
export function buildMemoryContext(projectPath: string): string {
  return buildMemoryDetail(projectPath)
}

// ── Project Instructions ────────────────────────────────────────────────────

const INSTRUCTIONS_FILENAME = "LUANO.md"
const INSTRUCTIONS_MAX_CHARS = 8000

function readTrimmed(fp: string): string {
  if (!existsSync(fp)) return ""
  try {
    return readFileSync(fp, "utf-8").trim().slice(0, INSTRUCTIONS_MAX_CHARS)
  } catch { return "" }
}

/** Walk from start up to (but not past) root, collecting LUANO.md files along the way.
 *  Returns [nearest, ..., furthest-within-root]. Excludes root itself — that's the project tier.
 */
function collectDirectoryInstructions(start: string, root: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = []
  let cur = start
  const rootResolved = root.replace(/[/\\]+$/, "")
  // Guard: start must be inside root. If not, skip directory tier entirely.
  const rel = relative(rootResolved, cur)
  if (rel.startsWith("..") || rel.startsWith(sep + "..")) return out
  while (cur && cur !== rootResolved) {
    const fp = join(cur, INSTRUCTIONS_FILENAME)
    const content = readTrimmed(fp)
    if (content) out.push({ path: fp, content })
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return out
}

/**
 * Load LUANO.md instructions across a 3-tier hierarchy, matching Claude Code's CLAUDE.md model:
 *   1. Global      — `~/.luano/LUANO.md` (applies to every project)
 *   2. Project     — `{projectPath}/LUANO.md`
 *   3. Directory   — nearest LUANO.md walking up from `currentFile` to `projectPath`, for every
 *                    subdirectory that has one. Most specific last so it overrides.
 * Sections are merged with headers so the model can tell them apart.
 */
export function loadInstructions(projectPath: string, currentFile?: string): string {
  const sections: string[] = []

  const global = readTrimmed(join(homedir(), ".luano", INSTRUCTIONS_FILENAME))
  if (global) sections.push(`# Global instructions (~/.luano/LUANO.md)\n${global}`)

  const project = readTrimmed(join(projectPath, INSTRUCTIONS_FILENAME))
  if (project) sections.push(`# Project instructions (LUANO.md)\n${project}`)

  if (currentFile) {
    const startDir = dirname(currentFile)
    // Reverse: walk returns nearest-first; we want furthest-first so the nearest
    // appears LAST (most specific wins when the model reconciles conflicts).
    const dirLayers = collectDirectoryInstructions(startDir, projectPath).reverse()
    for (const layer of dirLayers) {
      const relPath = relative(projectPath, layer.path).replace(/\\/g, "/")
      sections.push(`# Directory instructions (${relPath})\n${layer.content}`)
    }
  }

  return sections.join("\n\n")
}

// ── Auto Memory Detection ───────────────────────────────────────────────────

const MEMORY_DETECT_PROMPT = `Analyze this conversation exchange and extract ONLY information worth remembering for future sessions. Focus on:
- User preferences (coding style, conventions, communication preferences)
- Project decisions (architecture choices, tool preferences, patterns)
- Corrections/feedback the user gave about AI behavior

Rules:
- Only extract non-obvious information that can't be derived from code
- Skip ephemeral task details, debugging steps, code snippets
- If nothing is worth remembering, respond with exactly: NONE
- Otherwise respond with one memory per line in format: TYPE|content
  Where TYPE is one of: user, project, feedback
- Keep each memory under 100 characters
- Maximum 3 memories per extraction`

/**
 * Build a prompt to detect memories from a conversation exchange.
 * Returns the detection prompt + conversation context.
 */
export function buildMemoryDetectPrompt(
  userMessage: string,
  assistantResponse: string
): string {
  return `${MEMORY_DETECT_PROMPT}\n\n---\nUser: ${userMessage.slice(0, 500)}\nAssistant: ${assistantResponse.slice(0, 500)}`
}

/**
 * Parse the memory detection response into memory entries.
 */
export function parseMemoryDetectResponse(
  response: string,
  projectPath: string
): Memory[] {
  if (!response || response.trim() === "NONE") return []

  const added: Memory[] = []
  const existing = getMemories(projectPath)

  for (const line of response.split("\n")) {
    const match = line.match(/^(user|project|feedback)\|(.+)$/i)
    if (!match) continue

    const type = match[1].toLowerCase() as MemoryType
    const content = match[2].trim()
    if (!content || content.length < 5) continue

    // Skip if very similar memory already exists
    const isDuplicate = existing.some((m) =>
      m.type === type && m.content.toLowerCase().includes(content.toLowerCase().slice(0, 30))
    )
    if (isDuplicate) continue

    added.push(addMemory(projectPath, type, content))
  }

  return added
}

// ── Token Estimation ────────────────────────────────────────────────────────

/**
 * Rough token count estimation (~4 chars per token for English, ~2 for CJK).
 */
export function estimateTokens(text: string): number {
  // Count CJK characters (they use ~1 token per char)
  const cjk = (text.match(/[\u3000-\u9fff\uac00-\ud7af]/g) || []).length
  const rest = text.length - cjk
  return Math.ceil(rest / 4) + cjk
}

/**
 * Estimate total tokens in a message array.
 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>
): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0)
}

// ── Context Compression ─────────────────────────────────────────────────────

const COMPRESS_PROMPT = `Summarize this conversation into a concise context note (under 300 words). Preserve:
- Key decisions and outcomes
- User preferences expressed
- Important technical details
- What was accomplished

Do NOT include: greetings, filler, step-by-step debugging, code blocks.
Write as bullet points. Start with "Previous conversation summary:"`

/**
 * Build compression prompt for old messages.
 */
export function buildCompressionPrompt(
  messages: Array<{ role: string; content: string }>
): string {
  const conversation = messages
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join("\n")
  return `${COMPRESS_PROMPT}\n\n---\n${conversation}`
}
