import { useState, useEffect } from "react"
import { useRojoStore } from "../stores/rojoStore"
import { useProjectStore } from "../stores/projectStore"
import { useIpcEvent } from "../hooks/useIpc"

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "error"
interface UpdateState {
  status: UpdateStatus
  version?: string
  progress?: number
}

const statusDot: Record<string, string> = {
  stopped: "#3a5272",
  starting: "#f59e0b",
  running: "#10b981",
  error: "#e11d48"
}

const statusLabel: Record<string, string> = {
  stopped: "Rojo stopped",
  starting: "Rojo starting…",
  running: "Rojo serving",
  error: "Rojo error"
}

export function StatusBar(): JSX.Element {
  const { status } = useRojoStore()
  const { activeFile, lspPort } = useProjectStore()
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" })

  // Listen for updater status events from main process
  useIpcEvent("updater:status", (data) => {
    setUpdate(data as UpdateState)
  })

  const [memMB, setMemMB] = useState(0)

  // Fetch initial status
  useEffect(() => {
    if (typeof window.api.updaterStatus === "function") {
      window.api.updaterStatus().then(setUpdate).catch(() => {})
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

  const handleUpdateAction = async () => {
    if (update.status === "available") {
      await window.api.updaterDownload()
    } else if (update.status === "downloaded") {
      await window.api.updaterInstall()
    }
  }

  return (
    <div
      className="h-[22px] flex items-center px-3 gap-4 flex-shrink-0"
      style={{
        background: "var(--bg-panel)",
        borderTop: "1px solid var(--border-subtle)",
        fontSize: "11px"
      }}
    >
      {/* Rojo status */}
      <div className="flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{
            background: statusDot[status] ?? statusDot.stopped,
            boxShadow: status === "running" ? "0 0 4px #10b981" : "none"
          }}
        />
        <span style={{ color: "var(--text-muted)" }}>{statusLabel[status] ?? status}</span>
      </div>

      {/* Separator */}
      {lspPort && <span style={{ color: "var(--border)", userSelect: "none" }}>·</span>}

      {/* LSP port */}
      {lspPort && (
        <span style={{ color: "var(--text-muted)" }}>LSP :{lspPort}</span>
      )}

      {/* Update notification — right side */}
      {(update.status === "available" || update.status === "downloading" || update.status === "downloaded") && (
        <>
          <span style={{ color: "var(--border)", userSelect: "none" }} className="ml-auto">·</span>
          <button
            onClick={handleUpdateAction}
            className="flex items-center gap-1 transition-colors duration-100"
            style={{
              color: update.status === "downloaded" ? "#10b981" : "#60a5fa",
              cursor: update.status === "downloading" ? "default" : "pointer",
              background: "none",
              border: "none",
              fontSize: "11px"
            }}
            disabled={update.status === "downloading"}
          >
            {update.status === "available" && (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                v{update.version} available
              </>
            )}
            {update.status === "downloading" && (
              <span>{update.progress ?? 0}% downloading…</span>
            )}
            {update.status === "downloaded" && (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                Restart to update
              </>
            )}
          </button>
        </>
      )}

      {/* Memory usage */}
      {memMB > 0 && (
        <>
          <span style={{ color: "var(--border)", userSelect: "none" }}>·</span>
          <span
            style={{ color: memMB > 500 ? "#f59e0b" : "var(--text-muted)" }}
            title={`Memory: ${memMB} MB RSS`}
          >
            {memMB} MB
          </span>
        </>
      )}

      {/* Active file — right aligned */}
      {activeFile && (
        <span
          className={update.status === "available" || update.status === "downloading" || update.status === "downloaded" ? "truncate max-w-[240px]" : "ml-auto truncate max-w-[240px]"}
          style={{ color: "var(--text-muted)" }}
        >
          {activeFile.split(/[/\\]/).pop()}
        </span>
      )}
    </div>
  )
}
