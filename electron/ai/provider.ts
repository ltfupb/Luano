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

/** Anthropic stream event shapes not yet exposed in SDK public types — internal */
interface StreamContentBlockStart {
  type: "content_block_start"
  index: number
  content_block: { type: string; name?: string }
}
interface StreamContentBlockStop {
  type: "content_block_stop"
  index: number
}
interface StreamMessageStart {
  type: "message_start"
  message: { usage: { input_tokens: number; cache_read_input_tokens?: number } }
}

/**
 * Tracks advisor / thinking block lifecycle in Anthropic streams and broadcasts
 * start/stop events to renderer. Replaces ~30 lines of duplicated state logic
 * across agentChatAnthropic and chatStream.
 *
 * `advisorEnabled` defaults to true. Pass false when the advisor tool is not
 * registered for this stream — defensive guard against the model emitting an
 * unexpected advisor block, which would flash the renderer's advisor indicator.
 */
export class StreamBlockTracker {
  private advisorIdx = -1
  private thinkingIdx = -1

  constructor(
    private streamChannel: string,
    private advisorEnabled: boolean = true
  ) {}

  onStart(event: unknown): void {
    const cb = event as StreamContentBlockStart
    if (this.advisorEnabled && cb.content_block?.name === "advisor") {
      this.advisorIdx = cb.index
      this.broadcast("advisor", true)
    }
    if (cb.content_block?.type === "thinking") {
      this.thinkingIdx = cb.index
      this.broadcast("thinking", true)
    }
  }

  onStop(event: unknown): void {
    const idx = (event as StreamContentBlockStop).index
    if (this.advisorIdx >= 0 && idx === this.advisorIdx) {
      this.advisorIdx = -1
      this.broadcast("advisor", false)
    }
    if (this.thinkingIdx >= 0 && idx === this.thinkingIdx) {
      this.thinkingIdx = -1
      this.broadcast("thinking", false)
    }
  }

  private broadcast(kind: "advisor" | "thinking", active: boolean): void {
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send(`${this.streamChannel}:${kind}`, active)
    )
  }
}

export type Provider = "anthropic" | "openai" | "gemini" | "local" | "managed"

export const MANAGED_BASE_URL = "https://api.luano.dev"
export const MANAGED_MODEL = "claude-sonnet-4-6"

export const MODELS: Record<Provider, Array<{ id: string; label: string }>> = {
  anthropic: [
    { id: "claude-opus-4-7", label: "Opus 4.7" },
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
  local: [],
  managed: [
    { id: MANAGED_MODEL, label: "Sonnet 4.6 (Managed)" }
  ]
}

// ── State ────────────────────────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null
let managedClient: Anthropic | null = null
// License validity cache: avoid re-reading electron-store on every agent tick.
// License state only changes via licenseActivate/licenseDeactivate IPC (see
// invalidateManagedLicenseCache below) and on timeout-tuning path, both of which
// reset `managedClient` anyway — so caching validity for the life of the client
// is safe. Nulling managedClient implicitly invalidates this cache.
let managedLicenseKey: string | null = null
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

/** Network timeout bounds. Opus 4.7 long reasoning can exceed 60s, so the
 *  default is 180s. Values below MIN_NETWORK_TIMEOUT_MS are treated as unset. */
export const MIN_NETWORK_TIMEOUT_MS = 30_000
export const DEFAULT_NETWORK_TIMEOUT_MS = 180_000

export function getNetworkTimeoutMs(): number {
  const stored = store.get("networkTimeoutMs") as number | undefined
  return typeof stored === "number" && stored >= MIN_NETWORK_TIMEOUT_MS ? stored : DEFAULT_NETWORK_TIMEOUT_MS
}

export function setNetworkTimeoutMs(ms: number): void {
  store.set("networkTimeoutMs", ms)
  // Invalidate clients so they re-init with the new timeout
  anthropicClient = null
  managedClient = null
  managedLicenseKey = null
  openaiClient = null
}

export async function getAnthropicClient(): Promise<Anthropic> {
  if (!anthropicClient) {
    const apiKey = store.get("apiKey") as string | undefined
    if (!apiKey) throw new Error("Anthropic API key not set")
    const AnthropicCtor = await loadAnthropic()
    anthropicClient = new AnthropicCtor({ apiKey, timeout: getNetworkTimeoutMs() })
  }
  return anthropicClient
}

interface ManagedLicenseData { key: string; instanceId: string; valid: boolean }

export interface ManagedUsageData {
  period_ym: string
  used: number
  cap: number
  remaining: number
  cache_hit_rate: number
  resets_at: number
}

export async function getManagedClient(): Promise<Anthropic> {
  // Fast path: cached client still valid for the same license key
  if (managedClient && managedLicenseKey) return managedClient

  const license = store.get<ManagedLicenseData>("license")
  if (!license?.key || !license.valid) {
    managedClient = null
    managedLicenseKey = null
    throw new Error("Pro license required for Managed AI")
  }
  const AnthropicCtor = await loadAnthropic()
  managedClient = new AnthropicCtor({
    baseURL: MANAGED_BASE_URL,
    apiKey: license.key,
    defaultHeaders: { "X-Instance-Id": license.instanceId },
    timeout: getNetworkTimeoutMs(),
  })
  managedLicenseKey = license.key
  return managedClient
}

/** Called by the license IPC handlers on activate/deactivate. */
export function invalidateManagedLicenseCache(): void {
  managedClient = null
  managedLicenseKey = null
}

export function isManagedMode(): boolean {
  return getProvider() === "managed"
}

/** Fetch current Managed usage from the Worker. Returns null on error. */
export async function fetchManagedUsage(): Promise<ManagedUsageData | null> {
  const license = store.get<ManagedLicenseData>("license")
  if (!license?.key || !license.valid) return null
  try {
    const res = await fetch(`${MANAGED_BASE_URL}/v1/usage`, {
      headers: { Authorization: `Bearer ${license.key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = await res.json() as ManagedUsageData
    if (
      typeof data?.used !== "number" || !isFinite(data.used) ||
      typeof data?.cap !== "number" || !isFinite(data.cap) || data.cap <= 0
    ) return null
    return data
  } catch {
    return null
  }
}

export async function getOpenAIClient(): Promise<OpenAI> {
  if (!openaiClient) {
    const apiKey = store.get("openaiKey") as string | undefined
    if (!apiKey) throw new Error("OpenAI API key not set")
    const OpenAICtor = await loadOpenAI()
    openaiClient = new OpenAICtor({ apiKey, timeout: getNetworkTimeoutMs() })
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
  if (provider === "local") {
    const localModel = (store.get("localModel") as string) || ""
    store.set("model", localModel)
    return
  }
  if (provider === "managed") {
    store.set("model", MANAGED_MODEL)
    managedClient = null  // re-init on next request
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

/** Advisor is usable with Anthropic or Managed non-Opus Sonnet models */
export function isAdvisorAvailable(): boolean {
  const provider = getProvider()
  return (provider === "anthropic" || provider === "managed") &&
    getAdvisorEnabled() &&
    !getModel().includes("opus")
}

/**
 * Which Claude model the Advisor server-side tool should invoke.
 * Defaults to opus-4-6 — the known-working advisor model on the advisor_20260301 beta.
 * opus-4-7 compatibility with that beta is unverified as of this commit;
 * users can opt-in via Settings once verified.
 */
export function getAdvisorModel(): "claude-opus-4-7" | "claude-opus-4-6" | "claude-sonnet-4-6" {
  const stored = store.get("advisorModel") as string | undefined
  if (stored === "claude-opus-4-7" || stored === "claude-sonnet-4-6") return stored
  return "claude-opus-4-6"
}

export function setAdvisorModel(model: "claude-opus-4-7" | "claude-opus-4-6" | "claude-sonnet-4-6"): void {
  store.set("advisorModel", model)
}

/**
 * Extended thinking / reasoning effort — mirrors Claude Code's /effort levels.
 * Low for quick edits, max for heavy architectural reasoning.
 */
export type ThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max"

const EFFORT_LEVELS: ReadonlySet<ThinkingEffort> = new Set(["low", "medium", "high", "xhigh", "max"])

/** Anthropic extended-thinking token budget per effort level. Must stay below
 *  `max_tokens` on the request — agent.ts sizes max_tokens accordingly. */
export const ANTHROPIC_THINKING_BUDGET: Record<ThinkingEffort, number> = {
  low:    1024,
  medium: 4096,
  high:   16_384,
  xhigh:  32_768,
  max:    65_536
}

/** OpenAI reasoning_effort only has three levels; higher Luano levels all map to 'high'. */
export const OPENAI_REASONING_EFFORT: Record<ThinkingEffort, "low" | "medium" | "high"> = {
  low:    "low",
  medium: "medium",
  high:   "high",
  xhigh:  "high",
  max:    "high"
}

export function getThinkingEffort(): ThinkingEffort {
  const stored = store.get("thinkingEffort") as string | undefined
  return stored && EFFORT_LEVELS.has(stored as ThinkingEffort) ? (stored as ThinkingEffort) : "medium"
}

export function setThinkingEffort(effort: ThinkingEffort): void {
  store.set("thinkingEffort", effort)
}

/** Does the current (provider, model) accept a thinking / reasoning hint? */
export function supportsThinking(): boolean {
  const provider = getProvider()
  const model = getModel()
  if (provider === "managed") return true  // Sonnet 4.6 supports thinking
  if (provider === "anthropic") {
    return model.includes("opus") || model.includes("sonnet")
  }
  if (provider === "openai") {
    return /^o[1-9]/.test(model)
  }
  return false
}

/**
 * Model capability tier — drives prompt detail, round limits, and other
 * behaviors that should scale with how much the model can figure out on its own.
 *
 * `frontier` — latest Anthropic/OpenAI/Gemini top-tier. Trust inline planning,
 * slim prompts, shorter round budgets.
 * `standard` — smaller/older models, mini/flash variants, local. Need more
 * scaffolding: extended Luau guide, higher round budget.
 */
export type ModelTier = "frontier" | "standard"

const FRONTIER_MODELS = new Set([
  "claude-opus-4-7", "claude-sonnet-4-6", "claude-opus-4-6",
  "gpt-4o", "gpt-4-turbo", "o1",
  "gemini-2.5-pro"
])

export function getModelTier(): ModelTier {
  const provider = getProvider()
  if (provider === "local") return "standard"
  if (provider === "managed") return "frontier"  // always Sonnet 4.6
  return FRONTIER_MODELS.has(getModel()) ? "frontier" : "standard"
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

  const anthropic = provider === "managed" ? await getManagedClient() : await getAnthropicClient()
  const response = await withRetry(() => withTimeout(anthropic.messages.create({
    model: provider === "managed" ? MANAGED_MODEL : model,
    max_tokens: 8192,
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

    const anthropic = provider === "managed" ? await getManagedClient() : await getAnthropicClient()
    const effectiveModel = provider === "managed" ? MANAGED_MODEL : model
    // Chat mode: no tools. Advisor belongs in Agent loop — sending advisor
    // here contradicts the "you have no tools" chat prompt and causes some
    // models to hallucinate tool-call markup in the text response.
    const controller = new AbortController()
    activeAbortController = controller
    const stream = anthropic.messages.stream(
      {
        model: effectiveModel,
        max_tokens: 8192,
        system: toCachedSystem(systemPrompt),
        messages
      },
      { signal: controller.signal }
    )

    let streamedChars = 0
    let inputTracked = false
    const blocks = new StreamBlockTracker(streamChannel, false)
    for await (const chunk of stream) {
      if (chunk.type === "message_start" && !inputTracked) {
        const msg = (chunk as unknown as StreamMessageStart).message
        trackUsage(msg.usage.input_tokens, 0, msg.usage.cache_read_input_tokens ?? 0)
        inputTracked = true
      } else if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        const text = (chunk.delta as { type: "text_delta"; text: string }).text
        send(text)
        streamedChars += text.length
        broadcastUsage(Math.ceil(streamedChars / 4))
      }
      if (chunk.type === "content_block_start") blocks.onStart(chunk)
      if (chunk.type === "content_block_stop") blocks.onStop(chunk)
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
    // Clear any stuck advisor/thinking indicator — StreamBlockTracker's
    // onStop never fires if the upstream errors mid-block
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(`${streamChannel}:advisor`, false)
      win.webContents.send(`${streamChannel}:thinking`, false)
    })
    const waitSec = is429(err)
    if (waitSec !== null) {
      send(`\n\nRate limited. Please wait ${waitSec}s and try again.`)
      send(null)
    } else {
      sendError(err)
    }
  } finally {
    if (activeAbortController?.signal.aborted) activeAbortController = null
  }
}

