// src/components/Sidebar.tsx
// Vertical icon sidebar — explorer, search, sync, analysis, datastore

import { useT } from "../i18n/useT"
import { useRojoStore } from "../stores/rojoStore"

export type SidePanel = "explorer" | "search" | "sync" | "analysis" | "datastore"

interface SidebarProps {
  activePanel: SidePanel
  onSelect: (panel: SidePanel) => void
}

function IconFiles(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  )
}

function IconSearch(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function IconSync(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  )
}

function IconAnalysis(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
      <polyline points="7.5 19.79 7.5 14.6 3 12" />
      <polyline points="21 12 16.5 14.6 16.5 19.79" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}

function IconDataStore(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  )
}

const panelIcons: Record<SidePanel, () => JSX.Element> = {
  explorer: IconFiles,
  search: IconSearch,
  sync: IconSync,
  analysis: IconAnalysis,
  datastore: IconDataStore
}

export function Sidebar({ activePanel, onSelect }: SidebarProps): JSX.Element {
  const t = useT()
  const rojoStatus = useRojoStore((s) => s.status)
  const rojoActive = rojoStatus === "running" || rojoStatus === "starting"

  const labels: Record<SidePanel, string> = {
    explorer: t("files"),
    search: "Search",
    sync: t("sync"),
    analysis: t("analysis"),
    datastore: t("datastore")
  }

  return (
    <div
      className="w-11 flex-shrink-0 flex flex-col items-center py-2 gap-0.5"
      style={{ background: "var(--bg-panel)", borderRight: "1px solid var(--border-subtle)" }}
    >
      {/* Main panel buttons */}
      {(Object.keys(panelIcons) as SidePanel[]).map((panel) => {
        const Icon = panelIcons[panel]
        const isActive = activePanel === panel
        return (
          <button
            key={panel}
            data-tour={panel === "sync" ? "rojo-icon" : undefined}
            onClick={() => onSelect(panel)}
            title={labels[panel]}
            className="relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150"
            style={{
              color: isActive ? "var(--text-primary)" : "var(--text-muted)",
              background: isActive ? "var(--bg-elevated)" : "transparent"
            }}
            onMouseEnter={e => {
              if (!isActive) {
                (e.currentTarget).style.color = "var(--text-secondary)"
                ;(e.currentTarget).style.background = "var(--bg-surface)"
              }
            }}
            onMouseLeave={e => {
              if (!isActive) {
                (e.currentTarget).style.color = "var(--text-muted)"
                ;(e.currentTarget).style.background = "transparent"
              }
            }}
          >
            {isActive && (
              <span
                className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full animate-fade-in"
                style={{ background: "var(--accent)" }}
              />
            )}
            <Icon />
            {/* Rojo active indicator on sync icon */}
            {panel === "sync" && rojoActive && (
              <span
                className="absolute top-1 right-1 w-2 h-2 rounded-full"
                style={{
                  background: "var(--success)",
                  boxShadow: "0 0 6px var(--success)"
                }}
              />
            )}
          </button>
        )
      })}

    </div>
  )
}
