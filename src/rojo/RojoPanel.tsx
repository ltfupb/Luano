import { useRojoStore } from "../stores/rojoStore"
import { useProjectStore } from "../stores/projectStore"
import { useState } from "react"
import { useT } from "../i18n/useT"
import { TranslationKey } from "../i18n/translations"

const statusConfig: Record<string, { color: string; glow: boolean; labelKey: TranslationKey }> = {
  stopped:    { color: "#3a5272", glow: false, labelKey: "rojoStopped" },
  starting:   { color: "#f59e0b", glow: false, labelKey: "rojoStarting" },
  running:    { color: "#10b981", glow: true,  labelKey: "rojoServing" },
  error:      { color: "#e11d48", glow: false, labelKey: "rojoError" }
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
            background: isActive ? "rgba(225,29,72,0.12)" : "rgba(37,99,235,0.12)",
            color: isActive ? "#fb7185" : "#60a5fa",
            border: `1px solid ${isActive ? "rgba(225,29,72,0.3)" : "rgba(37,99,235,0.3)"}`
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
                background: "rgba(16,185,129,0.1)",
                color: "#10b981",
                border: "1px solid rgba(16,185,129,0.25)"
              }}
            >
              {batchRunning ? t("running") : t("formatAll")}
            </button>
            <button
              onClick={handleLintAll}
              disabled={batchRunning || !projectPath}
              className="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-40"
              style={{
                background: "rgba(96,165,250,0.1)",
                color: "#60a5fa",
                border: "1px solid rgba(96,165,250,0.25)"
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
