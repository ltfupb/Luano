import { useEffect, useRef, useState } from "react"
import { useT } from "../i18n/useT"

interface Props {
  projectPath: string | null
  terminalOpen: boolean
  onNewProject: () => void
  onOpenFolder: () => void
  onCloseProject: () => void
  onOpenSettings: () => void
  onToggleTerminal: () => void
  onOpenToolchain: () => void
}

export function AppTitlebar({
  projectPath,
  terminalOpen,
  onNewProject,
  onOpenFolder,
  onCloseProject,
  onOpenSettings,
  onToggleTerminal,
  onOpenToolchain
}: Props): JSX.Element {
  const t = useT()
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const fileMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!fileMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false)
      }
    }
    window.addEventListener("mousedown", handler)
    return () => window.removeEventListener("mousedown", handler)
  }, [fileMenuOpen])

  return (
    <div
      className="h-9 flex items-center px-2 flex-shrink-0 drag-region"
      style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--border-subtle)" }}
    >
      <div className="flex items-center gap-0.5">
        <div ref={fileMenuRef} className="relative">
          <button
            data-tour="file-btn"
            onClick={() => setFileMenuOpen((v) => !v)}
            className="px-2.5 h-7 flex items-center rounded-md text-xs transition-all duration-150"
            style={{ color: fileMenuOpen ? "var(--text-primary)" : "var(--text-secondary)", background: fileMenuOpen ? "var(--bg-elevated)" : "transparent" }}
            onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
            onMouseLeave={e => { if (!fileMenuOpen) { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" } }}
          >
            File
          </button>
          {fileMenuOpen && (
            <div
              className="absolute left-0 top-full mt-0.5 z-50 rounded-lg overflow-hidden animate-fade-in"
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                minWidth: "180px"
              }}
            >
              <button
                onClick={() => { setFileMenuOpen(false); onNewProject() }}
                className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors duration-100"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
                onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" }}
              >
                {t("newProject")}
              </button>
              <button
                onClick={() => { setFileMenuOpen(false); onOpenFolder() }}
                className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors duration-100"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
                onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" }}
              >
                {t("openFolder")}
              </button>
              {projectPath && (
                <>
                  <div style={{ height: "1px", background: "var(--border-subtle)", margin: "2px 8px" }} />
                  <button
                    onClick={() => { setFileMenuOpen(false); onCloseProject() }}
                    className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors duration-100"
                    style={{ color: "var(--text-secondary)" }}
                    onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
                    onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" }}
                  >
                    Close Project
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <button
          data-tour="settings-btn"
          onClick={onOpenSettings}
          className="px-2.5 h-7 flex items-center rounded-md text-xs transition-all duration-150"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
          onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" }}
        >
          Settings
        </button>
        {projectPath && (
          <button
            onClick={onToggleTerminal}
            className="px-2.5 h-7 flex items-center rounded-md text-xs transition-all duration-150"
            style={{ color: terminalOpen ? "var(--text-primary)" : "var(--text-secondary)" }}
            onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
            onMouseLeave={e => { if (!terminalOpen) { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" } }}
          >
            Terminal
          </button>
        )}
        <button
          onClick={onOpenToolchain}
          className="px-2.5 h-7 flex items-center rounded-md text-xs transition-all duration-150"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
          onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" }}
        >
          Toolchain
        </button>
      </div>
    </div>
  )
}
