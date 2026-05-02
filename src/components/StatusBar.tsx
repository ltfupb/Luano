import { useState, useEffect, useMemo } from "react"
import { useSyncStore } from "../stores/syncStore"
import { useProjectStore } from "../stores/projectStore"
import { useElapsed } from "../hooks/useElapsed"
import { useIpcEvent } from "../hooks/useIpc"
import { getFileName } from "../lib/utils"
import { toast } from "./Toast"

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
  const projectPath = useProjectStore((s) => s.projectPath)
  const fileTree = useProjectStore((s) => s.fileTree)

  const syncElapsed = useElapsed(status === "starting" ? startedAt : null)
  const lspElapsed = useElapsed(lspStatus === "starting" ? lspStartedAt : null)

  const [memMB, setMemMB] = useState(0)
  const [toolUpdates, setToolUpdates] = useState(0)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [pkgBusy, setPkgBusy] = useState<null | "init" | "install" | "add">(null)
  const [activePkgTool, setActivePkgTool] = useState<"wally" | "pesde" | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addValue, setAddValue] = useState("")

  // Top-level manifest detection — wally.toml or pesde.toml at project root
  // signals the project uses a package manager. Subdirectory matches are
  // ignored (a vendored Wally dependency would also have a wally.toml).
  const packageManifest = useMemo<"wally" | "pesde" | null>(() => {
    for (const e of fileTree) {
      if (e.type !== "file") continue
      if (e.name === "wally.toml") return "wally"
      if (e.name === "pesde.toml") return "pesde"
    }
    return null
  }, [fileTree])

  // Resolve the active package-manager tool for the current project so we can
  // show an "Initialize <tool>" button before any manifest exists. Without
  // this, a fresh project with no wally.toml/pesde.toml would have no entry
  // point into the package-manager workflow. Also reset the inline `add`
  // input when the project changes so a name typed for project A doesn't
  // get submitted against project B after a switch.
  useEffect(() => {
    setAddOpen(false)
    setAddValue("")
    if (!projectPath) { setActivePkgTool(null); return }
    let cancelled = false
    const refresh = async (): Promise<void> => {
      try {
        const cfg = await window.api.toolchainGetConfig(projectPath)
        if (cancelled) return
        const sel = cfg.selections["package-manager"]
        setActivePkgTool(sel === "wally" || sel === "pesde" ? sel : null)
      } catch { if (!cancelled) { setActivePkgTool(null) } }
    }
    void refresh()
    // Re-resolve when the user changes their toolchain selections in the
    // Toolchain panel — without this, switching the active package manager
    // wouldn't surface the Init button until the project is reopened.
    const onConfigChanged = (): void => { void refresh() }
    window.addEventListener("toolchain-config-changed", onConfigChanged)
    return () => {
      cancelled = true
      window.removeEventListener("toolchain-config-changed", onConfigChanged)
    }
  }, [projectPath])

  // Tell App.tsx to re-walk the project root after a package-manager mutation.
  // The chokidar file watcher only covers `<project>/src` so root-level
  // changes (wally.toml / pesde.toml / Packages/) wouldn't otherwise refresh
  // the file tree until the user switched projects.
  const broadcastManifestChanged = (): void => {
    window.dispatchEvent(new CustomEvent("manifest-changed"))
  }

  const handlePackageInstall = async (): Promise<void> => {
    if (!projectPath || pkgBusy) return
    setPkgBusy("install")
    try {
      const result = await window.api.packageManagerRun(projectPath, "install")
      if (result.success) {
        toast(`${result.tool ?? "Package manager"}: install succeeded`, "info")
        broadcastManifestChanged()
      } else {
        toast(result.error ?? "Package install failed", "error")
      }
    } catch (err) {
      toast((err as Error).message ?? "Package install failed", "error")
    } finally {
      setPkgBusy(null)
    }
  }

  const handlePackageInit = async (): Promise<void> => {
    if (!projectPath || pkgBusy) return
    setPkgBusy("init")
    try {
      const result = await window.api.packageManagerRun(projectPath, "init")
      if (result.success) {
        toast(`${result.tool ?? "Package manager"}: initialized`, "info")
        broadcastManifestChanged()
      } else {
        toast(result.error ?? "Init failed", "error")
      }
    } catch (err) {
      toast((err as Error).message ?? "Init failed", "error")
    } finally {
      setPkgBusy(null)
    }
  }

  const handlePackageAdd = async (): Promise<void> => {
    const name = addValue.trim()
    if (!projectPath || pkgBusy || !name) return
    setPkgBusy("add")
    try {
      const result = await window.api.packageManagerRun(projectPath, "add", name)
      if (result.success) {
        toast(`${result.tool ?? "Package manager"}: added ${name}`, "info")
        setAddOpen(false)
        setAddValue("")
        broadcastManifestChanged()
      } else {
        toast(result.error ?? "Add failed", "error")
      }
    } catch (err) {
      toast((err as Error).message ?? "Add failed", "error")
    } finally {
      setPkgBusy(null)
    }
  }

  // Surface updater failures as a subtle dot. The UpdateBanner stays quiet
  // on error by design (only shows "ready to restart"), so without this
  // indicator a silent network/checksum failure leaves the user wondering
  // why a promised update never arrives. Clicking the dot re-triggers a check.
  useIpcEvent("updater:status", (data) => {
    const s = data as { status: string; error?: string }
    if (s.status === "error") setUpdateError(s.error ?? "Update check failed")
    else if (s.status === "checking" || s.status === "downloading" || s.status === "downloaded") setUpdateError(null)
  })

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

      {/* Updater error — subtle dot with tooltip */}
      {updateError && (
        <>
          <span style={{ color: "var(--border)", userSelect: "none" }}>·</span>
          <button
            onClick={() => { setUpdateError(null); void window.api.updaterCheck?.() }}
            title={`${updateError}\nClick to retry`}
            className="flex items-center gap-1 transition-colors duration-100"
            style={{ color: "var(--danger)", background: "none", border: "none", fontSize: "11px", cursor: "pointer" }}
          >
            <span
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "var(--danger)", display: "inline-block"
              }}
            />
            update failed
          </button>
        </>
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

      {/* Package manager — initialize button when no manifest yet */}
      {!packageManifest && activePkgTool && (
        <>
          <span style={{ color: "var(--border)", userSelect: "none" }}>·</span>
          <button
            onClick={() => { void handlePackageInit() }}
            disabled={pkgBusy !== null}
            title={`Run ${activePkgTool} init`}
            className="flex items-center gap-1 transition-colors duration-100"
            style={{
              color: pkgBusy ? "var(--text-muted)" : "var(--text-secondary)",
              background: "none", border: "none", fontSize: "11px",
              cursor: pkgBusy ? "default" : "pointer"
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {pkgBusy === "init" ? `${activePkgTool} init…` : `Initialize ${activePkgTool}`}
          </button>
        </>
      )}

      {/* Package manager install + add — visible when wally.toml / pesde.toml at root */}
      {packageManifest && (
        <>
          <span style={{ color: "var(--border)", userSelect: "none" }}>·</span>
          <button
            onClick={() => { void handlePackageInstall() }}
            disabled={pkgBusy !== null}
            title={packageManifest === "wally" ? "Run wally install" : "Run pesde install"}
            className="flex items-center gap-1 transition-colors duration-100"
            style={{
              color: pkgBusy ? "var(--text-muted)" : "var(--text-secondary)",
              background: "none", border: "none", fontSize: "11px",
              cursor: pkgBusy ? "default" : "pointer"
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            {pkgBusy === "install" ? `${packageManifest} installing…` : `${packageManifest} install`}
          </button>

          {addOpen ? (
            <form
              onSubmit={(e) => { e.preventDefault(); void handlePackageAdd() }}
              className="flex items-center gap-1"
            >
              <input
                autoFocus
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setAddOpen(false); setAddValue("") }
                }}
                placeholder={packageManifest === "wally" ? "scope/name@version" : "scope/name@version"}
                disabled={pkgBusy !== null}
                style={{
                  background: "var(--bg-input, transparent)",
                  border: "1px solid var(--border)",
                  borderRadius: "3px",
                  color: "var(--text-secondary)",
                  fontSize: "11px",
                  padding: "1px 4px",
                  width: "180px",
                  outline: "none"
                }}
              />
              <button
                type="submit"
                disabled={pkgBusy !== null || addValue.trim().length === 0}
                style={{
                  background: "none", border: "none", fontSize: "11px",
                  color: pkgBusy === "add" ? "var(--text-muted)" : "var(--text-secondary)",
                  cursor: pkgBusy === "add" || addValue.trim().length === 0 ? "default" : "pointer"
                }}
              >
                {pkgBusy === "add" ? "adding…" : "add"}
              </button>
              <button
                type="button"
                onClick={() => { setAddOpen(false); setAddValue("") }}
                disabled={pkgBusy !== null}
                style={{
                  background: "none", border: "none", fontSize: "11px",
                  color: "var(--text-muted)",
                  cursor: pkgBusy ? "default" : "pointer"
                }}
              >
                cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => setAddOpen(true)}
              disabled={pkgBusy !== null}
              title={`Run ${packageManifest} add <package>`}
              className="flex items-center gap-1 transition-colors duration-100"
              style={{
                color: pkgBusy ? "var(--text-muted)" : "var(--text-secondary)",
                background: "none", border: "none", fontSize: "11px",
                cursor: pkgBusy ? "default" : "pointer"
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              add
            </button>
          )}
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
