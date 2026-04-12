import type Anthropic from "@anthropic-ai/sdk"
import type OpenAI from "openai"
import type { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import { store } from "../store"
import { BrowserWindow } from "electron"

// ── Lazy SDK loaders ─────────────────────────────────────────────────────────
// AI SDKs are large (~650KB total) and pulled in only when the user actually
// triggers chat. Dynamic imports keep them out of the cold-start critical path.

let _AnthropicCtor: typeof Anthropic | null = null
let _OpenAICtor: typeof OpenAI | null = null
let _GeminiCtor: typeof GoogleGenerativeAI | null = null

async function loadAnthropic(): Promise<typeof Anthropic> {
  if (!_AnthropicCtor) {
    const mod = await import("@anthropic-ai/sdk")
    _AnthropicCtor = mod.default
  }
  return _AnthropicCtor
}

async function loadOpenAI(): Promise<typeof OpenAI> {
  if (!_OpenAICtor) {
    const mod = await import("openai")
    _OpenAICtor = mod.default
  }
  return _OpenAICtor
}

async function loadGemini(): Promise<typeof GoogleGenerativeAI> {
  if (!_GeminiCtor) {
    const mod = await import("@google/generative-ai")
    _GeminiCtor = mod.GoogleGenerativeAI
  }
  return _GeminiCtor
}

// ── Agent types (used by pro/index.ts — implementation in pro/modules.ts) ──

export interface AgentChatResult {
  modifiedFiles: string[]
}

export type Provider = "anthropic" | "openai" | "gemini" | "local"

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
  ],
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }
  ],
  local: []
}

// ── State ────────────────────────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null
let openaiClient: OpenAI | null = null
let geminiClient: GoogleGenerativeAI | null = null
let localClient: OpenAI | null = null
let localClientEndpoint: string | null = null
let localClientKey: string | null = null
let activeAbortController: AbortController | null = null

// ── Token Usage Tracking ──────────────────────────────────────────────────────
let _tokenUsage = { input: 0, output: 0, cacheRead: 0 }

export function trackUsage(input: number, output: number, cacheRead = 0): void {
  _tokenUsage.input += input
  _tokenUsage.output += output
  _tokenUsage.cacheRead += cacheRead
  broadcastUsage()
}

/** Broadcast current totals with optional output estimate added on top */
function broadcastUsage(outputEstimate = 0): void {
  const payload = { ..._tokenUsage }
  if (outputEstimate > 0) payload.output += outputEstimate
  BrowserWindow.getAllWindows().forEach((win) =>
    win.webContents.send("ai:token-usage", payload)
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
  if (provider === "local") return store.get("localModel") as string ?? "llama3"
  return MODELS[provider][0].id
}

export async function getAnthropicClient(): Promise<Anthropic> {
  if (!anthropicClient) {
    const apiKey = store.get("apiKey") as string | undefined
    if (!apiKey) throw new Error("Anthropic API key not set")
    const AnthropicCtor = await loadAnthropic()
    anthropicClient = new AnthropicCtor({ apiKey, timeout: 60_000 })
  }
  return anthropicClient
}

export async function getOpenAIClient(): Promise<OpenAI> {
  if (!openaiClient) {
    const apiKey = store.get("openaiKey") as string | undefined
    if (!apiKey) throw new Error("OpenAI API key not set")
    const OpenAICtor = await loadOpenAI()
    openaiClient = new OpenAICtor({ apiKey, timeout: 60_000 })
  }
  return openaiClient
}

export async function getGeminiClient(): Promise<GoogleGenerativeAI> {
  if (!geminiClient) {
    const apiKey = store.get("geminiKey") as string | undefined
    if (!apiKey) throw new Error("Gemini API key not set")
    const GeminiCtor = await loadGemini()
    geminiClient = new GeminiCtor(apiKey)
  }
  return geminiClient
}

async function getGeminiModel(systemPrompt?: string): Promise<GenerativeModel> {
  const client = await getGeminiClient()
  return client.getGenerativeModel({
    model: getModel(),
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {})
  })
}

export async function getLocalClient(): Promise<OpenAI> {
  const endpoint = (store.get("localEndpoint") as string) || "http://localhost:11434/v1"
  const apiKey = (store.get("localKey") as string) || "ollama"
  if (!localClient || localClientEndpoint !== endpoint || localClientKey !== apiKey) {
    const OpenAICtor = await loadOpenAI()
    localClient = new OpenAICtor({ baseURL: endpoint, apiKey, timeout: 120_000 })
    localClientEndpoint = endpoint
    localClientKey = apiKey
  }
  return localClient
}

/** Used by agent.ts to manage abort controller state */
export function _setActiveAbortController(c: AbortController | null): void {
  activeAbortController = c
}

// ── Settings API ─────────────────────────────────────────────────────────────

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

export function setGeminiKey(key: string): void {
  store.set("geminiKey", key)
  geminiClient = null
}

export function getGeminiKey(): string | undefined {
  return store.get("geminiKey") as string | undefined
}

export function setLocalEndpoint(endpoint: string): void {
  store.set("localEndpoint", endpoint)
  localClient = null
}

export function getLocalEndpoint(): string {
  return (store.get("localEndpoint") as string) || "http://localhost:11434/v1"
}

export function setLocalKey(key: string): void {
  store.set("localKey", key)
  localClient = null
}

export function getLocalKey(): string {
  return (store.get("localKey") as string) || ""
}

export function setLocalModel(model: string): void {
  store.set("localModel", model)
}

export function getLocalModel(): string {
  return (store.get("localModel") as string) || ""
}

export async function fetchLocalModels(): Promise<Array<{ id: string; label: string }>> {
  try {
    const client = await getLocalClient()
    const list = await withTimeout(client.models.list(), 10_000)
    const models: Array<{ id: string; label: string }> = []
    for await (const m of list) {
      models.push({ id: m.id, label: m.id })
    }
    return models
  } catch {
    return []
  }
}

export function setProvider(provider: Provider): void {
  store.set("provider", provider)
  // Reset to the provider's default model
  if (provider === "local") {
    const localModel = (store.get("localModel") as string) || ""
    store.set("model", localModel)
    return
  }
  store.set("model", MODELS[provider][0].id)
}

export function setModel(model: string): void {
  store.set("model", model)
}

export function setAdvisorEnabled(enabled: boolean): void {
  store.set("advisorEnabled", enabled)
}

export function getAdvisorEnabled(): boolean {
  return (store.get("advisorEnabled") as boolean | undefined) ?? false
}

/** Advisor is usable only with Anthropic non-Opus models */
export function isAdvisorAvailable(): boolean {
  return getProvider() === "anthropic" &&
    getAdvisorEnabled() &&
    !getModel().includes("opus")
}

export function getProviderAndModel(): { provider: Provider; model: string } {
  return { provider: getProvider(), model: getModel() }
}

// ── Abort Support ──────────────────────────────────────────────────────────────

export function abortAgent(): void {
  if (activeAbortController) {
    activeAbortController.abort()
    activeAbortController = null
  }
}

// ── Timeout Utility ────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms = 30_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timeout (${ms / 1000}s)`)), ms)
    )
  ])
}

// ── Rate Limit Retry ──────────────────────────────────────────────────────────

function is429(err: unknown): number | null {
  const status = (err as { status?: number })?.status
  if (status === 429) {
    const retryAfter = (err as { headers?: Record<string, string> })?.headers?.["retry-after"]
    const parsed = Number(retryAfter)
    return (!isNaN(parsed) && parsed > 0) ? Math.min(parsed, 30) : 5
  }
  return null
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const waitSec = is429(err)
      if (waitSec === null || attempt >= maxRetries) throw err
      await new Promise((r) => setTimeout(r, waitSec * 1000))
    }
  }
}

// ── Common Message Types ─────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

// ── Provider Helpers ─────────────────────────────────────────────────────────

async function getOpenAICompat(): Promise<{ client: OpenAI; timeout: number }> {
  return getProvider() === "local"
    ? { client: await getLocalClient(), timeout: 120_000 }
    : { client: await getOpenAIClient(), timeout: 60_000 }
}

function toGeminiContents(messages: ChatMessage[]) {
  return messages.map(m => ({
    role: m.role === "assistant" ? "model" as const : "user" as const,
    parts: [{ text: m.content }]
  }))
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

// ── Basic Chat ────────────────────────────────────────────────────────────────

export async function chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
  const provider = getProvider()
  const model = getModel()

  if (provider === "openai" || provider === "local") {
    const { client, timeout } = await getOpenAICompat()
    const response = await withRetry(() => withTimeout(client.chat.completions.create({
      model,
      ...(provider === "local" ? {} : { max_tokens: 8192 }),
      messages: [{ role: "system", content: systemPrompt }, ...messages]
    }), timeout))
    return response.choices[0]?.message?.content ?? ""
  }

  if (provider === "gemini") {
    const geminiModel = await getGeminiModel(systemPrompt)
    const response = await withRetry(() => withTimeout(
      geminiModel.generateContent({
        contents: toGeminiContents(messages)
      }),
      60_000
    ))
    return response.response.text()
  }

  const anthropic = await getAnthropicClient()
  const response = await withRetry(() => withTimeout(anthropic.messages.create({
    model, max_tokens: 8192,
    system: toCachedSystem(systemPrompt),
    messages
  })))
  trackUsage(
    response.usage.input_tokens,
    response.usage.output_tokens,
    response.usage.cache_read_input_tokens ?? 0
  )
  return response.content[0].type === "text" ? response.content[0].text : ""
}

// ── Streaming Chat ─────────────────────────────────────────────────────────────

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
    if (provider === "openai" || provider === "local") {
      const { client, timeout } = await getOpenAICompat()
      const stream = await withTimeout(client.chat.completions.create({
        model,
        ...(provider === "local" ? {} : { max_tokens: 8192 }),
        stream: true,
        messages: [{ role: "system", content: systemPrompt }, ...messages]
      }), timeout)
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content
        if (text) send(text)
      }
      send(null)
      return
    }

    if (provider === "gemini") {
      const geminiModel = await getGeminiModel(systemPrompt)
      const result = await withTimeout(
        geminiModel.generateContentStream({
          contents: toGeminiContents(messages),
          tools: [{ googleSearchRetrieval: {} }]
        }),
        60_000
      )
      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) send(text)
      }
      send(null)
      return
    }

    const anthropic = await getAnthropicClient()
    const useAdvisor = isAdvisorAvailable()
    const advisorTool = useAdvisor ? [{
      type: "advisor_20260301" as const,
      name: "advisor" as const,
      model: "claude-opus-4-6" as const,
      max_uses: 5,
      caching: { type: "ephemeral" as const }
    }] : []

    const stream = useAdvisor
      ? anthropic.beta.messages.stream({
          model,
          max_tokens: 8192,
          system: toCachedSystem(systemPrompt),
          messages,
          tools: advisorTool,
          betas: ["advisor-tool-2026-03-01"]
        })
      : anthropic.messages.stream({
          model,
          max_tokens: 8192,
          system: toCachedSystem(systemPrompt),
          messages
        })

    let streamedChars = 0
    let inputTracked = false
    let advisorBlockIndex = -1
    for await (const chunk of stream) {
      if (chunk.type === "message_start" && !inputTracked) {
        const msg = (chunk as unknown as { message: { usage: { input_tokens: number; cache_read_input_tokens?: number } } }).message
        trackUsage(msg.usage.input_tokens, 0, msg.usage.cache_read_input_tokens ?? 0)
        inputTracked = true
      } else if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        const text = (chunk.delta as { type: "text_delta"; text: string }).text
        send(text)
        streamedChars += text.length
        broadcastUsage(Math.ceil(streamedChars / 4))
      }
      // Advisor indicator — same pattern as agent.ts
      if (
        useAdvisor &&
        chunk.type === "content_block_start" &&
        // SAFETY: beta advisor events include content_block.name (advisor-tool-2026-03-01)
        (chunk as unknown as { content_block: { name?: string } }).content_block?.name === "advisor"
      ) {
        advisorBlockIndex = (chunk as unknown as { index: number }).index
        BrowserWindow.getAllWindows().forEach((win) =>
          win.webContents.send(`${streamChannel}:advisor`, true)
        )
      }
      if (
        useAdvisor &&
        chunk.type === "content_block_stop" &&
        advisorBlockIndex >= 0 &&
        (chunk as unknown as { index: number }).index === advisorBlockIndex
      ) {
        advisorBlockIndex = -1
        BrowserWindow.getAllWindows().forEach((win) =>
          win.webContents.send(`${streamChannel}:advisor`, false)
        )
      }
    }
    const finalMessage = await stream.finalMessage()
    const cache = finalMessage.usage.cache_read_input_tokens ?? 0
    if (!inputTracked) {
      trackUsage(finalMessage.usage.input_tokens, finalMessage.usage.output_tokens, cache)
    } else {
      trackUsage(0, finalMessage.usage.output_tokens, 0)
    }
    send(null)
  } catch (err) {
    // Clean up stuck advisor indicator on stream error
    if (isAdvisorAvailable()) {
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send(`${streamChannel}:advisor`, false)
      )
    }
    const waitSec = is429(err)
    if (waitSec !== null) {
      send(`\n\nRate limited. Please wait ${waitSec}s and try again.`)
      send(null)
    } else {
      sendError(err)
    }
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
