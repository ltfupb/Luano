import { useState, useEffect } from "react"
import { useSettingsStore } from "../stores/settingsStore"
import { useT } from "../i18n/useT"
import { track, Events } from "../analytics"

interface ModelEntry { id: string; label: string }
export interface ProviderModels { anthropic: ModelEntry[]; openai: ModelEntry[]; gemini: ModelEntry[]; local: ModelEntry[] }

interface ManagedUsage {
  period_ym: string
  used: number
  cap: number
  remaining: number
  cache_hit_rate: number
  resets_at: number
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini", local: "Local"
}

const PROVIDERS = ["anthropic", "openai", "gemini", "local"] as const

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 600,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        color: "var(--text-muted)"
      }}
    >
      {children}
    </span>
  )
}

function KeyField({
  label,
  placeholder,
  isSet,
  onSave
}: {
  label: string
  placeholder: string
  isSet: boolean
  onSave: (key: string) => Promise<void>
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState("")
  const [saving, setSaving] = useState(false)
  const t = useT()

  const handleSave = async () => {
    if (!input.trim()) return
    setSaving(true)
    await onSave(input.trim())
    setInput("")
    setEditing(false)
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>{label}</SectionLabel>
      {editing ? (
        <div className="flex gap-2">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder={placeholder}
            autoFocus
            className="flex-1 rounded-lg px-3 py-2 transition-all duration-150 focus:outline-none"
            style={{
              background: "var(--bg-base)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontSize: "12px"
            }}
            onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
            onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-2 rounded-lg font-medium transition-all duration-150 disabled:opacity-50"
            style={{ background: "var(--accent)", color: "white", fontSize: "12px" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
          >
            {saving ? "\u2026" : t("save")}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-3 py-2 rounded-lg transition-all duration-150"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: "12px", border: "1px solid var(--border)" }}
          >
            {t("cancel")}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div
            className="flex-1 rounded-lg px-3 py-2"
            style={{
              background: "var(--bg-base)",
              border: "1px solid var(--border-subtle)",
              fontSize: "12px",
              color: isSet ? "var(--text-muted)" : "var(--text-ghost)"
            }}
          >
            {isSet ? "\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf" : t("notConfigured")}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-2 rounded-lg transition-all duration-150 flex-shrink-0"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              fontSize: "12px",
              border: "1px solid var(--border)"
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border)" }}
          >
            {isSet ? t("apiKeySet") : t("apiKeyNotSet")}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Cloud Provider Key Configs ───────────────────────────────────────────────

const KEY_CONFIGS: Record<string, { translationKey: string; placeholder: string; storeKey: string; ipcSet: string }> = {
  anthropic: { translationKey: "apiKey", placeholder: "sk-ant-api03-\u2026", storeKey: "apiKey", ipcSet: "aiSetKey" },
  openai: { translationKey: "openaiKey", placeholder: "sk-proj-\u2026", storeKey: "openaiKey", ipcSet: "aiSetOpenAIKey" },
  gemini: { translationKey: "geminiKey", placeholder: "AIza\u2026", storeKey: "geminiKey", ipcSet: "aiSetGeminiKey" }
}

// ── Component ────────────────────────────────────────────────────────────────

export function SettingsAI({ models, setModels }: {
  models: ProviderModels
  setModels: React.Dispatch<React.SetStateAction<ProviderModels>>
}): JSX.Element {
  const {
    apiKey, setApiKey, openaiKey, setOpenAIKey, geminiKey, setGeminiKey,
    localEndpoint, setLocalEndpoint, localModel, setLocalModel,
    provider, setProvider, prevByokProvider, setPrevByokProvider, model, setModel,
    advisorEnabled, setAdvisorEnabled,
    thinkingEffort, setThinkingEffort
  } = useSettingsStore()
  const t = useT()
  const [localModelsLoading, setLocalModelsLoading] = useState(false)
  const [localKey, setLocalKeyState] = useState("")
  const [localKeyLoaded, setLocalKeyLoaded] = useState(false)
  const [managedUsage, setManagedUsage] = useState<ManagedUsage | null>(null)
  const [managedUsageLoading, setManagedUsageLoading] = useState(false)
  const [managedUsageFailed, setManagedUsageFailed] = useState(false)
  const isManaged = provider === "managed"

  useEffect(() => {
    if (provider === "local" && !localKeyLoaded) {
      window.api.aiGetLocalKey().then(k => {
        setLocalKeyState(k ?? "")
        setLocalKeyLoaded(true)
      })
    }
    if (provider === "managed" && !managedUsage && !managedUsageLoading && !managedUsageFailed) {
      setManagedUsageLoading(true)
      window.api.managedFetchUsage().then(u => {
        setManagedUsage(u)
        setManagedUsageLoading(false)
        if (!u) setManagedUsageFailed(true)
      }).catch(() => {
        setManagedUsageLoading(false)
        setManagedUsageFailed(true)
      })
    }
  }, [provider, localKeyLoaded, managedUsage, managedUsageLoading, managedUsageFailed])

  const handleSetProvider = async (p: string) => {
    const prev = provider
    if (p === prev) return
    if (prev !== "managed" && p === "managed") setPrevByokProvider(prev)
    await window.api.aiSetProvider(p)
    const result = await window.api.aiGetProviderModel()
    setProvider(result.provider)
    setModel(result.model)
    track(Events.MANAGED_SWITCHED_TO, {
      from: prev === "managed" ? "managed" : "byok",
      to: p === "managed" ? "managed" : "byok",
    })
  }

  const handleSetModel = async (m: string) => {
    await window.api.aiSetModel(m)
    setModel(m)
  }

  const keyStoreSetters: Record<string, (k: string) => void> = {
    apiKey: setApiKey, openaiKey: setOpenAIKey, geminiKey: setGeminiKey
  }
  const keyStoreValues: Record<string, string> = { apiKey, openaiKey, geminiKey }

  const currentModels = models[provider as keyof ProviderModels] ?? []

  return (
    <>
      {/* Managed / BYOK mode selector */}
      <div className="flex flex-col gap-2">
        <SectionLabel>{t("aiMode")}</SectionLabel>
        <div className="flex gap-2">
          <button
            onClick={() => handleSetProvider("managed")}
            className="flex-1 px-3 py-2 rounded-lg text-xs transition-all duration-150 text-left"
            style={{
              background: isManaged ? "var(--accent)" : "var(--bg-elevated)",
              color: isManaged ? "white" : "var(--text-secondary)",
              border: `1px solid ${isManaged ? "transparent" : "var(--border)"}`,
              fontWeight: isManaged ? 500 : 400
            }}
          >
            <div style={{ fontWeight: 500 }}>{t("managedLabel")}</div>
            <div style={{ fontSize: "10px", opacity: 0.8, marginTop: 1 }}>{t("managedLabelHint")}</div>
          </button>
          <button
            onClick={() => {
              if (!isManaged) return
              // If saved prev provider has no credentials, fall back to one that does,
              // else anthropic so the key input is shown immediately.
              const hasKey = (p: string) =>
                (p === "anthropic" && apiKey) ||
                (p === "openai" && openaiKey) ||
                (p === "gemini" && geminiKey) ||
                (p === "local" && localEndpoint && localModel)
              const target = hasKey(prevByokProvider)
                ? prevByokProvider
                : (["anthropic","openai","gemini","local"] as const).find(hasKey) ?? "anthropic"
              handleSetProvider(target)
            }}
            className="flex-1 px-3 py-2 rounded-lg text-xs transition-all duration-150 text-left"
            style={{
              background: !isManaged ? "var(--accent)" : "var(--bg-elevated)",
              color: !isManaged ? "white" : "var(--text-secondary)",
              border: `1px solid ${!isManaged ? "transparent" : "var(--border)"}`,
              fontWeight: !isManaged ? 500 : 400
            }}
          >
            <div style={{ fontWeight: 500 }}>{t("byokLabel")}</div>
            <div style={{ fontSize: "10px", opacity: 0.8, marginTop: 1 }}>{t("byokLabelHint")}</div>
          </button>
        </div>
      </div>

      {/* Managed usage dashboard */}
      {isManaged && (
        <div className="flex flex-col gap-2">
          <SectionLabel>{t("managedUsageTitle")}</SectionLabel>
          {managedUsageLoading ? (
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Loading...</span>
          ) : managedUsage ? (
            <div className="flex flex-col gap-1.5">
              {/* Progress bar */}
              <div className="flex items-center justify-between">
                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  {(managedUsage.used / 1_000_000).toFixed(2)}M / {(managedUsage.cap / 1_000_000).toFixed(1)}M tokens
                </span>
                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                  {t("managedResetsAt")} {new Date(managedUsage.resets_at * 1000).toLocaleDateString()}
                </span>
              </div>
              <div className="w-full rounded-full overflow-hidden" style={{ height: 4, background: "var(--bg-elevated)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (managedUsage.used / managedUsage.cap) * 100)}%`,
                    background: managedUsage.used / managedUsage.cap > 0.95
                      ? "var(--error)"
                      : managedUsage.used / managedUsage.cap > 0.8
                      ? "var(--warning)"
                      : "var(--accent)"
                  }}
                />
              </div>
            </div>
          ) : (
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{t("managedUsageUnavailable")}</span>
          )}
          <span style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.4 }}>
            {t("managedModelNote")}
          </span>
        </div>
      )}

      {/* BYOK: Provider Toggle */}
      {!isManaged && (
      <div className="flex flex-col gap-2">
        <SectionLabel>{t("aiProvider")}</SectionLabel>
        <div className="flex gap-2 flex-wrap">
          {PROVIDERS.map((p) => (
            <button
              key={p}
              onClick={() => handleSetProvider(p)}
              className="px-4 py-1.5 rounded-lg text-xs transition-all duration-150"
              style={{
                background: provider === p ? "var(--accent)" : "var(--bg-elevated)",
                color: provider === p ? "white" : "var(--text-secondary)",
                border: `1px solid ${provider === p ? "transparent" : "var(--border)"}`,
                fontWeight: provider === p ? 500 : 400
              }}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Model selector (cloud providers) */}
      {!isManaged && provider !== "local" && currentModels.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>{t("aiModel")}</SectionLabel>
          <select
            value={model}
            onChange={(e) => handleSetModel(e.target.value)}
            className="rounded-lg px-3 py-2 focus:outline-none transition-all duration-150"
            style={{
              background: "var(--bg-base)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontSize: "12px"
            }}
            onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
            onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
          >
            {currentModels.map((m) => (
              <option key={m.id} value={m.id} style={{ background: "var(--bg-panel)" }}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Thinking Effort — only where the model supports it */}
      {(isManaged
        || (provider === "anthropic" && (model.includes("opus") || model.includes("sonnet")))
        || (provider === "openai" && /^o[1-9]/.test(model))) && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <SectionLabel>Thinking Effort</SectionLabel>
            <select
              value={thinkingEffort}
              onChange={async (e) => {
                const v = e.target.value as "low" | "medium" | "high" | "xhigh" | "max"
                setThinkingEffort(v)
                await window.api.aiSetThinkingEffort(v)
              }}
              className="px-2 py-1 rounded-md outline-none"
              style={{
                background: "var(--bg-base)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
                fontSize: "12px"
              }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">Extra High</option>
              <option value="max">Max</option>
            </select>
          </div>
          <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
            Extended thinking budget. Higher = deeper reasoning, slower + more tokens. Matches Claude Code.
          </span>
        </div>
      )}

      {/* Advisor Toggle — Anthropic or Managed non-Opus only */}
      {(isManaged || (provider === "anthropic" && !model.includes("opus"))) && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <SectionLabel>{t("advisor" as never)}</SectionLabel>
            <button
              onClick={async () => {
                const next = !advisorEnabled
                setAdvisorEnabled(next)
                await window.api.aiSetAdvisor(next)
              }}
              className="relative w-8 h-[18px] rounded-full transition-all duration-200"
              style={{
                background: advisorEnabled ? "var(--accent)" : "var(--bg-base)",
                border: `1px solid ${advisorEnabled ? "transparent" : "var(--border)"}`
              }}
            >
              <span
                className="absolute top-[2px] w-3 h-3 rounded-full transition-all duration-200"
                style={{
                  background: advisorEnabled ? "white" : "var(--text-muted)",
                  left: advisorEnabled ? "16px" : "2px"
                }}
              />
            </button>
          </div>
          <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
            {t("advisorHint" as never)}
          </span>
        </div>
      )}

      {/* Cloud API Keys */}
      {!isManaged && KEY_CONFIGS[provider] && (
        <KeyField
          label={t(KEY_CONFIGS[provider].translationKey as never)}
          placeholder={KEY_CONFIGS[provider].placeholder}
          isSet={!!keyStoreValues[KEY_CONFIGS[provider].storeKey]}
          onSave={async (key) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (window.api as any)[KEY_CONFIGS[provider].ipcSet](key)
            keyStoreSetters[KEY_CONFIGS[provider].storeKey](key)
          }}
        />
      )}

      {/* Local provider config */}
      {!isManaged && provider === "local" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <SectionLabel>{t("localEndpoint")}</SectionLabel>
            <input
              type="text"
              value={localEndpoint}
              onChange={(e) => {
                setLocalEndpoint(e.target.value)
                window.api.aiSetLocalEndpoint(e.target.value)
              }}
              placeholder="http://localhost:11434/v1"
              className="rounded-lg px-3 py-2 text-xs focus:outline-none transition-all duration-150"
              style={{
                background: "var(--bg-base)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                fontFamily: "monospace"
              }}
              onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
              onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
            />
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              Ollama, LM Studio, vLLM {t("localEndpointHint")}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <SectionLabel>{t("localApiKey")}</SectionLabel>
            <input
              type="password"
              value={localKey}
              onChange={(e) => {
                setLocalKeyState(e.target.value)
                window.api.aiSetLocalKey(e.target.value)
              }}
              placeholder="Bearer token"
              className="rounded-lg px-3 py-2 text-xs focus:outline-none transition-all duration-150"
              style={{
                background: "var(--bg-base)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                fontFamily: "monospace"
              }}
              onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
              onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
            />
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              {t("localApiKeyHint")}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <SectionLabel>{t("aiModel")}</SectionLabel>
              <button
                onClick={async () => {
                  setLocalModelsLoading(true)
                  const fetched = await window.api.aiFetchLocalModels()
                  setModels(prev => ({ ...prev, local: fetched }))
                  setLocalModelsLoading(false)
                }}
                disabled={localModelsLoading}
                className="px-2 py-0.5 rounded-md text-[10px] transition-all duration-100"
                style={{ color: "var(--accent)", border: "1px solid var(--border)" }}
              >
                {localModelsLoading ? "..." : t("localFetchModels")}
              </button>
            </div>
            {models.local.length > 0 ? (
              <select
                value={localModel}
                onChange={(e) => {
                  setLocalModel(e.target.value)
                  handleSetModel(e.target.value)
                  window.api.aiSetLocalModel(e.target.value)
                }}
                className="rounded-lg px-3 py-2 focus:outline-none transition-all duration-150"
                style={{
                  background: "var(--bg-base)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  fontSize: "12px"
                }}
                onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
                onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
              >
                {!localModel && <option value="">Select a model...</option>}
                {models.local.map((m) => (
                  <option key={m.id} value={m.id} style={{ background: "var(--bg-panel)" }}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={localModel}
                onChange={(e) => {
                  setLocalModel(e.target.value)
                  handleSetModel(e.target.value)
                  window.api.aiSetLocalModel(e.target.value)
                }}
                placeholder="llama3, qwen2.5-coder, deepseek-r1..."
                className="rounded-lg px-3 py-2 text-xs focus:outline-none transition-all duration-150"
                style={{
                  background: "var(--bg-base)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)"
                }}
                onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
                onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}
