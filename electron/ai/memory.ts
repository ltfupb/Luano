/**
 * electron/ai/memory.ts — Persistent AI memory system
 *
 * Stores user preferences, project context, and feedback across sessions.
 * Data lives in .luano/memory.json per project.
 */

import { join } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"

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
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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

// ── Context Builder ─────────────────────────────────────────────────────────

const MAX_MEMORY_TOKENS = 600

/**
 * Build a memory context string for injection into AI system prompt.
 * Groups by type, caps total length.
 */
export function buildMemoryContext(projectPath: string): string {
  const memories = getMemories(projectPath)
  if (memories.length === 0) return ""

  const groups: Record<MemoryType, Memory[]> = { user: [], project: [], feedback: [] }
  for (const m of memories) {
    groups[m.type].push(m)
  }

  const lines: string[] = ["[Memories from previous sessions]"]

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
  // Rough token cap (~4 chars per token)
  if (result.length > MAX_MEMORY_TOKENS * 4) {
    result = result.slice(0, MAX_MEMORY_TOKENS * 4) + "\n…(truncated)"
  }
  return result
}

// ── Project Instructions ────────────────────────────────────────────────────

/**
 * Load luano.md from project root — user-defined project instructions for the AI.
 * Same concept as CLAUDE.md in Claude Code.
 */
export function loadInstructions(projectPath: string): string {
  const fp = join(projectPath, "LUANO.md")
  if (!existsSync(fp)) return ""
  try {
    return readFileSync(fp, "utf-8").trim()
  } catch {
    return ""
  }
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
