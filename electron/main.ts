import "./bootstrap"
import { app, BrowserWindow, dialog, shell } from "electron"
import { log } from "./logger"
import { join } from "path"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import { registerIpcHandlers, cleanupPtys } from "./ipc/handlers"
import { refreshInstalledPluginToken } from "./ipc/bridge-handlers"
import { stopWatcher } from "./file/watcher"
import { LspManager } from "./lsp/manager"
import { SyncManager } from "./toolchain/sync-manager"
import { startBridgeServer, setBridgeWindow } from "./pro/modules"
import { setupUpdater } from "./updater"
import { initSentry } from "./sentry"

let mainWindow: BrowserWindow | null = null

export const syncManager = new SyncManager()
export const lspManager = new LspManager()

// Vite dev needs unsafe-eval for HMR, so the CSP warning fires on every
// renderer load. The warning auto-disables in packaged builds — suppress
// it in dev to keep the console clean. Must be set before any window loads.
if (!app.isPackaged) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true"
}

// Sentry MUST init before app 'ready' fires — its configureProtocol step
// calls protocol.registerSchemesAsPrivileged, which throws after ready.
// Done at module top so it runs before any whenReady handler.
try {
  initSentry()
} catch (err) {
  const detail = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
  log.error("Sentry init failed:", detail)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "default",
    icon: join(__dirname, "../../resources/icons/icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on("ready-to-show", () => {
    mainWindow!.show()
    setBridgeWindow(mainWindow!)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  mainWindow.on("close", (e) => {
    // Always prevent default first — close is a sync event, so
    // preventDefault must be called synchronously before any async work.
    e.preventDefault()

    mainWindow!.webContents.executeJavaScript(
      "window.__luanoDirtyCount?.()"
    ).catch(() => 0).then((count: number) => {
      if (!count) {
        mainWindow!.destroy()
        return
      }
      dialog.showMessageBox(mainWindow!, {
        type: "warning",
        buttons: ["Save & Quit", "Quit without Saving", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        title: "Unsaved Changes",
        message: `${count} unsaved file(s). Save before quitting?`
      }).then(({ response }) => {
        if (response === 0) {
          mainWindow!.webContents.executeJavaScript("window.__luanoSaveAll?.()").then(() => {
            mainWindow!.destroy()
          }).catch(() => mainWindow!.destroy())
        } else if (response === 1) {
          mainWindow!.destroy()
        }
        // response === 2 (Cancel): do nothing, window stays open
      })
    })
  })

  // Prevent Chromium default zoom (Ctrl+=/-, Ctrl+0) — font size is handled in renderer
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if ((input.control || input.meta) && (input.key === "=" || input.key === "+" || input.key === "-" || input.key === "0")) {
      event.preventDefault()
    }
  })

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"])
    mainWindow.webContents.on("did-finish-load", () => {
      mainWindow!.webContents.openDevTools({ mode: "detach" })
    })
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("io.luano.app")

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window, { escToCloseWindow: false, zoom: false })
  })

  log.info("Luano starting", { version: app.getVersion(), platform: process.platform })

  startBridgeServer()
  registerIpcHandlers()
  // Ensure the installed Studio plugin file matches the current bridge token.
  // The token is persisted across launches, but a plugin installed under an
  // older Luano build (or after userData was wiped) can still carry a stale
  // token and 403 on every report. Rewriting the file here is a safety net.
  refreshInstalledPluginToken()
  setupUpdater()
  createWindow()

  // Validate license key on startup (non-blocking)
  import("./pro/license").then(({ validateLicense }) => validateLicense()).catch((err) => log.error("License validation failed", err))

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", async () => {
  log.info("All windows closed, cleaning up")
  cleanupPtys()
  stopWatcher()
  syncManager.stop()
  await lspManager.stop()
  if (process.platform !== "darwin") app.quit()
})
