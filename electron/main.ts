import { app, BrowserWindow, dialog, shell } from "electron"
import { log } from "./logger"
import { join } from "path"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import { registerIpcHandlers, cleanupPtys } from "./ipc/handlers"
import { stopWatcher } from "./file/watcher"
import { RojoManager } from "./sidecar/rojo"
import { LspManager } from "./lsp/manager"
import { startBridgeServer, setBridgeWindow } from "./pro/modules"
import { setupUpdater } from "./updater"

let mainWindow: BrowserWindow | null = null

export const rojoManager = new RojoManager()
export const lspManager = new LspManager()

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
    mainWindow.webContents.openDevTools({ mode: "detach" })
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
  rojoManager.stop()
  await lspManager.stop()
  if (process.platform !== "darwin") app.quit()
})
