import { autoUpdater } from "electron-updater"
import { BrowserWindow } from "electron"
import { ipcMain } from "electron"
import { log } from "./logger"

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error"

interface UpdateState {
  status: UpdateStatus
  version?: string
  progress?: number
  error?: string
}

let state: UpdateState = { status: "idle" }

// Rate-limit the renderer-facing IPC so a compromised window can't spam
// network + disk by calling check/download in a loop. 30s is generous
// enough that a manual "check for updates" button press will always pass
// (the UI debounce is much shorter) but small enough that a scripted
// loop can't inflict real churn.
const UPDATER_RATE_LIMIT_MS = 30_000
let lastCheckAt = 0
let lastDownloadAt = 0

function broadcast(s: UpdateState): void {
  state = s
  // Defer each send via setImmediate so a slow IPC channel on one window
  // doesn't block the broadcast loop (relevant when multiple windows are
  // open and the main thread is under load during downloads).
  BrowserWindow.getAllWindows().forEach((win) => {
    setImmediate(() => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send("updater:status", s)
      }
    })
  })
}

export function setupUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // H8: enforce code-signature verification. electron-updater verifies
  // signatures on downloaded installers by default; making it explicit is
  // auditable. On macOS, notarization is configured in package.json build.mac.
  // Note: verifyUpdateCodeSignature is a Windows-specific option in some
  // electron-updater versions — it is set only when the property exists.
  if ("verifyUpdateCodeSignature" in autoUpdater) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (autoUpdater as any).verifyUpdateCodeSignature = true
  }

  autoUpdater.on("checking-for-update", () => {
    log.info("[updater] checking for update")
    broadcast({ status: "checking" })
  })

  autoUpdater.on("update-available", (info) => {
    log.info(`[updater] update available: v${info.version}`)
    broadcast({ status: "available", version: info.version })
  })

  autoUpdater.on("update-not-available", () => {
    log.info("[updater] no update available")
    broadcast({ status: "idle" })
  })

  autoUpdater.on("download-progress", (progress) => {
    broadcast({ status: "downloading", progress: Math.round(progress.percent) })
  })

  autoUpdater.on("update-downloaded", (info) => {
    log.info(`[updater] downloaded: v${info.version}`)
    broadcast({ status: "downloaded", version: info.version })
  })

  autoUpdater.on("error", (err) => {
    log.error("[updater] error:", err)
    broadcast({ status: "error", error: err.message })
  })

  // IPC handlers
  ipcMain.handle("updater:check", async () => {
    const now = Date.now()
    if (now - lastCheckAt < UPDATER_RATE_LIMIT_MS) {
      return { success: false, error: "rate limited" }
    }
    lastCheckAt = now
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, version: result?.updateInfo?.version }
    } catch (err) {
      log.warn("[updater] checkForUpdates failed:", err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle("updater:download", async () => {
    const now = Date.now()
    if (now - lastDownloadAt < UPDATER_RATE_LIMIT_MS) {
      return { success: false, error: "rate limited" }
    }
    lastDownloadAt = now
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      log.warn("[updater] downloadUpdate failed:", err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle("updater:install", () => {
    // Refuse install unless an update is actually downloaded. Without this
    // guard, calling quitAndInstall before download completes would kill
    // the app with no installer waiting, locking the user out.
    if (state.status !== "downloaded") {
      return {
        success: false,
        error: `no update downloaded (current status: ${state.status})`
      }
    }
    // isSilent=true: pass /S to NSIS so the setup wizard doesn't show on
    // update installs. Without this, every update flashes the full
    // "choose directory" wizard even though the user already chose one at
    // first install. isForceRunAfter=true relaunches the app post-install.
    autoUpdater.quitAndInstall(true, true)
    return { success: true }
  })

  ipcMain.handle("updater:status", () => state)

  // Check immediately on startup. UpdateBanner pulls current state on mount,
  // so missing the early broadcast (before any window exists) is recoverable.
  autoUpdater.checkForUpdates().catch((err) => {
    log.warn("[updater] startup checkForUpdates failed:", err)
  })

  // Re-check hourly so long-running sessions still pick up new releases.
  // Skip when a download is already in flight or finished — we don't want
  // to thrash an active install or redownload the same version.
  setInterval(() => {
    if (state.status === "downloading" || state.status === "downloaded") return
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn("[updater] hourly checkForUpdates failed:", err)
    })
  }, 60 * 60 * 1000)
}
