import { useState, useEffect } from "react"
import { useSettingsStore } from "../stores/settingsStore"
import { useProjectStore } from "../stores/projectStore"
import { useT } from "../i18n/useT"
import { SettingsAI, type ProviderModels } from "./SettingsAI"

interface SettingsPanelProps {
  onClose: () => void
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ko", label: "\ud55c\uad6d\uc5b4" }
]

interface CustomSkill {
  command: string
  label: string
  description: string
  prompt: string
}

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

const THEMES = [
  { id: "light" as const, label: "Light" },
  { id: "dark" as const, label: "Dark" },
  { id: "tokyo-night" as const, label: "Tokyo Night" }
]

// ── Skill Editor ────────────────────────────────────────────────────────────

const EMPTY_SKILL: CustomSkill = { command: "/", label: "", description: "", prompt: "" }

function SkillEditor({
  skill,
  onSave,
  onCancel
}: {
  skill: CustomSkill
  onSave: (s: CustomSkill) => void
  onCancel: () => void
}): JSX.Element {
  const [form, setForm] = useState<CustomSkill>(skill)
  const t = useT()

  const update = (key: keyof CustomSkill, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const valid = form.command.startsWith("/") && form.command.length > 1 && form.label.trim() && form.prompt.trim()

  const inputStyle = {
    background: "var(--bg-base)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
    fontSize: "12px",
    borderRadius: "6px",
    padding: "6px 10px",
    width: "100%",
    outline: "none"
  } as React.CSSProperties

  return (
    <div
      className="rounded-lg flex flex-col gap-2.5 p-3"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
    >
      <div className="flex gap-2">
        <div className="flex flex-col gap-1" style={{ width: 100 }}>
          <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{t("skillCommand")}</span>
          <input
            value={form.command}
            onChange={(e) => update("command", e.target.value.toLowerCase().replace(/\s/g, ""))}
            placeholder="/myskill"
            style={inputStyle}
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{t("skillLabel")}</span>
          <input
            value={form.label}
            onChange={(e) => update("label", e.target.value)}
            placeholder="My Skill"
            style={inputStyle}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{t("skillDescription")}</span>
        <input
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="What this skill does"
          style={inputStyle}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
          {t("skillPrompt")} <span style={{ opacity: 0.6 }}>({"{selection}"} = code, {"{file}"} = path)</span>
        </span>
        <textarea
          value={form.prompt}
          onChange={(e) => update("prompt", e.target.value)}
          placeholder="Analyze the following code and..."
          rows={3}
          className="resize-none focus:outline-none"
          style={{ ...inputStyle, lineHeight: "1.5" }}
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-xs transition-all duration-100"
          style={{ background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
        >
          {t("cancel")}
        </button>
        <button
          onClick={() => valid && onSave(form)}
          disabled={!valid}
          className="px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-100 disabled:opacity-30"
          style={{ background: "var(--accent)", color: "white" }}
        >
          {t("save")}
        </button>
      </div>
    </div>
  )
}

// ── Main Settings Panel ─────────────────────────────────────────────────────

export function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  const {
    language, setLanguage, theme, setTheme,
    setProvider, setModel, setAdvisorEnabled,
    autoSave, setAutoSave, autoSaveDelay, setAutoSaveDelay,
    fontSize, setFontSize,
    uiScale, setUiScale
  } = useSettingsStore()
  const { projectPath } = useProjectStore()
  const t = useT()
  const [models, setModels] = useState<ProviderModels>({ anthropic: [], openai: [], gemini: [], local: [] })
  const [visible, setVisible] = useState(false)
  const [customSkills, setCustomSkills] = useState<CustomSkill[]>([])
  const [editingSkill, setEditingSkill] = useState<{ index: number; skill: CustomSkill } | null>(null)
  const [telemetryEnabled, setTelemetryEnabled] = useState(false)
  const [proStatus, setProStatus] = useState<{ isPro: boolean } | null>(null)
  const [licenseInfo, setLicenseInfo] = useState<{ isActive: boolean; customerName?: string; customerEmail?: string } | null>(null)
  const [licenseKeyInput, setLicenseKeyInput] = useState("")
  const [licenseActivating, setLicenseActivating] = useState(false)
  const [licenseError, setLicenseError] = useState("")

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))

    window.api.aiGetProviderModel().then((result: { provider: string; model: string; models: ProviderModels }) => {
      setProvider(result.provider)
      setModel(result.model)
      setModels(result.models as ProviderModels)
    })
    window.api.aiGetAdvisor?.()?.then((v: boolean) => setAdvisorEnabled(v))

    // Load custom skills
    if (projectPath && typeof window.api.skillsLoad === "function") {
      window.api.skillsLoad(projectPath).then((raw) => {
        setCustomSkills((raw ?? []) as CustomSkill[])
      }).catch(() => {})
    }

    // Load telemetry and pro status
    window.api.telemetryIsEnabled().then((v: boolean) => setTelemetryEnabled(v)).catch(() => {})
    window.api.getProStatus().then((s: { isPro: boolean }) => setProStatus(s)).catch(() => {})
    window.api.licenseInfo().then(setLicenseInfo).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once on mount
  }, [])

  const handleClose = () => {
    setVisible(false)
    setTimeout(onClose, 180)
  }

  const saveSkills = async (skills: CustomSkill[]) => {
    setCustomSkills(skills)
    if (projectPath && typeof window.api.skillsSave === "function") {
      await window.api.skillsSave(projectPath, skills).catch(() => {})
    }
  }

  const handleSaveSkill = (skill: CustomSkill) => {
    if (editingSkill === null) return
    const next = [...customSkills]
    if (editingSkill.index === -1) {
      next.push(skill)
    } else {
      next[editingSkill.index] = skill
    }
    saveSkills(next)
    setEditingSkill(null)
  }

  const handleDeleteSkill = (index: number) => {
    const next = customSkills.filter((_, i) => i !== index)
    saveSkills(next)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: `rgba(5,8,15,${visible ? "0.15" : "0"})`,
        backdropFilter: visible ? "blur(8px)" : "none",
        transition: "all 0.18s ease"
      }}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div
        className="w-[480px] max-h-[85vh] rounded-2xl overflow-hidden flex flex-col"
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
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
            {t("settings")}
          </span>
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-100"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-5 overflow-y-auto">
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

          {/* Theme */}
          <div className="flex flex-col gap-2">
            <SectionLabel>{t("theme")}</SectionLabel>
            <div className="flex gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className="px-4 py-1.5 rounded-lg text-xs transition-all duration-150"
                  style={{
                    background: theme === t.id ? "var(--accent)" : "var(--bg-elevated)",
                    color: theme === t.id ? "white" : "var(--text-secondary)",
                    border: `1px solid ${theme === t.id ? "transparent" : "var(--border)"}`,
                    fontWeight: theme === t.id ? 500 : 400
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: "1px", background: "var(--border-subtle)" }} />

          {/* Editor */}
          <div className="flex flex-col gap-3">
            <SectionLabel>{t("editor")}</SectionLabel>

            {/* Auto Save */}
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSave}
                onChange={(e) => setAutoSave(e.target.checked)}
                className="accent-[var(--accent)]"
                style={{ width: 14, height: 14 }}
              />
              <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                {t("autoSave")}
              </span>
            </label>

            {autoSave && (
              <div className="flex items-center gap-2 pl-6">
                <span style={{ fontSize: "10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{t("delay")}</span>
                <select
                  value={autoSaveDelay}
                  onChange={(e) => setAutoSaveDelay(Number(e.target.value))}
                  className="rounded-md px-2 py-1 focus:outline-none"
                  style={{
                    background: "var(--bg-base)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                    fontSize: "11px"
                  }}
                >
                  <option value={500}>500ms</option>
                  <option value={1000}>1s</option>
                  <option value={2000}>2s</option>
                  <option value={5000}>5s</option>
                </select>
              </div>
            )}

            {/* Font Size */}
            <div className="flex items-center gap-2.5">
              <span style={{ fontSize: "11px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{t("fontSize")}</span>
              <input
                type="range"
                min={10}
                max={24}
                step={1}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
                style={{ height: 4 }}
              />
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  fontFamily: "monospace",
                  minWidth: 28,
                  textAlign: "right"
                }}
              >
                {fontSize}px
              </span>
            </div>

            {/* UI Scale */}
            <div className="flex items-center gap-2.5">
              <span style={{ fontSize: "11px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{t("uiScale")}</span>
              <input
                type="range"
                min={80}
                max={150}
                step={5}
                value={uiScale}
                onChange={(e) => setUiScale(Number(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
                style={{ height: 4 }}
              />
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  fontFamily: "monospace",
                  minWidth: 36,
                  textAlign: "right"
                }}
              >
                {uiScale}%
              </span>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: "1px", background: "var(--border-subtle)" }} />

          {/* AI Provider / Model / Keys */}
          <SettingsAI models={models} setModels={setModels} />

          {/* Divider */}
          <div style={{ height: "1px", background: "var(--border-subtle)" }} />

          {/* Skills */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <SectionLabel>{t("skills")}</SectionLabel>
              {projectPath && (
                <button
                  onClick={() => setEditingSkill({ index: -1, skill: { ...EMPTY_SKILL } })}
                  className="px-2 py-0.5 rounded-md text-xs transition-all duration-100"
                  style={{ color: "var(--accent)", border: "1px solid var(--border)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
                >
                  {t("skillNew")}
                </button>
              )}
            </div>

            {!projectPath && (
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                {t("skillOpenProject")}
              </span>
            )}

            {/* Existing custom skills */}
            {customSkills.map((skill, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg px-3 py-2"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
              >
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--accent)", fontFamily: "monospace", minWidth: 70 }}>
                  {skill.command}
                </span>
                <span className="flex-1" style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  {skill.label}
                </span>
                <button
                  onClick={() => setEditingSkill({ index: i, skill: { ...skill } })}
                  className="px-1.5 py-0.5 rounded text-xs transition-all duration-100"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
                >
                  {t("skillEdit")}
                </button>
                <button
                  onClick={() => handleDeleteSkill(i)}
                  className="px-1.5 py-0.5 rounded text-xs transition-all duration-100"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--danger)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
                >
                  {t("skillDelete")}
                </button>
              </div>
            ))}

            {/* Skill editor */}
            {editingSkill && (
              <SkillEditor
                skill={editingSkill.skill}
                onSave={handleSaveSkill}
                onCancel={() => setEditingSkill(null)}
              />
            )}

            {customSkills.length === 0 && !editingSkill && projectPath && (
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                {t("skillNone")}
              </span>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: "1px", background: "var(--border-subtle)" }} />

          {/* Telemetry */}
          <div className="flex flex-col gap-2">
            <SectionLabel>{t("data")}</SectionLabel>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={telemetryEnabled}
                onChange={async (e) => {
                  const v = e.target.checked
                  setTelemetryEnabled(v)
                  await window.api.telemetrySetEnabled(v)
                }}
                className="accent-[var(--accent)]"
                style={{ width: 14, height: 14 }}
              />
              <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                {t("telemetryDesc")}
              </span>
            </label>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.4 }}>
              {t("telemetryNote")}
            </span>
          </div>

          {/* Divider */}
          <div style={{ height: "1px", background: "var(--border-subtle)" }} />

          {/* Pro Status + License */}
          <div className="flex flex-col gap-2.5">
            <SectionLabel>{t("planTier")}</SectionLabel>
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2.5"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
            >
              <span style={{ fontSize: "12px", fontWeight: 600, color: proStatus?.isPro ? "var(--success)" : "var(--text-secondary)" }}>
                {proStatus?.isPro ? t("pro") : t("communityFree")}
              </span>
              {licenseInfo?.isActive && licenseInfo.customerEmail && (
                <span style={{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "auto" }}>
                  {licenseInfo.customerEmail}
                </span>
              )}
            </div>

            {licenseInfo?.isActive ? (
              <button
                onClick={async () => {
                  const result = await window.api.licenseDeactivate()
                  if (result.success) {
                    setLicenseInfo({ isActive: false })
                    setProStatus({ isPro: false })
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-xs transition-all duration-150"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--danger)",
                  border: "1px solid rgba(248,113,113,0.3)",
                  alignSelf: "flex-start"
                }}
              >
                {t("deactivateLicense")}
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={licenseKeyInput}
                    onChange={(e) => { setLicenseKeyInput(e.target.value); setLicenseError("") }}
                    placeholder={t("enterLicenseKey")}
                    className="flex-1 rounded-lg px-3 py-2 transition-all duration-150 focus:outline-none"
                    style={{
                      background: "var(--bg-base)",
                      border: `1px solid ${licenseError ? "rgba(248,113,113,0.5)" : "var(--border)"}`,
                      color: "var(--text-primary)",
                      fontSize: "12px"
                    }}
                    onFocus={e => (e.currentTarget).style.borderColor = "var(--accent)"}
                    onBlur={e => (e.currentTarget).style.borderColor = licenseError ? "rgba(248,113,113,0.5)" : "var(--border)"}
                  />
                  <button
                    onClick={async () => {
                      if (!licenseKeyInput.trim()) return
                      setLicenseActivating(true)
                      setLicenseError("")
                      const result = await window.api.licenseActivate(licenseKeyInput.trim())
                      setLicenseActivating(false)
                      if (result.success) {
                        setLicenseKeyInput("")
                        setLicenseInfo({ isActive: true, customerName: result.customerName, customerEmail: result.customerEmail })
                        setProStatus({ isPro: true })
                      } else {
                        setLicenseError(result.error ?? "Activation failed")
                      }
                    }}
                    disabled={licenseActivating || !licenseKeyInput.trim()}
                    className="px-3 py-2 rounded-lg font-medium transition-all duration-150 disabled:opacity-50"
                    style={{ background: "var(--accent)", color: "white", fontSize: "12px", whiteSpace: "nowrap" }}
                  >
                    {licenseActivating ? "..." : t("activate")}
                  </button>
                </div>
                {licenseError && (
                  <span style={{ fontSize: "10px", color: "var(--danger)" }}>{licenseError}</span>
                )}
                <span style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.4 }}>
                  {t("getLicenseAt")}{" "}
                  <a
                    href="https://luano.dev/pricing"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }}
                  >luano.dev/pricing</a>
                  {" · "}
                  <span style={{ color: "var(--accent)" }}>7-day free trial</span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 flex-shrink-0"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{t("version")}</span>
        </div>
      </div>

    </div>
  )
}
