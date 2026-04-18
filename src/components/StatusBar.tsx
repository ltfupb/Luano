import { useState, useEffect } from "react"
import { useSyncStore } from "../stores/syncStore"
import { useProjectStore } from "../stores/projectStore"
import { useElapsed } from "../hooks/useElapsed"
import { getFileName } from "../lib/utils"

const statusDot: Record<string, string> = {
  stopped: "var(--text-ghost)",
  starting: "var(--warning)",
  running: "var(--success)",
  error: "var(--danger)"
}

// Escalation threshold (seconds) after which "starting" text goes amber and
// hints the user that something may be hung.
const SLOW_START_THRESHOLD_SEC = 15

export function StatusBar(): JSX.Element {
  const { status, toolName, startedAt } = useSyncStore()
  const { activeFile, lspPort, lspStatus, lspStartedAt } = useProjectStore()

  const syncElapsed = useElapsed(status === "starting" ? startedAt : null)
  const lspElapsed = useElapsed(lspStatus === "starting" ? lspStartedAt : null)

  const [memMB, setMemMB] = useState(0)
  const [toolUpdates, setToolUpdates] = useState(0)

  // Check toolchain updates after startup
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const config = await window.api.toolchainGetConfig()
        const installedIds = Object.entries(config.installed)
          .filter(([, v]) => v)
          .map(([k]) => k)
        if (installedIds.length === 0) return
        const updates = await window.api.toolchainCheckUpdates(installedIds)
        setToolUpdates(updates.length)
      } catch { /* ignore */ }
    }, 5000)

    // Sync with ToolchainPanel: the panel dispatches this event whenever its
    // local `updates` state changes (initial load, after update, after remove).
    const handleUpdatesChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ count: number }>).detail
      if (typeof detail?.count === "number") setToolUpdates(detail.count)
    }
    window.addEventListener("toolchain-updates-changed", handleUpdatesChanged)

    return () => {
      clearTimeout(timer)
      window.removeEventListener("toolchain-updates-changed", handleUpdatesChanged)
    }
  }, [])

  // Poll memory usage every 10s
  useEffect(() => {
    const poll = () => {
      if (typeof window.api.perfStats === "function") {
        window.api.perfStats().then((s) => setMemMB(s.rss)).catch(() => {})
      }
    }
    poll()
    const id = setInterval(poll, 10_000)
    return () => clearInterval(id)
  }, [])

  // Sync label — "rojo starting… · 3s" when starting, elapsed only shown after 1s
  const syncLabelBase: Record<string, string> = {
    stopped: `${toolName} stopped`,
    starting: `${toolName} starting…`,
    running: `${toolName} serving`,
    error: `${toolName} error`
  }
  const syncLabel = status === "starting" && syncElapsed !== null && syncElapsed > 0
    ? `${syncLabelBase.starting} · ${syncElapsed}s`
    : (syncLabelBase[status] ?? status)
  const syncSlow = status === "starting" && (syncElapsed ?? 0) > SLOW_START_THRESHOLD_SEC

  // LSP label — show phase, not just port presence. Port is only interesting
  // once running; during startup we show elapsed seconds instead.
  const lspShown = lspStatus !== "stopped" || lspPort !== null
  const lspLabel = (() => {
    if (lspStatus === "starting") {
      return lspElapsed !== null && lspElapsed > 0
        ? `LSP starting… · ${lspElapsed}s`
        : "LSP starting…"
    }
    if (lspStatus === "error") return "LSP error"
    if (lspStatus === "running" || lspPort) return `LSP :${lspPort ?? ""}`
    return "LSP stopped"
  })()
  const lspSlow = lspStatus === "starting" && (lspElapsed ?? 0) > SLOW_START_THRESHOLD_SEC
  const lspDotKey = lspStatus !== "stopped" ? lspStatus : (lspPort ? "running" : "stopped")

  const slowTooltip = "Taking longer than usual. Check Toolchain panel if this hangs."

  return (
    <div
      className="h-[22px] flex items-center px-3 gap-4 flex-shrink-0"
      style={{
        background: "var(--bg-panel)",
        borderTop: "1px solid var(--border-subtle)",
        fontSize: "11px"
      }}
    >
      {/* Sync (Rojo/Argon) status */}
      <div className="flex items-center gap-1.5">
        <span
          className={status === "starting" ? "status-pulse" : ""}
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "9999px",
            flexShrink: 0,
            background: statusDot[status] ?? statusDot.stopped,
            boxShadow: status === "running" ? "0 0 4px var(--success)" : "none"
          }}
        />
        <span
          style={{ color: syncSlow ? "var(--warning)" : "var(--text-secondary)" }}
          title={syncSlow ? slowTooltip : undefined}
        >
          {syncLabel}
        </span>
      </div>

      {/* Separator */}
      {lspShown && <span style={{ color: "var(--border)", userSelect: "none" }}>·</span>}

      {/* LSP phase */}
      {lspShown && (
        <div className="flex items-center gap-1.5">
          <span
            className={lspStatus === "starting" ? "status-pulse" : ""}
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "9999px",
              flexShrink: 0,
              background: statusDot[lspDotKey] ?? statusDot.stopped,
              boxShadow: lspDotKey === "running" ? "0 0 4px var(--success)" : "none"
            }}
          />
          <span
            style={{ color: lspSlow ? "var(--warning)" : "var(--text-secondary)" }}
            title={lspSlow ? slowTooltip : undefined}
          >
            {lspLabel}
          </span>
        </div>
      )}

      {/* Toolchain updates */}
      {toolUpdates > 0 && (
        <>
          <span style={{ color: "var(--border)", userSelect: "none" }}>·</span>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("open-toolchain"))}
            className="flex items-center gap-1 transition-colors duration-100"
            style={{ color: "var(--info)", background: "none", border: "none", fontSize: "11px", cursor: "pointer" }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {toolUpdates} update{toolUpdates > 1 ? "s" : ""}
          </button>
        </>
      )}

      {/* Memory usage */}
      {memMB > 0 && (
        <>
          <span style={{ color: "var(--border)", userSelect: "none" }}>·</span>
          <span
            style={{ color: memMB > 500 ? "var(--warning)" : "var(--text-muted)" }}
            title={`Memory: ${memMB} MB RSS`}
          >
            {memMB} MB
          </span>
        </>
      )}

      {/* Active file — right aligned */}
      {activeFile && (
        <span
          className="ml-auto truncate max-w-[240px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {getFileName(activeFile)}
        </span>
      )}
    </div>
  )
}
