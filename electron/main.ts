import "./bootstrap"
import { app, BrowserWindow, dialog, shell, screen } from "electron"
import { log } from "./logger"
import { join } from "path"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import { registerIpcHandlers, cleanupPtys } from "./ipc/handlers"
import { refreshInstalledPluginToken } from "./ipc/bridge-handlers"
import { stopWatcher } from "./file/watcher"
import { LspManager } from "./lsp/manager"
import { SyncManager } from "./toolchain/sync-manager"
import { startBridgeServer, stopBridgeServer, setBridgeWindow } from "./pro/modules"
import { setupUpdater } from "./updater"
import { initSentry } from "./sentry"
import { installMenu } from "./menu"

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

// ── Window bounds persistence ───────────────────────────────────────────────
// Saves the user's window size/position on resize/move/maximize, restores on
// launch. Validated against current displays so a window on a disconnected
// second monitor falls back to defaults instead of opening offscreen.
interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1280,
  height: 800,
  maximized: false
}

function getWindowStatePath(): string {
  return join(app.getPath("userData"), "window-state.json")
}

function loadWindowState(): WindowState {
  try {
    const path = getWindowStatePath()
    if (!existsSync(path)) return DEFAULT_WINDOW_STATE
    const raw = readFileSync(path, "utf-8")
    const parsed = JSON.parse(raw) as Partial<WindowState>
    const width = typeof parsed.width === "number" && parsed.width >= 900 ? parsed.width : DEFAULT_WINDOW_STATE.width
    const height = typeof parsed.height === "number" && parsed.height >= 600 ? parsed.height : DEFAULT_WINDOW_STATE.height
    const state: WindowState = {
      width,
      height,
      maximized: parsed.maximized === true
    }
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      // Validate against current displays so a window on a disconnected
      // second monitor doesn't open invisible.
      const bounds = { x: parsed.x, y: parsed.y, width, height }
      const display = screen.getDisplayMatching(bounds)
      const wa = display.workArea
      const fits =
        bounds.x >= wa.x - 50 &&
        bounds.y >= wa.y - 50 &&
        bounds.x + 200 <= wa.x + wa.width &&
        bounds.y + 100 <= wa.y + wa.height
      if (fits) {
        state.x = parsed.x
        state.y = parsed.y
      }
    }
    return state
  } catch (err) {
    log.warn("Failed to load window state:", err)
    return DEFAULT_WINDOW_STATE
  }
}

let saveStateTimer: NodeJS.Timeout | null = null
function scheduleSaveWindowState(win: BrowserWindow): void {
  if (saveStateTimer) clearTimeout(saveStateTimer)
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null
    if (win.isDestroyed()) return
    try {
      const isMaximized = win.isMaximized()
      // When maximized, getBounds() returns the maximized size. Use
      // getNormalBounds() so un-maximize restores to the pre-maximize size.
      const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
      const state: WindowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized: isMaximized
      }
      writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2), "utf-8")
    } catch (err) {
      log.warn("Failed to save window state:", err)
    }
  }, 500)
}

function createWindow(): void {
  const state = loadWindowState()

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: state.width,
    height: state.height,
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
  }
  if (typeof state.x === "number" && typeof state.y === "number") {
    windowOptions.x = state.x
    windowOptions.y = state.y
  }

  mainWindow = new BrowserWindow(windowOptions)

  mainWindow.on("ready-to-show", () => {
    mainWindow!.show()
    if (state.maximized) mainWindow!.maximize()
    setBridgeWindow(mainWindow!)
  })

  // Persist window bounds on change. Debounced 500ms so a drag doesn't
  // hammer the disk.
  const saveHandler = (): void => scheduleSaveWindowState(mainWindow!)
  mainWindow.on("resize", saveHandler)
  mainWindow.on("move", saveHandler)
  mainWindow.on("maximize", saveHandler)
  mainWindow.on("unmaximize", saveHandler)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  mainWindow.on("close", (e) => {
    // Flush any pending debounced save synchronously — otherwise the user's
    // last move/resize right before quit can be lost with the timer.
    if (saveStateTimer) {
      clearTimeout(saveStateTimer)
      saveStateTimer = null
      try {
        const isMaximized = mainWindow!.isMaximized()
        const bounds = isMaximized ? mainWindow!.getNormalBounds() : mainWindow!.getBounds()
        const state: WindowState = {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          maximized: isMaximized
        }
        writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2), "utf-8")
      } catch (err) {
        log.warn("Failed to save window state on close:", err)
      }
    }

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
  installMenu(mainWindow)

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
  stopBridgeServer()
  syncManager.stop()
  await lspManager.stop()
  if (process.platform !== "darwin") app.quit()
})
