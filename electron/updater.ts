import { autoUpdater } from "electron-updater"
import { BrowserWindow } from "electron"
import { ipcMain } from "electron"

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

function broadcast(s: UpdateState): void {
  state = s
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send("updater:status", s)
    }
  })
}

export function setupUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on("checking-for-update", () => {
    broadcast({ status: "checking" })
  })

  autoUpdater.on("update-available", (info) => {
    broadcast({ status: "available", version: info.version })
  })

  autoUpdater.on("update-not-available", () => {
    broadcast({ status: "idle" })
  })

  autoUpdater.on("download-progress", (progress) => {
    broadcast({ status: "downloading", progress: Math.round(progress.percent) })
  })

  autoUpdater.on("update-downloaded", (info) => {
    broadcast({ status: "downloaded", version: info.version })
  })

  autoUpdater.on("error", (err) => {
    broadcast({ status: "error", error: err.message })
  })

  // IPC handlers
  ipcMain.handle("updater:check", async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, version: result?.updateInfo?.version }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle("updater:download", async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle("updater:install", () => {
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
  autoUpdater.checkForUpdates().catch(() => {})

  // Re-check hourly so long-running sessions still pick up new releases.
  // Skip when a download is already in flight or finished — we don't want
  // to thrash an active install or redownload the same version.
  setInterval(() => {
    if (state.status === "downloading" || state.status === "downloaded") return
    autoUpdater.checkForUpdates().catch(() => {})
  }, 60 * 60 * 1000)
}
