import { useState, useEffect } from "react"
import { useIpcEvent } from "../hooks/useIpc"
import { ConfirmDialog } from "./ConfirmDialog"
import { useT } from "../i18n/useT"

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "error"
interface UpdateState {
  status: UpdateStatus
  version?: string
  progress?: number
}

export function UpdateBanner(): JSX.Element | null {
  const t = useT()
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" })
  const [dismissed, setDismissed] = useState(false)
  // Second confirmation before actually quitting the app to install. Without
  // this, clicking the green "Restart" button in the banner was a one-click
  // quit — risky if the user is mid-edit. The banner's X dismiss still
  // handles the "not now" case, so this dialog just needs a clear Install
  // Now + Cancel. No "Later" wording — that's the X button's job.
  const [confirmInstall, setConfirmInstall] = useState(false)

  useIpcEvent("updater:status", (data) => {
    const next = data as UpdateState
    // Reset dismissed when a new download finishes so the user always sees
    // the "restart to apply" prompt for a fresh version.
    if (next.status === "downloaded") setDismissed(false)
    setUpdate(next)
  })

  useEffect(() => {
    if (typeof window.api.updaterStatus === "function") {
      window.api.updaterStatus().then(setUpdate).catch(() => {})
    }
  }, [])

  // Banner only appears once the update is fully downloaded and ready to
  // install. The download itself runs silently in the background.
  if (dismissed || update.status !== "downloaded") return null

  return (
    <div
      style={{
        position: "fixed",
        top: "40px",
        right: "16px",
        width: "300px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--success)",
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
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--success)" }}>
          Restart to apply — v{update.version}
        </span>
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
      </div>

      {/* Restart action */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          Luano will restart and install the update.
        </span>
        <button
          onClick={() => setConfirmInstall(true)}
          style={{
            flexShrink: 0,
            fontSize: "12px",
            fontWeight: 600,
            padding: "5px 12px",
            borderRadius: "5px",
            border: "none",
            cursor: "pointer",
            background: "var(--success)",
            color: "#fff"
          }}
        >
          Restart
        </button>
      </div>

      {confirmInstall && (
        <ConfirmDialog
          title={t("updateConfirmTitle").replace("{version}", update.version ?? "")}
          body=""
          confirmLabel={t("updateConfirmAccept")}
          cancelLabel={t("updateConfirmCancel")}
          onConfirm={() => {
            setConfirmInstall(false)
            void window.api.updaterInstall()
          }}
          onCancel={() => setConfirmInstall(false)}
        />
      )}
    </div>
  )
}
