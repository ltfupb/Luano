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
  autoUpdater.autoDownload = false
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
    autoUpdater.quitAndInstall(false, true)
    return { success: true }
  })

  ipcMain.handle("updater:status", () => state)

  // Auto-check on startup (delay 10s to not block launch)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 10_000)
}
