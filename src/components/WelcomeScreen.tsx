import { useT } from "../i18n/useT"
import { useSettingsStore } from "../stores/settingsStore"

interface Props {
  onOpenFolder: () => void
  onNewProject: () => void
  onOpenRecent: (path: string) => void
  onOpenSettings: () => void
}

export function WelcomeScreen({ onOpenFolder, onNewProject, onOpenRecent, onOpenSettings }: Props): JSX.Element {
  const t = useT()
  const recentProjects = useSettingsStore((s) => s.recentProjects)
  const removeRecent = useSettingsStore((s) => s.removeRecentProject)
  const apiKey = useSettingsStore((s) => s.apiKey)
  const openaiKey = useSettingsStore((s) => s.openaiKey)
  const geminiKey = useSettingsStore((s) => s.geminiKey)
  const localEndpoint = useSettingsStore((s) => s.localEndpoint)
  const localModel = useSettingsStore((s) => s.localModel)
  const aiConfigured = Boolean(apiKey || openaiKey || geminiKey || (localEndpoint && localModel))

  return (
    <div className="flex-1 flex flex-col items-center justify-center animate-fade-in" style={{ gap: "32px" }}>
      <div className="text-center" style={{ marginBottom: "8px" }}>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{t("welcome")}</h1>
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{t("welcomeSub")}</p>
      </div>

      <div className="flex gap-3" style={{ maxWidth: "520px", width: "100%", padding: "0 24px" }}>
        <button
          data-tour="welcome-new"
          onClick={onNewProject}
          className="flex-1 flex flex-col items-start gap-2 rounded-lg p-4 transition-all duration-150 text-left"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-surface)" }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-elevated)" }}
        >
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t("welcomeNewGame")}</span>
          </div>
          <span className="text-xs" style={{ color: "var(--text-muted)", lineHeight: "1.4" }}>{t("welcomeNewGameDesc")}</span>
        </button>

        <button
          data-tour="welcome-open"
          onClick={onOpenFolder}
          className="flex-1 flex flex-col items-start gap-2 rounded-lg p-4 transition-all duration-150 text-left"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-surface)" }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-elevated)" }}
        >
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t("welcomeOpenProject")}</span>
          </div>
          <span className="text-xs" style={{ color: "var(--text-muted)", lineHeight: "1.4" }}>{t("welcomeOpenProjectDesc")}</span>
        </button>
      </div>

      <div style={{ maxWidth: "520px", width: "100%", padding: "0 24px" }}>
        <p className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>{t("welcomeRecentProjects")}</p>
        {recentProjects.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)", opacity: 0.5 }}>{t("welcomeNoRecent")}</p>
        ) : (
          <div className="flex flex-col rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {recentProjects.map((proj, i) => (
              <div
                key={proj.path}
                className="flex items-center justify-between px-3 py-2 transition-colors duration-100 cursor-pointer"
                style={{
                  background: "var(--bg-elevated)",
                  borderTop: i > 0 ? "1px solid var(--border-subtle)" : undefined
                }}
                onClick={() => onOpenRecent(proj.path)}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-surface)")}
                onMouseLeave={e => (e.currentTarget.style.background = "var(--bg-elevated)")}
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{proj.name}</span>
                  <span className="text-xs truncate" style={{ color: "var(--text-muted)", fontSize: "10px" }}>{proj.path}</span>
                </div>
                <button
                  className="ml-2 flex-shrink-0 p-1 rounded transition-colors duration-100"
                  style={{ color: "var(--text-muted)" }}
                  onClick={(e) => { e.stopPropagation(); removeRecent(proj.path) }}
                  onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                  title="Remove"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!aiConfigured && (
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-3 rounded-lg p-3 transition-all duration-150 text-left"
          style={{
            maxWidth: "520px",
            width: "100%",
            margin: "0 24px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--warning)"
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)" }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
              Set up AI to enable chat and inline edits
            </span>
            <span className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Add an Anthropic, OpenAI, Gemini, or local LLM key in Settings.
            </span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      <div className="rounded-lg p-3" style={{ maxWidth: "520px", width: "100%", margin: "0 24px", background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
        <p className="text-xs font-medium mb-1" style={{ color: "var(--accent)" }}>{t("welcomeTipTitle")}</p>
        <p className="text-xs" style={{ color: "var(--text-muted)", lineHeight: "1.5" }}>{t("welcomeTipBody")}</p>
      </div>
    </div>
  )
}
