import type Anthropic from "@anthropic-ai/sdk"
import type OpenAI from "openai"
import type { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import { EventEmitter } from "node:events"
import { store } from "../store"
import { BrowserWindow } from "electron"
import { log } from "../logger"

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
 *
 * `senderId` (when set) scopes the per-stream `:advisor`/`:thinking` events to
 * the originating window (H4 sender-scoping). Without it the events broadcast
 * to every renderer that knows the streamChannel UUID.
 */
export class StreamBlockTracker {
  private advisorIdx = -1
  private thinkingIdx = -1

  constructor(
    private streamChannel: string,
    private advisorEnabled: boolean = true,
    private senderId?: number
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
    const channel = `${this.streamChannel}:${kind}`
    if (this.senderId !== undefined) {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.id === this.senderId)
      if (win && !win.webContents.isDestroyed()) win.webContents.send(channel, active)
      return
    }
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send(channel, active))
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
  // Broadcast the zeroed counters so every renderer window clears its
  // displayed totals. Without this, the UI keeps showing the pre-reset values
  // until the next trackUsage() call arrives.
  broadcastUsage()
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
  // Invalidate ALL cached SDK clients so every provider re-initializes with
  // the new timeout on the next call. Missing any of these leaves stale clients
  // using the old timeout until process restart.
  anthropicClient = null
  managedClient = null
  openaiClient = null
  geminiClient = null
  localClient = null
  localClientEndpoint = null
  localClientKey = null
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
  if (managedClient) return managedClient

  const license = store.get<ManagedLicenseData>("license")
  if (!license?.key || !license.valid) {
    throw new Error("Pro license required for Managed AI")
  }
  const AnthropicCtor = await loadAnthropic()
  managedClient = new AnthropicCtor({
    baseURL: MANAGED_BASE_URL,
    apiKey: license.key,
    defaultHeaders: { "X-Instance-Id": license.instanceId },
    timeout: getNetworkTimeoutMs(),
  })
  return managedClient
}

/**
 * Clear the cached managed client so the next request re-initializes it with
 * a fresh read of the license key. Called in two places:
 *  1. After each chat/stream completes — minimizes the window the license
 *     key lives in memory (shrinks from "until app quit" to "until this
 *     turn ends").
 *  2. From license IPC handlers on activate/deactivate — ensures the next
 *     Managed request picks up the new key or bails out loudly if revoked.
 *
 * Tradeoff: pays ~1 SDK-construct cost per managed request (small — the
 * Anthropic SDK constructor is pure JS, no network I/O).
 */
export function clearManagedClient(): void {
  managedClient = null
}

/**
 * Resolve the Anthropic SDK client + effective model for the current provider.
 * "managed" swaps to the proxy client and forces the allowlisted model;
 * "anthropic" uses the user's BYOK client with the requested model.
 * Callers on the OpenAI/Gemini/local paths handle those providers separately.
 */
export async function getAnthropicPath(requestedModel: string): Promise<{ client: Anthropic; model: string }> {
  if (getProvider() === "managed") {
    return { client: await getManagedClient(), model: MANAGED_MODEL }
  }
  return { client: await getAnthropicClient(), model: requestedModel }
}

export interface ManagedRequestCompletedEvent {
  duration_ms: number
  cached_ratio: number
  input_tok: number
  output_tok: number
  model: string
}

/**
 * Emit a Managed-specific IPC event scoped to the originating window. Used
 * for cap-exceeded modal trigger and request-completed analytics. When
 * senderId is missing (legacy callers), broadcasts — kept as a fallback,
 * but every Managed-aware code path passes senderId today.
 *
 * Overloaded so TypeScript catches mismatched payload shapes at the call site
 * (cap-exceeded sends an empty object; request-completed sends usage metrics).
 */
export function emitManagedEvent(channel: "managed:cap-exceeded", payload: Record<string, never>, senderId?: number): void
export function emitManagedEvent(channel: "managed:request-completed", payload: ManagedRequestCompletedEvent, senderId?: number): void
export function emitManagedEvent(channel: "managed:cap-exceeded" | "managed:request-completed", payload: object, senderId?: number): void {
  if (senderId === undefined) {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload))
    return
  }
  const win = BrowserWindow.getAllWindows().find((w) => w.webContents.id === senderId)
  if (win && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
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
    if (!res.ok) {
      log.warn(`[managed] usage fetch returned ${res.status}`)
      return null
    }
    const data = await res.json() as ManagedUsageData
    if (
      typeof data?.used !== "number" || !isFinite(data.used) ||
      typeof data?.cap !== "number" || !isFinite(data.cap) || data.cap <= 0
    ) {
      log.warn("[managed] usage payload malformed:", data)
      return null
    }
    return data
  } catch (err) {
    log.warn("[managed] usage fetch failed:", err)
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

/**
 * Advisor is BYOK-Anthropic only on non-Opus models.
 *
 * Managed AI is intentionally excluded: advisor spawns a server-side Opus
 * subagent and its tokens roll up into the main response's usage field.
 * The Worker meter currently prices everything at Sonnet rates, so any
 * advisor usage in Managed mode silently under-bills us. Re-enable once
 * the meter can separate advisor-attributable Opus tokens.
 */
export function isAdvisorAvailable(): boolean {
  return getProvider() === "anthropic" &&
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

/**
 * Auto-accept: ambient state, NOT captured per turn. Read at every tool-call
 * decision so the renderer's mid-turn toggle takes effect immediately on the
 * next tool. The emitter lets in-flight approval prompts self-resolve when
 * the flag flips ON.
 *
 * Lives in main process so renderer (zustand) and main agree via a single
 * setter IPC. Renderer is UI; main is source of truth.
 */
export const autoAcceptEmitter = new EventEmitter()

export function getAutoAccept(): boolean {
  return store.get("autoAccept") === true
}

export function setAutoAccept(value: boolean): void {
  const prev = getAutoAccept()
  store.set("autoAccept", value === true)
  if (prev !== (value === true)) autoAcceptEmitter.emit("change", value === true)
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
  "claude-haiku-4-5-20251001",
  "gpt-4o", "gpt-4-turbo", "o1",
  "gemini-2.5-pro",
  "gemini-2.5-flash"  // M2: was missing, caused standard-tier scaffolding on every request
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
    log.info("[agent] abort requested by user")
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
 * Split system prompt into cached (static rules) + uncached (dynamic context),
 * with an optional uncached suffix block.
 *
 * The optional `suffix` block is for system-level content that must NOT live
 * in the message history — e.g. the agent's tool-output sentinel
 * announcement. Stuffing that into a user-content text block makes the model
 * see "user sent only metadata, empty input" right after a tool_use round
 * and respond with a generic greeting. Putting it in a third system block
 * keeps it clearly system-level.
 *
 * NOTE: this block is uncached. Keep its content STABLE across the session
 * (e.g. one sentinel UUID per session, not per turn) — anything that
 * varies between API calls breaks every cache_control breakpoint after it.
 */
export function toCachedSystem(systemPrompt: string, perCallSuffix?: string): CachedTextBlock[] {
  const marker = "\nPROJECT CONTEXT:"
  const idx = systemPrompt.indexOf(marker)
  const blocks: CachedTextBlock[] = idx === -1
    ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
    : [
        { type: "text", text: systemPrompt.slice(0, idx), cache_control: { type: "ephemeral" } },
        { type: "text", text: systemPrompt.slice(idx) }
      ]
  if (perCallSuffix) blocks.push({ type: "text", text: perCallSuffix })
  return blocks
}

/** Add cache_control to the last tool definition to cache all tool schemas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toCachedTools<T extends Record<string, any>>(tools: T[]): T[] {
  if (tools.length === 0) return tools
  return tools.map((tool, i) =>
    i === tools.length - 1 ? { ...tool, cache_control: { type: "ephemeral" } } : tool
  )
}

/**
 * Add cache_control breakpoints to the last TWO user-role messages so multi-
 * round sessions stop re-paying full price for tool results that already
 * shipped in earlier rounds.
 *
 * Why two: Anthropic only performs cache lookups AT explicit cache_control
 * breakpoints. If round N marks only its new last message, round N+1 (with
 * a different new last) can't find round N's cache entry. Marking the last
 * two user messages keeps an "anchor" (prior round's edge, still cached)
 * plus a new "edge" so the chain extends across rounds.
 *
 * Budget: Anthropic allows 4 cache_control parameters per request. We use
 * 1 for system + 1 for tools + 2 here = 4 (exactly at limit).
 *
 * Pattern matches Claude Code / Cursor convention.
 *
 * Returns a copy — never mutates input. String-content messages are
 * converted to single-text-block array form so cache_control can attach.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withMessageCacheControl<T extends { role: string; content: any }>(messages: T[]): T[] {
  if (messages.length === 0) return messages

  // Find the last 2 user-role message indices (most recent first). Tool
  // results are user-role too, so they count.
  const userIndices: number[] = []
  for (let i = messages.length - 1; i >= 0 && userIndices.length < 2; i--) {
    if (messages[i].role === "user") userIndices.push(i)
  }

  if (userIndices.length === 0) return messages

  const result = [...messages]
  for (const idx of userIndices) {
    result[idx] = applyCacheControlToBlock(result[idx])
  }
  return result
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCacheControlToBlock<T extends { role: string; content: any }>(msg: T): T {
  // String content → wrap in a single text block with cache_control.
  if (typeof msg.content === "string") {
    return {
      ...msg,
      content: [{ type: "text", text: msg.content, cache_control: { type: "ephemeral" } }]
    } as T
  }
  // Array content (tool_result, multi-block text) → mark the LAST block.
  if (Array.isArray(msg.content) && msg.content.length > 0) {
    const blocks = [...msg.content]
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } }
    return { ...msg, content: blocks } as T
  }
  return msg
}

// ── Basic Chat ────────────────────────────────────────────────────────────────

// H5: optional AbortSignal so callers (compressHistoryIfNeeded) can cancel
// an in-flight LLM summarization when the agent session is aborted.
export async function chat(messages: ChatMessage[], systemPrompt: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return ""
  const provider = getProvider()
  const model = getModel()

  if (provider === "openai" || provider === "local") {
    const { client, timeout } = await getOpenAICompat()
    // H5: forward signal so an aborted compressHistoryIfNeeded cancels the
    // in-flight summarization on OpenAI/local providers too — Anthropic was
    // already covered, this closes the gap so all providers honor abort.
    const response = await withRetry(() => withTimeout(client.chat.completions.create({
      model,
      ...(provider === "local" ? {} : { max_tokens: 8192 }),
      messages: [{ role: "system", content: systemPrompt }, ...messages]
    }, signal ? { signal } : undefined), timeout))
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

  const { client: anthropic, model: effectiveModel } = await getAnthropicPath(model)
  try {
    const response = await withRetry(() => withTimeout(anthropic.messages.create({
      model: effectiveModel,
      max_tokens: 8192,
      system: toCachedSystem(systemPrompt),
      messages,
      ...(signal ? { signal } : {})
    })))
    // Managed proxy responses occasionally omit `.usage` (proxy implementation
    // detail). Guard so the missing field doesn't tank the entire chat() —
    // memory:auto-detect was throwing here after every agent session.
    if (response.usage) {
      trackUsage(
        response.usage.input_tokens,
        response.usage.output_tokens,
        response.usage.cache_read_input_tokens ?? 0
      )
    }
    // `response.content` is also occasionally missing on managed proxy
    // responses (same root cause as the .usage guard above). Defaulting to
    // empty string keeps callers (e.g. compressHistoryIfNeeded) safe.
    const first = response.content?.[0]
    return first?.type === "text" ? first.text : ""
  } finally {
    // Shrink license-key residency in memory — recreated next call (see clearManagedClient).
    if (provider === "managed") clearManagedClient()
  }
}

// ── Streaming Chat ─────────────────────────────────────────────────────────────

export async function chatStream(
  messages: ChatMessage[],
  systemPrompt: string,
  streamChannel: string,
  senderId?: number
): Promise<void> {
  const provider = getProvider()
  const model = getModel()

  // H4: resolve the originating WebContents once; send only to that window.
  // If senderId is provided but the WebContents was already destroyed, skip
  // the send rather than falling back to a broadcast.
  const resolveTarget = (): Electron.WebContents | null => {
    if (senderId === undefined) return null
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.id === senderId)
    return (win && !win.webContents.isDestroyed()) ? win.webContents : null
  }
  const send = (text: string | null) => {
    const target = resolveTarget()
    if (target) {
      target.send(streamChannel, text)
    } else if (senderId === undefined) {
      // No sender scoping requested — legacy broadcast path (should not occur
      // in normal flows since ai:chat-stream always passes senderId).
      BrowserWindow.getAllWindows().forEach((win) => win.webContents.send(streamChannel, text))
    }
    // If senderId was set but target is gone, drop the send silently.
  }
  const sendError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    const target = resolveTarget()
    if (target) {
      target.send(streamChannel, `\n\nError: ${msg}`)
    } else if (senderId === undefined) {
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send(streamChannel, `\n\nError: ${msg}`)
      )
    }
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

    const { client: anthropic, model: effectiveModel } = await getAnthropicPath(model)
    // Chat mode: no tools. Advisor belongs in Agent loop — sending advisor
    // here contradicts the "you have no tools" chat prompt and causes some
    // models to hallucinate tool-call markup in the text response.
    const controller = new AbortController()
    activeAbortController = controller
    const reqStart = Date.now()
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
    const blocks = new StreamBlockTracker(streamChannel, false, senderId)
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
    if (provider === "managed") {
      const inTok = finalMessage.usage.input_tokens
      const denom = inTok + cache
      emitManagedEvent("managed:request-completed", {
        duration_ms: Date.now() - reqStart,
        cached_ratio: denom > 0 ? cache / denom : 0,
        input_tok: inTok,
        output_tok: finalMessage.usage.output_tokens,
        model: effectiveModel,
      } satisfies ManagedRequestCompletedEvent, senderId)
    }
    send(null)
  } catch (err) {
    // Clear any stuck advisor/thinking indicator — StreamBlockTracker's
    // onStop never fires if the upstream errors mid-block.
    // H4: use the resolved target instead of broadcasting to all windows.
    const errTarget = resolveTarget()
    if (errTarget) {
      errTarget.send(`${streamChannel}:advisor`, false)
      errTarget.send(`${streamChannel}:thinking`, false)
    } else if (senderId === undefined) {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send(`${streamChannel}:advisor`, false)
        win.webContents.send(`${streamChannel}:thinking`, false)
      })
    }
    const waitSec = is429(err)
    if (provider === "managed" && waitSec !== null) {
      // Cap exceeded — surface a structured event so the renderer can show
      // the BYOK-fallback modal. The user-facing chat line is a fallback
      // explanation in case the modal is dismissed without action.
      log.warn("[chatStream] managed cap exceeded — emitting cap-exceeded event")
      emitManagedEvent("managed:cap-exceeded", {}, senderId)
      send(`\n\nMonthly token cap reached. See dialog to switch to BYOK.`)
      send(null)
    } else if (waitSec !== null) {
      log.warn(`[chatStream] rate limited — wait ${waitSec}s`)
      send(`\n\nRate limited. Please wait ${waitSec}s and try again.`)
      send(null)
    } else {
      log.error("[chatStream] stream error:", err)
      sendError(err)
    }
  } finally {
    // Always clear the controller so the next chatStream starts with a clean
    // slate. Previously this only fired on aborted streams, which meant a
    // non-abort error (rate limit, network) left a stale controller pinned —
    // abortAgent() would try to abort a dead stream and nothing would cancel
    // the live one.
    activeAbortController = null
    // Shrink license-key residency in memory — recreated next call (see clearManagedClient).
    if (provider === "managed") clearManagedClient()
  }
}

