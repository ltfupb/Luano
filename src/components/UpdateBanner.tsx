import { useState, useEffect } from "react"
import { useIpcEvent } from "../hooks/useIpc"

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "error"
interface UpdateState {
  status: UpdateStatus
  version?: string
  progress?: number
}

export function UpdateBanner(): JSX.Element | null {
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" })
  const [dismissed, setDismissed] = useState(false)

  useIpcEvent("updater:status", (data) => {
    const next = data as UpdateState
    // Reset dismissed when a new version becomes available
    if (next.status === "available") setDismissed(false)
    setUpdate(next)
  })

  useEffect(() => {
    if (typeof window.api.updaterStatus === "function") {
      window.api.updaterStatus().then(setUpdate).catch(() => {})
    }
  }, [])

  const visible =
    !dismissed &&
    (update.status === "available" || update.status === "downloading" || update.status === "downloaded")

  if (!visible) return null

  const isDownloaded = update.status === "downloaded"
  const isDownloading = update.status === "downloading"

  const handleAction = async () => {
    if (update.status === "available") {
      await window.api.updaterDownload()
    } else if (isDownloaded) {
      await window.api.updaterInstall()
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: "40px",
        right: "16px",
        width: "300px",
        background: isDownloaded ? "var(--bg-elevated)" : "var(--bg-elevated)",
        border: `1px solid ${isDownloaded ? "var(--success)" : "var(--info)"}`,
        borderRadius: "8px",
        padding: "12px 14px",
        zIndex: 9999,
        boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        display: "flex",
        flexDirection: "column",
        gap: "8px"
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          fontSize: "13px",
          fontWeight: 600,
          color: isDownloaded ? "var(--success)" : "var(--info)"
        }}>
          {isDownloaded ? "Restart to update" : isDownloading ? "Downloading update…" : `Update available — v${update.version}`}
        </span>
        {!isDownloading && (
          <button
            onClick={() => setDismissed(true)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: "0 0 0 8px",
              lineHeight: 1,
              fontSize: "16px"
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Progress bar */}
      {isDownloading && (
        <div style={{
          height: "4px",
          background: "var(--border-subtle)",
          borderRadius: "2px",
          overflow: "hidden"
        }}>
          <div style={{
            height: "100%",
            width: `${update.progress ?? 0}%`,
            background: "var(--info)",
            borderRadius: "2px",
            transition: "width 0.3s ease"
          }} />
        </div>
      )}

      {/* Description + action */}
      {!isDownloading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            {isDownloaded
              ? "Luano will restart and install the update."
              : "A new version of Luano is ready to download."}
          </span>
          <button
            onClick={handleAction}
            style={{
              flexShrink: 0,
              fontSize: "12px",
              fontWeight: 600,
              padding: "5px 12px",
              borderRadius: "5px",
              border: "none",
              cursor: "pointer",
              background: isDownloaded ? "var(--success)" : "var(--info)",
              color: "#fff"
            }}
          >
            {isDownloaded ? "Restart" : "Download"}
          </button>
        </div>
      )}

      {/* Downloading percentage */}
      {isDownloading && (
        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          {update.progress ?? 0}% downloaded
        </span>
      )}
    </div>
  )
}
