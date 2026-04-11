import { useRojoStore } from "../stores/rojoStore"
import { useProjectStore, type FileEntry } from "../stores/projectStore"
import { useState, useMemo } from "react"
import { useT } from "../i18n/useT"
import { TranslationKey } from "../i18n/translations"

/** Check whether the project tree contains any .lua / .luau files.
 *  Short-circuits on the first match since we only care about "any vs none". */
function hasAnyScript(tree: FileEntry[]): boolean {
  for (const e of tree) {
    if (e.type === "file") {
      if (e.name.endsWith(".lua") || e.name.endsWith(".luau")) return true
    } else if (e.children && hasAnyScript(e.children)) {
      return true
    }
  }
  return false
}

const statusConfig: Record<string, { color: string; glow: boolean; labelKey: TranslationKey }> = {
  stopped:    { color: "var(--text-ghost)", glow: false, labelKey: "rojoStopped" },
  starting:   { color: "var(--warning)", glow: false, labelKey: "rojoStarting" },
  running:    { color: "var(--success)", glow: true,  labelKey: "rojoServing" },
  error:      { color: "var(--danger)", glow: false, labelKey: "rojoError" }
}

export function RojoPanel(): JSX.Element {
  const { status, port, toolName, error } = useRojoStore()
  const { projectPath, fileTree } = useProjectStore()
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchResult, setBatchResult] = useState<string | null>(null)
  const [warnHover, setWarnHover] = useState(false)
  const [errorCopied, setErrorCopied] = useState(false)
  const t = useT()

  // Warn if project has zero script files — connecting Rojo to an existing
  // Studio place could delete content. Only relevant when stopped.
  const isProjectEmpty = useMemo(() => !hasAnyScript(fileTree), [fileTree])

  const cfg = statusConfig[status] ?? statusConfig.stopped

  const handleFormatAll = async () => {
    if (!projectPath || batchRunning) return
    setBatchRunning(true)
    setBatchResult(null)
    try {
      const res = await window.api.batchFormatAll(projectPath)
      setBatchResult(`Formatted ${res.formatted}/${res.total} files${res.failed ? `, ${res.failed} failed` : ""}`)
    } catch (err) {
      setBatchResult(`Error: ${String(err)}`)
    } finally {
      setBatchRunning(false)
    }
  }

  const handleLintAll = async () => {
    if (!projectPath || batchRunning) return
    setBatchRunning(true)
    setBatchResult(null)
    try {
      const res = await window.api.batchLintAll(projectPath)
      const withIssues = res.results.filter((r) => {
        const d = r.diagnostics as { diagnostics?: unknown[] } | null
        return d && Array.isArray(d.diagnostics) && d.diagnostics.length > 0
      }).length
      setBatchResult(`Linted ${res.total} files — ${withIssues} with issues`)
    } catch (err) {
      setBatchResult(`Error: ${String(err)}`)
    } finally {
      setBatchRunning(false)
    }
  }

  const handleToggle = async () => {
    if (!projectPath) return
    if (status === "running" || status === "starting") {
      await window.api.rojoStop()
    } else {
      await window.api.rojoServe(projectPath)
    }
  }

  const isActive = status === "running" || status === "starting"

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="px-3 py-2 flex-shrink-0"
        style={{
          fontSize: "10px",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          borderBottom: "1px solid var(--border-subtle)"
        }}
      >
        {toolName}
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* Status row */}
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: cfg.color,
              boxShadow: cfg.glow ? `0 0 6px ${cfg.color}` : "none",
              transition: "all 0.3s ease"
            }}
          />
          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            {t(cfg.labelKey)}
            {status === "running" && port && (
              <span style={{ color: "var(--text-muted)", marginLeft: "4px" }}>:{port}</span>
            )}
          </span>
        </div>

        {/* Error details — only on error, scrollable + copyable */}
        {status === "error" && error && (
          <div
            className="rounded-lg"
            style={{
              background: "rgba(244,71,71,0.06)",
              border: "1px solid rgba(244,71,71,0.25)",
              padding: "8px 10px"
            }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--danger)" }}>
                Error
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(error).then(() => {
                    setErrorCopied(true)
                    setTimeout(() => setErrorCopied(false), 1500)
                  })
                }}
                style={{
                  fontSize: "10px",
                  color: "var(--text-muted)",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "transparent",
                  border: "1px solid var(--border-subtle)"
                }}
              >
                {errorCopied ? "Copied" : "Copy"}
              </button>
            </div>
            <div
              style={{
                fontSize: "11px",
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                color: "var(--text-secondary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "120px",
                overflowY: "auto",
                lineHeight: 1.5
              }}
            >
              {error}
            </div>
          </div>
        )}

        {/* Toggle button (+ empty-project warning indicator) */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggle}
            className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-150"
            style={{
              background: isActive ? "rgba(244,71,71,0.12)" : "var(--accent-muted)",
              color: isActive ? "var(--danger)" : "var(--info)",
              border: `1px solid ${isActive ? "rgba(244,71,71,0.3)" : "var(--accent-muted)"}`
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = "0.8"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}
          >
            {isActive ? t("stop") : t("startServing")}
          </button>
          {!isActive && isProjectEmpty && (
            <div
              className="relative flex-shrink-0"
              onMouseEnter={() => setWarnHover(true)}
              onMouseLeave={() => setWarnHover(false)}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center cursor-help"
                style={{
                  background: "rgba(248,113,113,0.15)",
                  border: "1px solid rgba(248,113,113,0.4)"
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                </svg>
              </div>
              {warnHover && (
                <div
                  className="absolute z-20 rounded-lg px-3 py-2 pointer-events-none"
                  style={{
                    bottom: "calc(100% + 6px)",
                    right: 0,
                    width: "240px",
                    background: "var(--bg-elevated)",
                    border: "1px solid rgba(248,113,113,0.4)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    fontSize: "11px",
                    lineHeight: 1.5,
                    color: "var(--text-secondary)"
                  }}
                >
                  <div style={{ color: "#f87171", fontWeight: 600, marginBottom: "4px" }}>
                    {t("rojoEmptyWarningTitle")}
                  </div>
                  {t("rojoEmptyWarningBody")}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Batch Operations */}
        <div
          className="pt-2 mt-1 flex flex-col gap-2"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
            {t("tools")}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleFormatAll}
              disabled={batchRunning || !projectPath}
              className="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-40"
              style={{
                background: "var(--accent-muted)",
                color: "var(--success)",
                border: "1px solid var(--border-subtle)"
              }}
            >
              {batchRunning ? t("running") : t("formatAll")}
            </button>
            <button
              onClick={handleLintAll}
              disabled={batchRunning || !projectPath}
              className="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-40"
              style={{
                background: "var(--accent-muted)",
                color: "var(--info)",
                border: "1px solid var(--border-subtle)"
              }}
            >
              {batchRunning ? t("running") : t("lintAll")}
            </button>
          </div>
          {batchResult && (
            <span className="animate-fade-in" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              {batchResult}
            </span>
          )}
        </div>
      </div>

    </div>
  )
}
