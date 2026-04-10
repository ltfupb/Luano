import { useRojoStore } from "../stores/rojoStore"
import { useProjectStore } from "../stores/projectStore"
import { useState } from "react"
import { useT } from "../i18n/useT"
import { TranslationKey } from "../i18n/translations"

const statusConfig: Record<string, { color: string; glow: boolean; labelKey: TranslationKey }> = {
  stopped:    { color: "var(--text-ghost)", glow: false, labelKey: "rojoStopped" },
  starting:   { color: "var(--warning)", glow: false, labelKey: "rojoStarting" },
  running:    { color: "var(--success)", glow: true,  labelKey: "rojoServing" },
  error:      { color: "var(--danger)", glow: false, labelKey: "rojoError" }
}

export function RojoPanel(): JSX.Element {
  const { status, port } = useRojoStore()
  const { projectPath } = useProjectStore()
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchResult, setBatchResult] = useState<string | null>(null)
  const t = useT()

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
        Rojo
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

        {/* Toggle button */}
        <button
          onClick={handleToggle}
          className="py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-150"
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
