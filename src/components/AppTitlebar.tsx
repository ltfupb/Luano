import { useEffect, useRef, useState } from "react"
import { useT } from "../i18n/useT"
import { useSettingsStore } from "../stores/settingsStore"
import { useProjectStore } from "../stores/projectStore"
import { getFileName } from "../lib/utils"
import logoUrl from "../assets/logo.png"

interface Props {
  projectPath: string | null
  terminalOpen: boolean
  onNewProject: () => void
  onOpenFolder: () => void
  onCloseProject: () => void
  onOpenRecent: (path: string) => void
  onOpenSettings: () => void
  onToggleTerminal: () => void
  onOpenToolchain: () => void
}

// macOS reserves the top-left for the traffic-light buttons (close/min/zoom).
// Default lights live ~12px from the left at 14px wide each + 6px gap, so a
// safe content offset is ~76px. We add a touch of breathing room.
const MAC_TRAFFIC_LIGHT_INSET = 80

// Windows/Linux titleBarOverlay paints native min/max/close into the right
// edge of our bar. The overlay's default width is ~138px (3 × 46px buttons).
// Reserve enough space so the project name never collides with them.
const WIN_OVERLAY_WIDTH = 144

/**
 * AppTitlebar — single-bar custom titlebar.
 *
 * Window controls are intentionally NOT rendered by us:
 *   - Windows / Linux: drawn by `BrowserWindow.titleBarOverlay` (Electron asks
 *     the OS to paint native min/max/close glyphs into the reserved right edge).
 *   - macOS: drawn by `titleBarStyle: "hiddenInset"` (native traffic lights).
 *
 * That means hover/click feedback matches the host OS exactly without us
 * reimplementing it. Theme color changes are pushed via `setTitleBarOverlay`
 * (see App.tsx) because the overlay is painted outside the renderer and can't
 * read CSS variables.
 */
export function AppTitlebar({
  projectPath,
  terminalOpen,
  onNewProject,
  onOpenFolder,
  onCloseProject,
  onOpenRecent,
  onOpenSettings,
  onToggleTerminal,
  onOpenToolchain
}: Props): JSX.Element {
  const t = useT()
  const dirtyCount = useProjectStore((s) => s.dirtyFiles.length)
  const recentProjects = useSettingsStore((s) => s.recentProjects)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const isMac = window.api.platform === "darwin"

  useEffect(() => {
    if (!fileMenuOpen) return
    const handler = (e: MouseEvent): void => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false)
        setRecentOpen(false)
      }
    }
    window.addEventListener("mousedown", handler)
    return () => window.removeEventListener("mousedown", handler)
  }, [fileMenuOpen])

  const closeFileMenu = (): void => {
    setFileMenuOpen(false)
    setRecentOpen(false)
  }

  const projectName = projectPath ? getFileName(projectPath) : null
  // Truncate non-recent path display in the Recent submenu so a deeply nested
  // path doesn't blow out the menu width.
  const truncatePath = (p: string, max = 48): string =>
    p.length <= max ? p : "…" + p.slice(p.length - max + 1)

  return (
    <div
      className="h-9 flex items-center flex-shrink-0 drag-region select-none"
      style={{
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border-subtle)",
        paddingLeft: isMac ? MAC_TRAFFIC_LIGHT_INSET : 8,
        paddingRight: isMac ? 8 : WIN_OVERLAY_WIDTH
      }}
    >
      {/* Brand mark — Luano app icon (resources/icons/icon.png mirrored to
          src/assets/logo.png so Vite can fingerprint and serve it). */}
      <div
        className="flex items-center gap-1.5 px-1 mr-1"
        style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 12, letterSpacing: 0.2 }}
        aria-label="Luano"
      >
        <img
          src={logoUrl}
          alt=""
          aria-hidden="true"
          width={16}
          height={16}
          style={{ display: "block", imageRendering: "pixelated" }}
        />
      </div>

      {/* Menu cluster */}
      <div className="flex items-center gap-0.5">
        <div ref={fileMenuRef} className="relative">
          <button
            data-tour="file-btn"
            onClick={() => setFileMenuOpen((v) => !v)}
            className="px-2.5 h-7 flex items-center rounded-md text-xs transition-all duration-150"
            style={{
              color: fileMenuOpen ? "var(--text-primary)" : "var(--text-secondary)",
              background: fileMenuOpen ? "var(--bg-elevated)" : "transparent"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-elevated)"
              e.currentTarget.style.color = "var(--text-primary)"
            }}
            onMouseLeave={(e) => {
              if (!fileMenuOpen) {
                e.currentTarget.style.background = "transparent"
                e.currentTarget.style.color = "var(--text-secondary)"
              }
            }}
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
                minWidth: 200
              }}
            >
              <MenuItem
                label={t("newProject")}
                onClick={() => {
                  closeFileMenu()
                  onNewProject()
                }}
              />
              <MenuItem
                label={t("openFolder")}
                onClick={() => {
                  closeFileMenu()
                  onOpenFolder()
                }}
              />

              {/* Recent submenu — opens to the right on hover/click. Disabled
                  visually when the recents list is empty so users still see
                  it exists rather than wondering where it went. */}
              <div
                className="relative"
                onMouseEnter={() => setRecentOpen(recentProjects.length > 0)}
                onMouseLeave={() => setRecentOpen(false)}
              >
                <button
                  className="w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-2 transition-colors duration-100"
                  style={{
                    color: recentProjects.length === 0 ? "var(--text-ghost)" : "var(--text-secondary)",
                    background: recentOpen ? "var(--bg-elevated)" : "transparent"
                  }}
                  onClick={() => {
                    if (recentProjects.length > 0) setRecentOpen((v) => !v)
                  }}
                  disabled={recentProjects.length === 0}
                >
                  <span>Open Recent</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>▸</span>
                </button>
                {recentOpen && recentProjects.length > 0 && (
                  <div
                    className="absolute left-full top-0 ml-0.5 rounded-lg overflow-hidden animate-fade-in"
                    style={{
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                      minWidth: 280,
                      maxWidth: 420
                    }}
                  >
                    {recentProjects.slice(0, 8).map((rp) => (
                      <button
                        key={rp.path}
                        onClick={() => {
                          closeFileMenu()
                          onOpenRecent(rp.path)
                        }}
                        className="w-full px-3 py-1.5 text-left text-xs flex flex-col gap-0.5 transition-colors duration-100"
                        style={{ color: "var(--text-secondary)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--bg-elevated)"
                          e.currentTarget.style.color = "var(--text-primary)"
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent"
                          e.currentTarget.style.color = "var(--text-secondary)"
                        }}
                        title={rp.path}
                      >
                        <span style={{ color: "var(--text-primary)" }}>{rp.name}</span>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{truncatePath(rp.path)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {projectPath && (
                <>
                  <div style={{ height: 1, background: "var(--border-subtle)", margin: "2px 8px" }} />
                  <MenuItem
                    label="Close Project"
                    onClick={() => {
                      closeFileMenu()
                      onCloseProject()
                    }}
                  />
                </>
              )}
            </div>
          )}
        </div>

        <TitlebarButton
          dataTour="settings-btn"
          active={false}
          onClick={onOpenSettings}
        >
          Settings
        </TitlebarButton>

        {projectPath && (
          <TitlebarButton active={terminalOpen} onClick={onToggleTerminal}>
            Terminal
          </TitlebarButton>
        )}

        <TitlebarButton dataTour="toolchain-btn" active={false} onClick={onOpenToolchain}>
          Toolchain
        </TitlebarButton>
      </div>

      {/* Center — project name + dirty marker. pointer-events:none so the
          drag region underneath still owns clicks (window move/double-click
          to maximize). flex-1 fills the gap between left buttons and right
          window-control padding. */}
      <div
        className="flex-1 flex items-center justify-center min-w-0 px-4"
        style={{ pointerEvents: "none" }}
      >
        {projectName && (
          <div
            className="flex items-center gap-1.5 truncate"
            style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: "60%" }}
          >
            <span className="truncate" style={{ color: "var(--text-secondary)" }}>
              {projectName}
            </span>
            {dirtyCount > 0 && (
              <span
                title={`${dirtyCount} unsaved file${dirtyCount === 1 ? "" : "s"}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  color: "var(--warning)"
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--warning)"
                  }}
                />
                <span style={{ fontSize: 10 }}>{dirtyCount}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface MenuItemProps {
  label: string
  onClick: () => void
}

function MenuItem({ label, onClick }: MenuItemProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors duration-100"
      style={{ color: "var(--text-secondary)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-elevated)"
        e.currentTarget.style.color = "var(--text-primary)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent"
        e.currentTarget.style.color = "var(--text-secondary)"
      }}
    >
      {label}
    </button>
  )
}

interface TitlebarButtonProps {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  dataTour?: string
}

function TitlebarButton({ children, active, onClick, dataTour }: TitlebarButtonProps): JSX.Element {
  return (
    <button
      data-tour={dataTour}
      onClick={onClick}
      className="px-2.5 h-7 flex items-center rounded-md text-xs transition-all duration-150"
      style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-elevated)"
        e.currentTarget.style.color = "var(--text-primary)"
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent"
          e.currentTarget.style.color = "var(--text-secondary)"
        }
      }}
    >
      {children}
    </button>
  )
}
