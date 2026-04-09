import { useState, useEffect, useCallback } from "react"
import { useProjectStore } from "../stores/projectStore"
import { useT } from "../i18n/useT"

interface PerfWarning {
  file: string
  line: number
  rule: string
  message: string
  severity: "error" | "warn" | "info"
  suggestion?: string
}

type Tab = "perf" | "graph"

const SEV_COLORS = {
  error: { bg: "#2d1515", text: "#fca5a5", border: "#7f1d1d" },
  warn: { bg: "#2d2415", text: "#fcd34d", border: "#78350f" },
  info: { bg: "#112030", text: "#93c5fd", border: "#1e3a5a" }
}

interface CrossScriptPanelProps {
  onShowTopology?: (show: boolean) => void
}

export function CrossScriptPanel({ onShowTopology }: CrossScriptPanelProps): JSX.Element {
  const { projectPath, openFile } = useProjectStore()
  const [tab, setTab] = useState<Tab>("perf")
  const [perfWarnings, setPerfWarnings] = useState<PerfWarning[]>([])
  const [loading, setLoading] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchResult, setBatchResult] = useState<string | null>(null)
  const t = useT()

  const analyze = async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const perfResult = await window.api.perfLint(projectPath)
      if (Array.isArray(perfResult)) {
        setPerfWarnings(perfResult as PerfWarning[])
      }
    } catch (err) {
      console.error("[CrossScript] Analysis failed:", err)
    }
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-analyze only when project changes
  useEffect(() => { analyze() }, [projectPath])

  // Notify parent when graph tab is selected/deselected
  const handleTabChange = useCallback((newTab: Tab) => {
    setTab(newTab)
    onShowTopology?.(newTab === "graph")
  }, [onShowTopology])

  // Cleanup: hide topology when unmounting
  useEffect(() => {
    return () => onShowTopology?.(false)
  }, [onShowTopology])

  const handleOpenFile = async (filePath: string) => {
    try {
      const content = await window.api.readFile(filePath)
      openFile(filePath, content ?? "")
    } catch {}
  }

  const handleFormatAll = async () => {
    if (!projectPath || batchRunning) return
    setBatchRunning(true)
    setBatchResult(null)
    try {
      const res = await window.api.batchFormatAll(projectPath)
      setBatchResult(`Formatted ${res.formatted}/${res.total}${res.failed ? `, ${res.failed} failed` : ""}`)
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
      setBatchResult(`Linted ${res.total} — ${withIssues} with issues`)
    } catch (err) {
      setBatchResult(`Error: ${String(err)}`)
    } finally {
      setBatchRunning(false)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg-panel)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{t("analysis")}</span>
        <div className="ml-auto flex items-center gap-1">
          {/* Batch buttons */}
          <button
            onClick={handleFormatAll}
            disabled={batchRunning || !projectPath}
            className="px-1.5 py-0.5 text-[9px] rounded transition-colors disabled:opacity-40"
            style={{ background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.25)" }}
          >{batchRunning ? "..." : t("formatAll")}</button>
          <button
            onClick={handleLintAll}
            disabled={batchRunning || !projectPath}
            className="px-1.5 py-0.5 text-[9px] rounded transition-colors disabled:opacity-40"
            style={{ background: "rgba(96,165,250,0.1)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.25)" }}
          >{batchRunning ? "..." : t("lintAll")}</button>
          <button
            onClick={analyze}
            disabled={loading}
            className="px-2 py-0.5 text-[10px] rounded transition-colors"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              opacity: loading ? 0.5 : 1
            }}
          >{loading ? "..." : t("refresh")}</button>
        </div>
      </div>

      {/* Batch result */}
      {batchResult && (
        <div className="px-3 py-1 flex-shrink-0 animate-fade-in" style={{ fontSize: "10px", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)" }}>
          {batchResult}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        {(["perf", "graph"] as Tab[]).map((tabId) => (
          <button
            key={tabId}
            onClick={() => handleTabChange(tabId)}
            className="flex-1 py-1.5 text-[10px] font-medium transition-colors"
            style={{
              color: tab === tabId ? "var(--accent)" : "var(--text-muted)",
              borderBottom: tab === tabId ? "2px solid var(--accent)" : "2px solid transparent",
              background: "transparent"
            }}
          >
            {tabId === "perf" ? `${t("perf")} (${perfWarnings.length})` :
             t("topology")}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {tab === "graph" && (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: "var(--text-muted)" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.4 }}>
              <circle cx="5" cy="6" r="2" />
              <circle cx="19" cy="6" r="2" />
              <circle cx="12" cy="18" r="2" />
              <line x1="7" y1="6" x2="17" y2="6" />
              <line x1="6" y1="7.5" x2="11" y2="16.5" />
              <line x1="18" y1="7.5" x2="13" y2="16.5" />
            </svg>
            <p className="text-xs">Topology graph is shown in the editor area</p>
          </div>
        )}

        {tab === "perf" && (
          <div className="flex flex-col gap-1">
            {perfWarnings.length === 0 && (
              <p className="text-[11px] text-center py-4" style={{ color: "var(--text-muted)" }}>
                {t("noPerfWarnings")}
              </p>
            )}
            {perfWarnings.map((w, i) => {
              const c = SEV_COLORS[w.severity]
              return (
                <button
                  key={i}
                  onClick={() => handleOpenFile(w.file)}
                  className="text-left rounded-lg p-2 transition-colors hover:brightness-110"
                  style={{ background: c.bg, border: `1px solid ${c.border}` }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase" style={{ color: c.text }}>
                      {w.severity}
                    </span>
                    <span className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>
                      {w.file}:{w.line}
                    </span>
                  </div>
                  <p className="text-[10px] mt-0.5" style={{ color: c.text }}>{w.message}</p>
                  {w.suggestion && (
                    <p className="text-[9px] mt-0.5 font-mono" style={{ color: "var(--text-muted)" }}>
                      {w.suggestion}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
