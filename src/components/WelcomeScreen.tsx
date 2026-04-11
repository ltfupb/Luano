import { useT } from "../i18n/useT"
import { useSettingsStore } from "../stores/settingsStore"

interface Props {
  onOpenFolder: () => void
  onNewProject: () => void
  onOpenRecent: (path: string) => void
}

export function WelcomeScreen({ onOpenFolder, onNewProject, onOpenRecent }: Props): JSX.Element {
  const t = useT()
  const recentProjects = useSettingsStore((s) => s.recentProjects)
  const removeRecent = useSettingsStore((s) => s.removeRecentProject)

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

      <div className="rounded-lg p-3" style={{ maxWidth: "520px", width: "100%", margin: "0 24px", background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
        <p className="text-xs font-medium mb-1" style={{ color: "var(--accent)" }}>{t("welcomeTipTitle")}</p>
        <p className="text-xs" style={{ color: "var(--text-muted)", lineHeight: "1.5" }}>{t("welcomeTipBody")}</p>
      </div>
    </div>
  )
}
