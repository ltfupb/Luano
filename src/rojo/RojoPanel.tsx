import { useRojoStore } from "../stores/rojoStore"
import { useProjectStore } from "../stores/projectStore"
import { useRef, useEffect } from "react"

const statusConfig = {
  stopped: { color: "#3a5272", glow: false, label: "Stopped" },
  starting: { color: "#f59e0b", glow: false, label: "Starting…" },
  serving:  { color: "#10b981", glow: true,  label: "Serving" },
  error:    { color: "#e11d48", glow: false, label: "Error" }
}

export function RojoPanel(): JSX.Element {
  const { status, logs, port, clearLogs } = useRojoStore()
  const { projectPath } = useProjectStore()
  const logsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [logs])

  const cfg = statusConfig[status] ?? statusConfig.stopped

  const handleToggle = async () => {
    if (!projectPath) return
    if (status === "serving" || status === "starting") {
      await window.api.rojoStop()
    } else {
      await window.api.rojoServe(projectPath)
    }
  }

  const isActive = status === "serving" || status === "starting"

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
            {cfg.label}
            {status === "serving" && port && (
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
          {isActive ? "Stop" : "Start serving"}
        </button>

        <button
          onClick={clearLogs}
          className="py-1 px-2 rounded text-xs transition-all duration-100"
          style={{ color: "var(--text-muted)", fontSize: "11px" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
        >
          Clear logs
        </button>
      </div>

      {/* Logs */}
      <div
        ref={logsRef}
        className="flex-1 overflow-y-auto px-2 py-1 selectable"
        style={{ fontFamily: "monospace", fontSize: "11px" }}
      >
        {logs.length === 0 ? (
          <div className="px-1 py-2" style={{ color: "var(--text-muted)" }}>No logs</div>
        ) : (
          logs.map((log, i) => (
            <div
              key={i}
              className="py-0.5 leading-relaxed"
              style={{
                color: "var(--text-secondary)",
                borderBottom: "1px solid var(--border-subtle)"
              }}
            >
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
