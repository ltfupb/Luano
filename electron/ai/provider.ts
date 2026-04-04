import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { store } from "../store"
import { BrowserWindow } from "electron"

// ── Agent types (used by pro/index.ts — implementation in pro/modules.ts) ──

export interface AgentChatResult {
  modifiedFiles: string[]
}

export type Provider = "anthropic" | "openai"

export const MODELS: Record<Provider, Array<{ id: string; label: string }>> = {
  anthropic: [
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
    { id: "claude-opus-4-6", label: "Opus 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" }
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { id: "o1", label: "o1" },
    { id: "o1-mini", label: "o1 mini" }
  ]
}

// ── 상태 ────────────────────────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null
let openaiClient: OpenAI | null = null
let activeAbortController: AbortController | null = null

// ── 토큰 사용량 추적 ──────────────────────────────────────────────────────────
let _tokenUsage = { input: 0, output: 0, cacheRead: 0 }

export function trackUsage(input: number, output: number, cacheRead = 0): void {
  _tokenUsage.input += input
  _tokenUsage.output += output
  _tokenUsage.cacheRead += cacheRead
  // Notify renderer
  BrowserWindow.getAllWindows().forEach((win) =>
    win.webContents.send("ai:token-usage", { ..._tokenUsage })
  )
}

export function getTokenUsage(): { input: number; output: number; cacheRead: number } {
  return { ..._tokenUsage }
}

export function resetTokenUsage(): void {
  _tokenUsage = { input: 0, output: 0, cacheRead: 0 }
}

export function getProvider(): Provider {
  return (store.get("provider") as Provider | undefined) ?? "anthropic"
}

export function getModel(): string {
  const provider = getProvider()
  const stored = store.get("model") as string | undefined
  if (stored) return stored
  return MODELS[provider][0].id
}

export function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = store.get("apiKey") as string | undefined
    if (!apiKey) throw new Error("Anthropic API key not set")
    anthropicClient = new Anthropic({ apiKey })
  }
  return anthropicClient
}

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = store.get("openaiKey") as string | undefined
    if (!apiKey) throw new Error("OpenAI API key not set")
    openaiClient = new OpenAI({ apiKey })
  }
  return openaiClient
}

/** Used by agent.ts to manage abort controller state */
export function _setActiveAbortController(c: AbortController | null): void {
  activeAbortController = c
}

// ── 설정 API ─────────────────────────────────────────────────────────────────

export function setApiKey(key: string): void {
  store.set("apiKey", key)
  anthropicClient = null
}

export function getApiKey(): string | undefined {
  return store.get("apiKey") as string | undefined
}

export function setOpenAIKey(key: string): void {
  store.set("openaiKey", key)
  openaiClient = null
}

export function getOpenAIKey(): string | undefined {
  return store.get("openaiKey") as string | undefined
}

export function setProvider(provider: Provider): void {
  store.set("provider", provider)
  // 해당 프로바이더의 첫 번째 모델로 초기화
  store.set("model", MODELS[provider][0].id)
}

export function setModel(model: string): void {
  store.set("model", model)
}

export function getProviderAndModel(): { provider: Provider; model: string } {
  return { provider: getProvider(), model: getModel() }
}

// ── Abort 지원 ──────────────────────────────────────────────────────────────

export function abortAgent(): void {
  if (activeAbortController) {
    activeAbortController.abort()
    activeAbortController = null
  }
}

// ── 타임아웃 유틸 ────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms = 30_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timeout (${ms / 1000}s)`)), ms)
    )
  ])
}

// ── 공통 메시지 타입 ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

// ── Prompt Caching (Anthropic cache_control) ────────────────────────────────

type CachedTextBlock = {
  type: "text"
  text: string
  cache_control?: { type: "ephemeral" }
}

/**
 * Split system prompt into cached (static rules) + uncached (dynamic context).
 * Static rules (~3K tokens) are cached via cache_control, saving ~90% on cache hits.
 */
export function toCachedSystem(systemPrompt: string): CachedTextBlock[] {
  const marker = "\nPROJECT CONTEXT:"
  const idx = systemPrompt.indexOf(marker)
  if (idx === -1) {
    return [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
  }
  return [
    { type: "text", text: systemPrompt.slice(0, idx), cache_control: { type: "ephemeral" } },
    { type: "text", text: systemPrompt.slice(idx) }
  ]
}

/** Add cache_control to the last tool definition to cache all tool schemas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toCachedTools<T extends Record<string, any>>(tools: T[]): T[] {
  if (tools.length === 0) return tools
  return tools.map((tool, i) =>
    i === tools.length - 1 ? { ...tool, cache_control: { type: "ephemeral" } } : tool
  )
}

// ── 기본 채팅 ────────────────────────────────────────────────────────────────

export async function chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
  const provider = getProvider()
  const model = getModel()

  if (provider === "openai") {
    const response = await withTimeout(getOpenAIClient().chat.completions.create({
      model,
      max_tokens: 8192,
      messages: [{ role: "system", content: systemPrompt }, ...messages]
    }))
    return response.choices[0]?.message?.content ?? ""
  }

  const response = await withTimeout(getAnthropicClient().messages.create({
    model,
    max_tokens: 8192,
    system: toCachedSystem(systemPrompt),
    messages
  }))
  trackUsage(
    response.usage.input_tokens,
    response.usage.output_tokens,
    (response.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0
  )
  return response.content[0].type === "text" ? response.content[0].text : ""
}

// ── 스트리밍 채팅 ─────────────────────────────────────────────────────────────

export async function chatStream(
  messages: ChatMessage[],
  systemPrompt: string,
  streamChannel: string
): Promise<void> {
  const provider = getProvider()
  const model = getModel()

  const send = (text: string | null) => {
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send(streamChannel, text))
  }
  const sendError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send(streamChannel, `\n\nError: ${msg}`)
    )
    send(null)
  }

  try {
    if (provider === "openai") {
      const stream = await getOpenAIClient().chat.completions.create({
        model,
        max_tokens: 8192,
        stream: true,
        messages: [{ role: "system", content: systemPrompt }, ...messages]
      })
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content
        if (text) send(text)
      }
      send(null)
      return
    }

    const stream = getAnthropicClient().messages.stream({
      model,
      max_tokens: 8192,
      system: toCachedSystem(systemPrompt),
      messages
    })
    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        send((chunk.delta as { type: "text_delta"; text: string }).text)
      }
    }
    const finalMessage = await stream.finalMessage()
    trackUsage(
      finalMessage.usage.input_tokens,
      finalMessage.usage.output_tokens,
      (finalMessage.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0
    )
    send(null)
  } catch (err) {
    sendError(err)
  }
}

// ── Plan Chat ─────────────────────────────────────────────────────────────────

export async function planChat(messages: ChatMessage[], systemPrompt: string): Promise<string[]> {
  const planPrompt = `${systemPrompt}

PLAN MODE: Before executing anything, output ONLY a JSON array of steps you will take to fulfill the user's request. Do not write any code or modify files yet.
Format strictly: ["Step 1: description", "Step 2: description", ...]
Output ONLY the JSON array — no explanation, no markdown fences.`

  let text = ""
  try {
    text = await chat(messages, planPrompt)
  } catch {
    return ["Unable to generate plan — check API key or connection"]
  }

  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return [text.trim().slice(0, 300)]
  try {
    const parsed = JSON.parse(match[0])
    if (Array.isArray(parsed)) return parsed.map(String).slice(0, 12)
  } catch {}
  return [text.trim().slice(0, 300)]
}
