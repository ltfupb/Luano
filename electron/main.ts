import "./bootstrap"
import { app, BrowserWindow, dialog, ipcMain, shell, screen } from "electron"
import { log } from "./logger"
import { join } from "path"
import { pathToFileURL } from "url"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import { registerIpcHandlers, cleanupPtys } from "./ipc/handlers"
import { refreshInstalledPluginToken } from "./ipc/bridge-handlers"
import { stopWatcher } from "./file/watcher"
import { LspManager } from "./lsp/manager"
import { SyncManager } from "./toolchain/sync-manager"
import { startBridgeServer, stopBridgeServer, setBridgeWindow, forceResetSessionState, mcpShutdown } from "./pro/modules"
import { setupUpdater } from "./updater"
import { initSentry } from "./sentry"
import { installMenu } from "./menu"
// H14: abortAgent + forceResetSessionState needed to fully release session
// state on render-process-gone.
import { abortAgent } from "./ai/provider"

let mainWindow: BrowserWindow | null = null

export const syncManager = new SyncManager()
export const lspManager = new LspManager()

/**
 * Decide whether a main-frame navigation target is safe to allow. Pulled out
 * of the inline `will-navigate` handler so it's unit-testable without booting
 * a real BrowserWindow.
 *
 * Allowed:
 *   - `devtools:` URLs (Chromium devtools frames)
 *   - the dev-server origin (only when `isPackaged` is false)
 *   - `file:` navigation to the exact renderer entry URL (reloads / internal nav)
 *
 * Everything else — including other `file:` URLs, `http(s):` to any origin,
 * and malformed URLs — is refused.
 */
export function shouldAllowNavigation(
  url: string,
  opts: { isPackaged: boolean; devUrl?: string; rendererEntryUrl: string }
): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === "devtools:") return true
  if (!opts.isPackaged && opts.devUrl) {
    try {
      const devOrigin = new URL(opts.devUrl).origin
      if (parsed.origin === devOrigin) return true
    } catch { /* bad devUrl — fall through */ }
  }
  if (parsed.protocol === "file:" && parsed.href === opts.rendererEntryUrl) return true
  return false
}

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

/**
 * H14: handle a render-process-gone event by releasing the agent session state.
 * Pulled out of createWindow so it can be unit-tested without booting a real
 * BrowserWindow. abortAgent signals the in-flight LLM call;
 * forceResetSessionState clears the mutex, sender-id, and abort controller
 * synchronously since the inner agent loop's async finally can't be relied on
 * after the renderer is gone.
 * @internal exported for tests
 */
export function handleRenderProcessGone(reason: string): void {
  log.warn("[main] render process gone", { reason })
  abortAgent()
  forceResetSessionState()
}

function registerWindowHandlers(): void {
  // Renderer pushes theme-aware overlay colors when the user switches themes.
  // No-op on macOS (uses native traffic-light overlay, not titleBarOverlay).
  ipcMain.handle("window:set-overlay-colors", (_e, opts: { color: string; symbolColor: string }) => {
    if (process.platform === "darwin" || !mainWindow || mainWindow.isDestroyed()) return
    try {
      mainWindow.setTitleBarOverlay({
        color: opts.color,
        symbolColor: opts.symbolColor,
        height: TITLE_BAR_HEIGHT
      })
    } catch (err) {
      log.warn("setTitleBarOverlay failed:", err)
    }
  })

  // Synchronous read of current maximized state — AppTitlebar uses this on
  // mount to render its initial state, then subscribes to "window:state" for
  // changes (see ready-to-show wiring in createWindow).
  ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false)
}

// ── Custom titlebar ─────────────────────────────────────────────────────────
// We render menu + window-controls into a single bar managed by the renderer
// (`AppTitlebar`). On Windows/Linux we use `titleBarOverlay` so the native
// min/max/close glyphs sit inside the renderer-painted bar. On macOS we use
// `hiddenInset` and reserve space on the left for the traffic lights.
const TITLE_BAR_HEIGHT = 36

// Default colors match the dark theme. The renderer pushes theme-aware values
// via `window:set-overlay-colors` once it boots, so a brief flash on startup
// uses these defaults rather than Electron's stark white.
const DEFAULT_OVERLAY = {
  color: "#252526",       // var(--bg-panel) dark
  symbolColor: "#bdbdbd"  // var(--text-secondary) dark
} as const

function createWindow(): void {
  const state = loadWindowState()
  const isMac = process.platform === "darwin"

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    // Vertically center the traffic lights inside our 36px bar. Default y is
    // tuned for the standard 28px chrome — on a taller bar they hug the top.
    ...(isMac ? { trafficLightPosition: { x: 12, y: 10 } } : {}),
    ...(isMac ? {} : {
      titleBarOverlay: {
        color: DEFAULT_OVERLAY.color,
        symbolColor: DEFAULT_OVERLAY.symbolColor,
        height: TITLE_BAR_HEIGHT
      }
    }),
    icon: join(__dirname, "../../resources/icons/icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox:true restricts the preload's Node.js surface to a curated
      // subset. `randomUUID` was the only `node:crypto` consumer in the
      // preload and it now comes from Web Crypto, so flipping this on is
      // a pure defense-in-depth gain: if an XSS ever reaches the preload,
      // it can't reach into `fs`, `child_process`, etc.
      sandbox: true
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

  // Tell the renderer when the maximized state flips, so AppTitlebar can flip
  // its restore-on-double-click affordances and any future custom controls.
  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:state", { maximized: true })
  })
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:state", { maximized: false })
  })

  // Persist window bounds on change. Debounced 500ms so a drag doesn't
  // hammer the disk.
  const saveHandler = (): void => scheduleSaveWindowState(mainWindow!)
  mainWindow.on("resize", saveHandler)
  mainWindow.on("move", saveHandler)
  mainWindow.on("maximize", saveHandler)
  mainWindow.on("unmaximize", saveHandler)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") {
        void shell.openExternal(url)
      }
    } catch { /* invalid URL — deny */ }
    return { action: "deny" }
  })

  // Block any attempt to navigate the main frame away from the app's origin.
  // Without this, a compromised renderer (or a crafted link with target=_self)
  // could replace the app shell with an attacker-controlled page that still
  // has preload access.
  //
  // `file:` is restricted to the single renderer entry file we actually load
  // in packaged builds. Allowing any `file:` URL was too permissive — an
  // attacker with local file write (or a symlink trick inside a trusted
  // directory) could drop an HTML file somewhere we'd navigate to, and
  // keep preload access. Exact-match against the canonical entry path.
  const rendererEntryUrl = pathToFileURL(
    join(app.getAppPath(), "out", "renderer", "index.html")
  ).href
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = shouldAllowNavigation(url, {
      isPackaged: app.isPackaged,
      devUrl: process.env["ELECTRON_RENDERER_URL"],
      rendererEntryUrl
    })
    if (allowed) return
    event.preventDefault()
    try {
      const parsed = new URL(url)
      if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
        void shell.openExternal(url)
      }
    } catch { /* malformed url — already prevented */ }
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
    ).catch((err) => { log.warn("[main] dirtyCount probe failed:", err); return 0 }).then((count: number) => {
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
          }).catch((err) => {
            log.error("[main] saveAll failed before quit — destroying window:", err)
            mainWindow!.destroy()
          })
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

  // H14: release the agent mutex if the renderer process crashes (OOM,
  // segfault). Without this, _agentRunning stays true permanently and the
  // next session request is rejected with "already running".
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    handleRenderProcessGone(details.reason)
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

// H13: enforce single-instance lock BEFORE app is ready. If a second instance
// tries to launch, focus the existing window and quit. Without this, two
// concurrent instances race on settings.json, bridge token, and LSP port.
const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) {
  log.info("Another Luano instance is already running — quitting.")
  app.quit()
}

app.on("second-instance", () => {
  // A second launch attempt happened — bring the existing window to front.
  // Defer through whenReady so a fast second-launch race (before mainWindow
  // is created) still focuses the window once it exists.
  const focus = (): void => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
  if (mainWindow) focus()
  else app.whenReady().then(focus).catch((err) => {
    log.warn("[main] second-instance focus failed:", err)
  })
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId("io.luano.app")

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window, { escToCloseWindow: false, zoom: false })
  })

  log.info("Luano starting", { version: app.getVersion(), platform: process.platform })

  startBridgeServer()
  registerIpcHandlers()
  registerWindowHandlers()
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
  // On macOS the app stays running after all windows close — `activate` will
  // recreate the window. Tearing down bridge/lsp/sync here would leave the
  // next window without its backing services. Only do full shutdown on the
  // platforms where window-all-closed actually means "quit".
  if (process.platform !== "darwin") {
    cleanupPtys()
    stopWatcher()
    stopBridgeServer()
    mcpShutdown()
    syncManager.stop()
    await lspManager.stop()
    app.quit()
  }
})
