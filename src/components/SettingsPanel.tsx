import { useState, useEffect } from "react"
import { useSettingsStore } from "../stores/settingsStore"
import { useT } from "../i18n/useT"

interface SettingsPanelProps {
  onClose: () => void
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ko", label: "한국어" }
]

interface ModelEntry { id: string; label: string }
interface ProviderModels { anthropic: ModelEntry[]; openai: ModelEntry[] }

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
            {saving ? "…" : t("save")}
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
            {isSet ? "●●●●●●●●●●●●●●●●" : "Not configured"}
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

export function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  const { language, setLanguage, apiKey, setApiKey, openaiKey, setOpenAIKey, provider, setProvider, model, setModel } = useSettingsStore()
  const t = useT()
  const [models, setModels] = useState<ProviderModels>({ anthropic: [], openai: [] })
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setVisible(true))

    window.api.aiGetProviderModel().then((result: { provider: string; model: string; models: ProviderModels }) => {
      setProvider(result.provider)
      setModel(result.model)
      setModels(result.models)
    })
  }, [])

  const handleClose = () => {
    setVisible(false)
    setTimeout(onClose, 180)
  }

  const handleSetProvider = async (p: string) => {
    await window.api.aiSetProvider(p)
    const result = await window.api.aiGetProviderModel()
    setProvider(result.provider)
    setModel(result.model)
  }

  const handleSetModel = async (m: string) => {
    await window.api.aiSetModel(m)
    setModel(m)
  }

  const currentModels = models[provider as keyof ProviderModels] ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: `rgba(5,8,15,${visible ? "0.75" : "0"})`,
        backdropFilter: visible ? "blur(8px)" : "none",
        transition: "all 0.18s ease"
      }}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div
        className="w-[440px] rounded-2xl overflow-hidden"
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.05) inset",
          transform: visible ? "translateY(0) scale(1)" : "translateY(10px) scale(0.98)",
          opacity: visible ? 1 : 0,
          transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
            {t("settings")}
          </span>
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-100"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-5">
          {/* Language */}
          <div className="flex flex-col gap-2">
            <SectionLabel>{t("language")}</SectionLabel>
            <div className="flex gap-2">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => setLanguage(lang.code)}
                  className="px-4 py-1.5 rounded-lg text-xs transition-all duration-150"
                  style={{
                    background: language === lang.code ? "var(--accent)" : "var(--bg-elevated)",
                    color: language === lang.code ? "white" : "var(--text-secondary)",
                    border: `1px solid ${language === lang.code ? "transparent" : "var(--border)"}`,
                    fontWeight: language === lang.code ? 500 : 400
                  }}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: "1px", background: "var(--border-subtle)" }} />

          {/* AI Provider */}
          <div className="flex flex-col gap-2">
            <SectionLabel>AI Provider</SectionLabel>
            <div className="flex gap-2">
              {(["anthropic", "openai"] as const).map((p) => (
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
                  {p === "anthropic" ? "Anthropic" : "OpenAI"}
                </button>
              ))}
            </div>
          </div>

          {/* Model selector */}
          {currentModels.length > 0 && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Model</SectionLabel>
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

          {/* API Keys */}
          {provider === "anthropic" && (
            <KeyField
              label="Claude API Key"
              placeholder="sk-ant-api03-…"
              isSet={!!apiKey}
              onSave={async (key) => {
                await window.api.aiSetKey(key)
                setApiKey(key)
              }}
            />
          )}
          {provider === "openai" && (
            <KeyField
              label="OpenAI API Key"
              placeholder="sk-proj-…"
              isSet={!!openaiKey}
              onSave={async (key) => {
                await window.api.aiSetOpenAIKey(key)
                setOpenAIKey(key)
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <span style={{ fontSize: "10px", color: "var(--text-ghost)" }}>{t("version")}</span>
        </div>
      </div>
    </div>
  )
}
