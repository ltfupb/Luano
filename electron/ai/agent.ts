/**
 * electron/ai/agent.ts — Pro AI features (Agent loop + Inline Edit)
 *
 * Cursor-inspired phase architecture:
 * - PLAN: No tools, model outputs execution plan (prevents exploration loops)
 * - EXECUTE: All tools for making changes (with per-turn limits)
 * - VERIFY: Auto-lint modified files, fix errors if found
 *
 * Safety features:
 * - Checkpoint: saves original files before modification for rollback
 * - Tool call limit: max tools per API response to prevent bursts
 * - Stall detection: forces action if model only explores in execute phase
 */

import Anthropic from "@anthropic-ai/sdk"
import type { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { BrowserWindow } from "electron"
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { TOOLS, executeTool } from "./tools"
import {
  type ChatMessage,
  getProvider, getModel,
  getAnthropicClient, getOpenAIClient,
  _setActiveAbortController,
  toCachedSystem, toCachedTools,
  chat
} from "./provider"

// ── Phase-based agent architecture ─────────────────────────────────────────

type AgentPhase = "plan" | "execute" | "verify"

/** Tools that only inspect existing project/studio state — useless on empty projects */
const EXPLORATION_ONLY_TOOLS = new Set([
  "list_files", "grep_files", "read_instance_tree", "get_runtime_logs"
])

const WRITE_TOOL_NAMES = new Set(["create_file", "edit_file", "delete_file"])

/** Read-only tools — consecutive use without writes signals stalling */
const READ_ONLY_TOOLS = new Set([
  "read_file", "list_files", "grep_files", "search_docs",
  "read_instance_tree", "get_runtime_logs", "lint_file"
])

/** Destructive tools that need extra caution */
const DANGEROUS_TOOLS = new Set(["delete_file"])

/** Max tool calls processed per single API response — prevents runaway bursts */
const MAX_TOOLS_PER_ROUND = 10

// ── MicroCompact: local tool_result compression (zero API calls) ────────────

/** Max characters to keep in a tool_result before compacting */
const COMPACT_THRESHOLD = 1500

/**
 * Compress tool output locally without API calls.
 * Large read_file/grep_files/list_files results are replaced with a summary line
 * + trimmed content. This prevents history token explosion.
 */
function microCompact(toolName: string, output: string): string {
  if (output.length <= COMPACT_THRESHOLD) return output

  switch (toolName) {
    case "read_file": {
      const lineCount = output.split("\n").length
      const head = output.slice(0, 800)
      const tail = output.slice(-400)
      return `[Read ${lineCount} lines — showing head + tail]\n${head}\n…(${lineCount - 30}+ lines omitted)…\n${tail}`
    }
    case "grep_files": {
      const lines = output.split("\n")
      const kept = lines.slice(0, 20)
      if (lines.length > 20) {
        kept.push(`…(${lines.length - 20} more matches omitted)`)
      }
      return kept.join("\n")
    }
    case "list_files": {
      const lines = output.split("\n")
      const kept = lines.slice(0, 30)
      if (lines.length > 30) {
        kept.push(`…(${lines.length - 30} more entries omitted)`)
      }
      return kept.join("\n")
    }
    case "lint_file": {
      // Keep all errors but truncate if massive
      if (output.length > 3000) {
        return output.slice(0, 2500) + "\n…(truncated)"
      }
      return output
    }
    default:
      // Generic truncation for any other large output
      return output.slice(0, COMPACT_THRESHOLD) + `\n…(${output.length - COMPACT_THRESHOLD} chars truncated)`
  }
}

function getToolsForExecution(excludeExploration = false): Anthropic.Tool[] {
  if (excludeExploration) return TOOLS.filter((t) => !EXPLORATION_ONLY_TOOLS.has(t.name))
  return TOOLS
}

function getOpenAIToolsForExecution(excludeExploration = false): ChatCompletionTool[] {
  const tools = getToolsForExecution(excludeExploration)
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>
    }
  }))
}

// ── Checkpoint system ────────────────────────────────────────────────────────

/** Snapshot of file state before agent modifications — enables rollback */
export interface AgentCheckpoint {
  /** path → original content (null = file didn't exist before agent created it) */
  originals: Map<string, string | null>
}

function createCheckpoint(): AgentCheckpoint {
  return { originals: new Map() }
}

/** Save a file's current state before the agent modifies it */
function saveToCheckpoint(checkpoint: AgentCheckpoint, filePath: string): void {
  if (checkpoint.originals.has(filePath)) return
  checkpoint.originals.set(
    filePath,
    existsSync(filePath) ? readFileSync(filePath, "utf-8") : null
  )
}

/** Revert all agent changes: restore modified files, delete created files */
export function revertCheckpoint(checkpoint: AgentCheckpoint): string[] {
  const reverted: string[] = []
  for (const [path, original] of checkpoint.originals) {
    try {
      if (original === null) {
        if (existsSync(path)) { unlinkSync(path); reverted.push(path) }
      } else {
        writeFileSync(path, original, "utf-8"); reverted.push(path)
      }
    } catch { /* skip unrevertable files */ }
  }
  return reverted
}

/** Module-level storage for the most recent checkpoint (IPC access) */
let _lastCheckpoint: AgentCheckpoint | null = null
export function getLastCheckpoint(): AgentCheckpoint | null { return _lastCheckpoint }

// ── Lint helper ──────────────────────────────────────────────────────────────

async function lintModifiedFiles(
  files: string[],
  streamChannel: string,
  errorsOnly = false,
  projectRoot?: string
): Promise<string[]> {
  const luauFiles = [...new Set(files)].filter((f) => /\.(lua|luau)$/.test(f) && existsSync(f))
  const errors: string[] = []
  for (const file of luauFiles) {
    try {
      const result = await executeTool("lint_file", { path: file }, projectRoot)
      if (result.success && !result.output.includes("No lint errors")) {
        let output = result.output
        // For AUTO-VERIFY: only include ERRORs, skip warnings
        if (errorsOnly) {
          const lines = output.split("\n")
          const errorLines = lines.filter((l) => /^(ERROR|Found)/.test(l))
          if (errorLines.length === 0 || !errorLines.some((l) => l.startsWith("ERROR"))) continue
          const errorCount = errorLines.filter((l) => l.startsWith("ERROR")).length
          output = `Found ${errorCount} error(s):\n${errorLines.filter((l) => l.startsWith("ERROR")).join("\n")}`
        }
        errors.push(`${file}:\n${output}`)
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send(`${streamChannel}:tool`, {
            tool: "lint_file",
            input: { path: file },
            output,
            success: true
          })
        })
      }
    } catch { /* lint failure is non-critical */ }
  }
  return errors
}

// ── Token / history helpers ──────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

function estimateHistoryTokens(history: Anthropic.MessageParam[]): number {
  let total = 0
  for (const msg of history) {
    if (typeof msg.content === "string") {
      total += estimateTokens(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        total += estimateTokens(JSON.stringify(block))
      }
    }
  }
  return total
}

/** 토큰 예산 내로 히스토리 축소 — 가장 오래된 메시지부터 제거 */
function truncateHistory(
  history: Anthropic.MessageParam[],
  systemTokens: number,
  maxBudget = 150_000
): void {
  const budget = maxBudget - systemTokens - 8192
  while (estimateHistoryTokens(history) > budget && history.length > 2) {
    history.shift()
    // 히스토리는 반드시 일반 user 메시지로 시작해야 함
    // (고아 tool_result 블록은 대응하는 assistant tool_use가 없으므로 API 에러 유발)
    while (history.length > 0) {
      const first = history[0]
      if (first.role !== "user") {
        history.shift()
        continue
      }
      if (Array.isArray(first.content) &&
          first.content.length > 0 &&
          (first.content as Array<{ type: string }>).every((b) => b.type === "tool_result")) {
        history.shift()
        continue
      }
      break
    }
  }
}

/** Compress old messages when history exceeds token budget threshold */
async function compressHistoryIfNeeded(
  history: Anthropic.MessageParam[],
  systemTokens: number,
  maxBudget = 150_000
): Promise<void> {
  const threshold = (maxBudget - systemTokens) * 0.6
  const currentTokens = estimateHistoryTokens(history)
  if (currentTokens < threshold || history.length < 6) return

  // Take the oldest half of messages to compress
  const splitIdx = Math.floor(history.length / 2)
  const oldMessages = history.slice(0, splitIdx)

  // Build a simple summary of old messages
  const conversation = oldMessages.map((m) => {
    const content = typeof m.content === "string"
      ? m.content.slice(0, 300)
      : JSON.stringify(m.content).slice(0, 300)
    return `${m.role}: ${content}`
  }).join("\n")

  const compressPrompt = `Summarize this conversation into a concise context note (under 200 words). Preserve key decisions, outcomes, and technical details. Skip greetings, filler, and code blocks. Write as bullet points.`

  try {
    const summary = await chat(
      [{ role: "user", content: `${compressPrompt}\n\n---\n${conversation}` }],
      "You are a conversation summarizer. Be extremely concise."
    )
    if (summary && summary.length > 20) {
      // Replace old messages with summary
      history.splice(0, splitIdx, {
        role: "user",
        content: `[Previous conversation summary]\n${summary}`
      } as Anthropic.MessageParam)
    }
  } catch {
    // Compression failed — fall back to simple truncation
    truncateHistory(history, systemTokens, maxBudget)
  }
}

/** 순수 질문인지 판별 — 질문이면 plan 건너뛰고 tool 강제 안 함 */
function isQuestion(text: string): boolean {
  const t = text.trim()
  if (t.length === 0) return true
  if (/[?？]\s*$/.test(t)) return true
  if (/^(what|why|how|when|where|who|which|explain|describe|tell me|is |are |can |does |do |did )/i.test(t)) return true
  if (/(뭐야|뭔가|뭐지|뭘까|왜|어때|인가요|인지|일까|설명|알려)/i.test(t)) return true
  return false
}

// ── Inline Edit ───────────────────────────────────────────────────────────────

export async function inlineEdit(
  filePath: string,
  fileContent: string,
  instruction: string,
  systemPrompt: string
): Promise<string> {
  const provider = getProvider()
  const model = getModel()

  const userMsg = `FILE: ${filePath}\n\n\`\`\`luau\n${fileContent}\n\`\`\`\n\nINSTRUCTION: ${instruction}`
  const system = `${systemPrompt}\n\nINLINE EDIT MODE: Return ONLY the complete modified file — no explanation, no markdown fences, no commentary. Raw Luau code only.`

  let text = ""

  if (provider === "openai") {
    const response = await getOpenAIClient().chat.completions.create({
      model,
      max_tokens: 8192,
      messages: [{ role: "system", content: system }, { role: "user", content: userMsg }]
    })
    text = response.choices[0]?.message?.content ?? fileContent
  } else {
    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: 8192,
      system: toCachedSystem(system),
      messages: [{ role: "user", content: userMsg }]
    })
    text = response.content[0].type === "text" ? response.content[0].text : fileContent
  }

  return text.replace(/^```(?:lua|luau)?\r?\n/m, "").replace(/\r?\n```$/m, "").trim()
}

// ── Agent Chat (스트리밍 + 도구 사용 + 중단 + 재시도) ──────────────────────

export interface AgentChatResult {
  modifiedFiles: string[]
  checkpoint: AgentCheckpoint
}

export async function agentChat(
  messages: ChatMessage[],
  systemPrompt: string,
  streamChannel: string,
  projectRoot?: string
): Promise<AgentChatResult> {
  const provider = getProvider()
  const model = getModel()
  const modifiedFiles: string[] = []
  const checkpoint = createCheckpoint()
  const controller = new AbortController()
  _setActiveAbortController(controller)
  const MAX_ROUNDS = 15
  const MAX_VERIFY_ROUNDS = 3

  const send = (text: string | null) => {
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send(streamChannel, text))
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? ""

  let result: AgentChatResult
  if (provider === "openai") {
    result = await agentChatOpenAI(messages, systemPrompt, streamChannel, model, modifiedFiles, checkpoint, controller, MAX_ROUNDS, MAX_VERIFY_ROUNDS, send, lastUserMsg, projectRoot)
  } else {
    result = await agentChatAnthropic(messages, systemPrompt, streamChannel, model, modifiedFiles, checkpoint, controller, MAX_ROUNDS, MAX_VERIFY_ROUNDS, send, lastUserMsg, projectRoot)
  }

  // Store checkpoint for IPC-based revert
  _lastCheckpoint = result.checkpoint.originals.size > 0 ? result.checkpoint : null

  return result
}

// ── OpenAI Agent Loop ────────────────────────────────────────────────────────

async function agentChatOpenAI(
  messages: ChatMessage[],
  systemPrompt: string,
  streamChannel: string,
  model: string,
  modifiedFiles: string[],
  checkpoint: AgentCheckpoint,
  controller: AbortController,
  MAX_ROUNDS: number,
  MAX_VERIFY_ROUNDS: number,
  send: (text: string | null) => void,
  lastUserMsg: string,
  projectRoot?: string
): Promise<AgentChatResult> {
  const history: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
  ]

  const isEmptyProject = systemPrompt.includes("(no modules found)")
  const skipPlan = isQuestion(lastUserMsg)
  let phase: AgentPhase = skipPlan ? "execute" : "plan"
  let firstExecuteRound = true
  let verifyRoundsUsed = 0
  let executeRoundsWithoutWrite = 0
  let lastLintErrors = ""

  try {
    // ── Plan phase: single API call, no tools ──────────────────────────────
    if (phase === "plan") {
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send(`${streamChannel}:round`, { round: 0, max: MAX_ROUNDS, phase: "plan" })
      )

      try {
        let planText = ""
        const planStream = await getOpenAIClient().chat.completions.create({
          model,
          max_tokens: 2048,
          stream: true,
          messages: [
            ...history,
            {
              role: "user" as const,
              content: "Before making changes, briefly outline your plan (2-3 bullets max). What files will you create or modify and why? Don't write code yet."
            }
          ]
          // NO tools — model can only output text
        })

        for await (const chunk of planStream) {
          if (controller.signal.aborted) break
          const content = chunk.choices[0]?.delta?.content
          if (content) {
            planText += content
            send(content)
          }
        }

        if (!controller.signal.aborted && planText) {
          history.push({ role: "assistant", content: planText })
          history.push({
            role: "user",
            content: "Execute this plan now. Use tools to create/edit files. After each file change, run lint_file to verify."
          })
        }
      } catch (planErr) {
        // Plan failed — proceed to execute without plan
        console.error("[Agent] Plan phase failed:", planErr)
      }

      phase = "execute"
    }

    // ── Execute + Verify loop ──────────────────────────────────────────────
    for (let round = 0; round < MAX_ROUNDS + MAX_VERIFY_ROUNDS; round++) {
      if (controller.signal.aborted) break

      // Auto-compress history when approaching token budget
      const systemTokens = estimateTokens(systemPrompt)
      await compressHistoryIfNeeded(
        history as unknown as Anthropic.MessageParam[],
        systemTokens
      )

      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send(`${streamChannel}:round`, { round: round + 1, max: MAX_ROUNDS, phase })
      )

      const excludeExploration = isEmptyProject && modifiedFiles.length === 0
      const openaiTools = getOpenAIToolsForExecution(excludeExploration)

      // Force tool use on first execute round (skip for questions)
      const forceExecute = phase === "execute" && firstExecuteRound && !isQuestion(lastUserMsg)
      const toolChoice = forceExecute ? "required" as const : "auto" as const

      if (phase === "execute" && firstExecuteRound) firstExecuteRound = false

      let retries = 0
      let assistantContent = ""
      const toolCalls: Array<{ id: string; name: string; args: string }> = []

      while (true) {
        try {
          const stream = await getOpenAIClient().chat.completions.create({
            model,
            max_tokens: 16384,
            stream: true,
            tools: openaiTools,
            tool_choice: toolChoice,
            messages: history
          })

          for await (const chunk of stream) {
            if (controller.signal.aborted) break
            const delta = chunk.choices[0]?.delta
            if (delta?.content) {
              assistantContent += delta.content
              send(delta.content)
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.index !== undefined) {
                  while (toolCalls.length <= tc.index) {
                    toolCalls.push({ id: "", name: "", args: "" })
                  }
                  if (tc.id) toolCalls[tc.index].id = tc.id
                  if (tc.function?.name) toolCalls[tc.index].name = tc.function.name
                  if (tc.function?.arguments) toolCalls[tc.index].args += tc.function.arguments
                }
              }
            }
          }
          break
        } catch (err) {
          if (controller.signal.aborted) throw err
          const msg = err instanceof Error ? err.message : String(err)
          if (/rate.?limit|429|500|503/i.test(msg) && retries < 2) {
            retries++
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, retries)))
            continue
          }
          throw err
        }
      }

      if (controller.signal.aborted) break

      // No tool calls — check phase transitions
      if (toolCalls.length === 0 || !toolCalls.some((tc) => tc.name)) {
        if ((phase === "execute" || phase === "verify") && modifiedFiles.length > 0) {
          const lintErrors = await lintModifiedFiles(modifiedFiles, streamChannel, true, projectRoot)
          if (lintErrors.length > 0) {
            const errorKey = lintErrors.join("\n")
            if (errorKey === lastLintErrors) {
              // Same errors as last time — stop looping
              break
            }
            lastLintErrors = errorKey
            if (assistantContent) history.push({ role: "assistant", content: assistantContent })
            history.push({
              role: "user",
              content: `[AUTO-VERIFY] Lint ERRORS found after your changes. Fix these errors (ignore warnings):\n\n${lintErrors.join("\n\n")}`
            })
            phase = "verify"
            continue
          }
        }
        break
      }

      // Build assistant message with tool_calls
      const assistantMsg: ChatCompletionMessageParam = {
        role: "assistant",
        content: assistantContent || null,
        tool_calls: toolCalls.filter((tc) => tc.name).map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.args }
        }))
      }
      history.push(assistantMsg)

      // Execute tools (with per-round limit + checkpoint)
      let toolsProcessed = 0
      for (const tc of toolCalls) {
        if (!tc.name || controller.signal.aborted) continue

        if (toolsProcessed >= MAX_TOOLS_PER_ROUND) {
          history.push({
            role: "tool",
            tool_call_id: tc.id,
            content: "Skipped: tool call limit reached for this turn. Continue in the next turn."
          })
          continue
        }

        try {
          const input = JSON.parse(tc.args || "{}")

          // Security: block dangerous tools unless user explicitly requested
          if (DANGEROUS_TOOLS.has(tc.name)) {
            const dangerPath = String(input.path ?? "")
            const userMentionedDelete = /delete|remove|삭제|지워/i.test(lastUserMsg)
            if (!userMentionedDelete) {
              history.push({
                role: "tool",
                tool_call_id: tc.id,
                content: `Blocked: ${tc.name} was not explicitly requested by the user. Ask the user before deleting files. File: ${dangerPath}`
              })
              continue
            }
          }

          // Checkpoint: save original before write tools modify the file
          if (WRITE_TOOL_NAMES.has(tc.name)) {
            const filePath = String(input.path ?? "")
            if (filePath) saveToCheckpoint(checkpoint, filePath)
          }

          const result = await executeTool(tc.name, input, projectRoot)
          toolsProcessed++
          if (result.filePath) modifiedFiles.push(result.filePath)

          BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send(`${streamChannel}:tool`, {
              tool: tc.name,
              input,
              output: result.output,
              success: result.success
            })
          })

          history.push({
            role: "tool",
            tool_call_id: tc.id,
            content: microCompact(tc.name, result.output)
          })
        } catch (toolErr) {
          history.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Tool error: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`
          })
        }
      }

      // Detect stalling: execute/verify phase but no write tools used
      if (phase === "execute" || phase === "verify") {
        const roundToolNames = toolCalls.map((tc) => tc.name).filter(Boolean)
        const usedWrite = roundToolNames.some((n) => WRITE_TOOL_NAMES.has(n))
        const allReadOnly = roundToolNames.length > 0 && roundToolNames.every((n) => READ_ONLY_TOOLS.has(n))

        if (usedWrite) {
          executeRoundsWithoutWrite = 0
        } else {
          executeRoundsWithoutWrite++
          if (executeRoundsWithoutWrite >= 2 && allReadOnly) {
            // Earlier intervention when ALL tools are read-only
            history.push({
              role: "user",
              content: "You have spent multiple rounds only reading files without making changes. You have enough context now. Use create_file or edit_file to implement the requested changes immediately."
            })
            executeRoundsWithoutWrite = 0
          } else if (executeRoundsWithoutWrite >= 3) {
            history.push({
              role: "user",
              content: "You have been exploring for several rounds without making changes. Use create_file or edit_file NOW to implement what was requested."
            })
            executeRoundsWithoutWrite = 0
          }
        }
      }

      // Enforce verify round limits
      if (phase === "verify") {
        verifyRoundsUsed++
        if (verifyRoundsUsed >= MAX_VERIFY_ROUNDS) break
      }
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      send(`\n\nAgent error: ${err instanceof Error ? err.message : String(err)}`)
    }
  } finally {
    _setActiveAbortController(null)
  }

  send(null)
  return { modifiedFiles, checkpoint }
}

// ── Anthropic Agent Loop ─────────────────────────────────────────────────────

async function agentChatAnthropic(
  messages: ChatMessage[],
  systemPrompt: string,
  streamChannel: string,
  model: string,
  modifiedFiles: string[],
  checkpoint: AgentCheckpoint,
  controller: AbortController,
  MAX_ROUNDS: number,
  MAX_VERIFY_ROUNDS: number,
  send: (text: string | null) => void,
  lastUserMsg: string,
  projectRoot?: string
): Promise<AgentChatResult> {
  const history: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content
  }))

  const systemTokens = estimateTokens(systemPrompt)
  truncateHistory(history, systemTokens)

  const isEmptyProject = systemPrompt.includes("(no modules found)")
  const skipPlan = isQuestion(lastUserMsg)
  let phase: AgentPhase = skipPlan ? "execute" : "plan"
  let firstExecuteRound = true
  let verifyRoundsUsed = 0
  let executeRoundsWithoutWrite = 0
  let lastLintErrors = ""

  try {
    // ── Plan phase: single API call, no tools ──────────────────────────────
    if (phase === "plan") {
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send(`${streamChannel}:round`, { round: 0, max: MAX_ROUNDS, phase: "plan" })
      )

      try {
        // Append plan instruction to last user message (Anthropic requires alternating roles)
        const planHistory: Anthropic.MessageParam[] = history.map((m, i) => {
          if (i === history.length - 1 && m.role === "user") {
            const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
            return {
              role: "user" as const,
              content: content + "\n\n[Before making changes, briefly outline your plan (2-3 bullets max). What files will you create or modify and why? Don't write code yet.]"
            }
          }
          return m
        })

        const planStream = getAnthropicClient().messages.stream(
          {
            model,
            max_tokens: 2048,
            system: toCachedSystem(systemPrompt),
            messages: planHistory
            // NO tools — model can only output text
          },
          { signal: controller.signal }
        )

        let planText = ""
        for await (const event of planStream) {
          if (controller.signal.aborted) { planStream.abort(); break }
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            const text = (event.delta as { type: "text_delta"; text: string }).text
            planText += text
            send(text)
          }
        }

        if (!controller.signal.aborted && planText) {
          history.push({ role: "assistant", content: planText })
          history.push({
            role: "user",
            content: "Execute this plan now. Use tools to create/edit files. After each file change, run lint_file to verify."
          })
        }
      } catch (planErr) {
        // Plan failed — proceed to execute without plan
        console.error("[Agent] Plan phase failed:", planErr)
      }

      phase = "execute"
    }

    // ── Execute + Verify loop ──────────────────────────────────────────────
    for (let round = 0; round < MAX_ROUNDS + MAX_VERIFY_ROUNDS; round++) {
      if (controller.signal.aborted) break

      // Auto-compress history when approaching token budget
      await compressHistoryIfNeeded(history, systemTokens)

      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send(`${streamChannel}:round`, { round: round + 1, max: MAX_ROUNDS, phase })
      )

      const excludeExploration = isEmptyProject && modifiedFiles.length === 0
      const currentTools = getToolsForExecution(excludeExploration)

      // Force tool use on first execute round (skip for questions)
      const forceExecute = phase === "execute" && firstExecuteRound && !isQuestion(lastUserMsg)
      const toolChoice: Anthropic.MessageCreateParams["tool_choice"] =
        forceExecute ? { type: "any" } : { type: "auto" }

      if (phase === "execute" && firstExecuteRound) firstExecuteRound = false

      let response: Anthropic.Message | undefined
      let retries = 0

      while (true) {
        try {
          const stream = getAnthropicClient().messages.stream(
            {
              model,
              max_tokens: 16384,
              system: toCachedSystem(systemPrompt),
              tools: toCachedTools(currentTools),
              tool_choice: toolChoice,
              messages: history
            },
            { signal: controller.signal }
          )

          for await (const event of stream) {
            if (controller.signal.aborted) { stream.abort(); break }
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              send((event.delta as { type: "text_delta"; text: string }).text)
            }
          }

          if (!controller.signal.aborted) {
            response = await stream.finalMessage()
          }
          break
        } catch (err) {
          if (controller.signal.aborted) throw err
          const msg = err instanceof Error ? err.message : String(err)
          if (/overloaded|rate.?limit|529|500/i.test(msg) && retries < 2) {
            retries++
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, retries)))
            continue
          }
          throw err
        }
      }

      if (controller.signal.aborted || !response) break

      if (response.stop_reason === "end_turn") {
        if ((phase === "execute" || phase === "verify") && modifiedFiles.length > 0) {
          const lintErrors = await lintModifiedFiles(modifiedFiles, streamChannel, true, projectRoot)
          if (lintErrors.length > 0) {
            const errorKey = lintErrors.join("\n")
            if (errorKey === lastLintErrors) break
            lastLintErrors = errorKey
            history.push({ role: "assistant", content: response.content })
            history.push({
              role: "user",
              content: `[AUTO-VERIFY] Lint ERRORS found after your changes. Fix these errors (ignore warnings):\n\n${lintErrors.join("\n\n")}`
            })
            phase = "verify"
            continue
          }
        }
        break
      }

      if (response.stop_reason === "tool_use") {
        history.push({ role: "assistant", content: response.content })
        const toolResults: Anthropic.ToolResultBlockParam[] = []
        const toolBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        )
        let toolsProcessed = 0

        for (const block of toolBlocks) {
          if (controller.signal.aborted) break

          if (toolsProcessed >= MAX_TOOLS_PER_ROUND) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: "Skipped: tool call limit reached for this turn. Continue in the next turn.",
              is_error: true
            })
            continue
          }

          try {
            const input = block.input as Record<string, unknown>

            // Security: block dangerous tools unless user explicitly requested
            if (DANGEROUS_TOOLS.has(block.name)) {
              const dangerPath = String(input.path ?? "")
              const userMentionedDelete = /delete|remove|삭제|지워/i.test(lastUserMsg)
              if (!userMentionedDelete) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Blocked: ${block.name} was not explicitly requested by the user. Ask the user before deleting files. File: ${dangerPath}`,
                  is_error: true
                })
                continue
              }
            }

            // Checkpoint: save original before write tools modify the file
            if (WRITE_TOOL_NAMES.has(block.name)) {
              const filePath = String(input.path ?? "")
              if (filePath) saveToCheckpoint(checkpoint, filePath)
            }

            const result = await executeTool(block.name, input, projectRoot)
            toolsProcessed++
            if (result.filePath) modifiedFiles.push(result.filePath)

            BrowserWindow.getAllWindows().forEach((win) => {
              win.webContents.send(`${streamChannel}:tool`, {
                tool: block.name,
                input: block.input,
                output: result.output,
                success: result.success
              })
            })

            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: microCompact(block.name, result.output) })
          } catch (toolErr) {
            const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr)
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Tool error: ${errMsg}`,
              is_error: true
            })
          }
        }

        history.push({ role: "user", content: toolResults })
      } else {
        break
      }

      // Detect stalling: execute/verify phase but no write tools used
      if ((phase === "execute" || phase === "verify") && response) {
        const roundToolNames = response.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          .map((b) => b.name)
        const usedWrite = roundToolNames.some((n) => WRITE_TOOL_NAMES.has(n))
        const allReadOnly = roundToolNames.length > 0 && roundToolNames.every((n) => READ_ONLY_TOOLS.has(n))

        if (usedWrite) {
          executeRoundsWithoutWrite = 0
        } else {
          executeRoundsWithoutWrite++
          const shouldNudge =
            (executeRoundsWithoutWrite >= 2 && allReadOnly) ||
            executeRoundsWithoutWrite >= 3

          if (shouldNudge) {
            const nudgeText = allReadOnly
              ? "You have spent multiple rounds only reading files without making changes. You have enough context now. Use create_file or edit_file to implement the requested changes immediately."
              : "You have been exploring for several rounds without making changes. Use create_file or edit_file NOW to implement what was requested."
            const last = history[history.length - 1]
            if (last?.role === "user" && Array.isArray(last.content)) {
              const arr = last.content as unknown[]
              arr.push({ type: "text", text: nudgeText })
            }
            executeRoundsWithoutWrite = 0
          }
        }
      }

      // Enforce verify round limits
      if (phase === "verify") {
        verifyRoundsUsed++
        if (verifyRoundsUsed >= MAX_VERIFY_ROUNDS) break
      }
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      send(`\n\nAgent error: ${err instanceof Error ? err.message : String(err)}`)
    }
  } finally {
    _setActiveAbortController(null)
  }

  send(null)
  return { modifiedFiles, checkpoint }
}
