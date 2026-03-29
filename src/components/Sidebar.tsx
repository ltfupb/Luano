// src/components/Sidebar.tsx
// Vertical icon sidebar — explorer, search, rojo, studio, topology

import { useT } from "../i18n/useT"
import { useRojoStore } from "../stores/rojoStore"

export type SidePanel = "explorer" | "search" | "rojo" | "studio" | "topology" | "analysis" | "datastore"

interface SidebarProps {
  activePanel: SidePanel
  onSelect: (panel: SidePanel) => void
  terminalOpen: boolean
  onTerminalToggle: () => void
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

function IconRojo(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
    </svg>
  )
}

function IconStudio(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <polyline points="8 21 12 17 16 21" />
    </svg>
  )
}

function IconTopology(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <line x1="7" y1="6" x2="17" y2="6" />
      <line x1="6" y1="7.5" x2="11" y2="16.5" />
      <line x1="18" y1="7.5" x2="13" y2="16.5" />
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

function IconTerminal(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

const panelIcons: Record<SidePanel, () => JSX.Element> = {
  explorer: IconFiles,
  search: IconSearch,
  rojo: IconRojo,
  studio: IconStudio,
  topology: IconTopology,
  analysis: IconAnalysis,
  datastore: IconDataStore
}

export function Sidebar({ activePanel, onSelect, terminalOpen, onTerminalToggle }: SidebarProps): JSX.Element {
  const t = useT()
  const rojoStatus = useRojoStore((s) => s.status)
  const rojoServing = rojoStatus === "serving" || rojoStatus === "starting"

  const labels: Record<SidePanel, string> = {
    explorer: t("files"),
    search: "Search",
    rojo: t("rojo"),
    studio: t("studio"),
    topology: "Topology",
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
            data-tour={panel === "rojo" ? "rojo-icon" : undefined}
            onClick={() => onSelect(panel)}
            title={labels[panel]}
            className="relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150"
            style={{
              color: isActive ? "#ffffff" : "rgba(255,255,255,0.45)",
              background: isActive ? "var(--bg-elevated)" : "transparent"
            }}
            onMouseEnter={e => {
              if (!isActive) {
                (e.currentTarget).style.color = "rgba(255,255,255,0.85)"
                ;(e.currentTarget).style.background = "var(--bg-surface)"
              }
            }}
            onMouseLeave={e => {
              if (!isActive) {
                (e.currentTarget).style.color = "rgba(255,255,255,0.45)"
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
            {/* Rojo active indicator */}
            {panel === "rojo" && rojoServing && (
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

      {/* Spacer pushes terminal button to bottom */}
      <div className="flex-1" />

      {/* Terminal toggle button (bottom of sidebar) */}
      <button
        onClick={onTerminalToggle}
        title="Toggle Terminal"
        className="relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150"
        style={{
          color: terminalOpen ? "#ffffff" : "rgba(255,255,255,0.45)",
          background: terminalOpen ? "var(--bg-elevated)" : "transparent"
        }}
        onMouseEnter={e => {
          if (!terminalOpen) {
            (e.currentTarget).style.color = "rgba(255,255,255,0.85)"
            ;(e.currentTarget).style.background = "var(--bg-surface)"
          }
        }}
        onMouseLeave={e => {
          if (!terminalOpen) {
            (e.currentTarget).style.color = "rgba(255,255,255,0.45)"
            ;(e.currentTarget).style.background = "transparent"
          }
        }}
      >
        {terminalOpen && (
          <span
            className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full animate-fade-in"
            style={{ background: "var(--accent)" }}
          />
        )}
        <IconTerminal />
      </button>
    </div>
  )
}
