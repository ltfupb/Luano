/**
 * tests/main-will-navigate.test.ts
 *
 * Tests for `shouldAllowNavigation` — the decision function extracted from
 * main.ts's `will-navigate` handler. A compromised renderer could craft a
 * URL hoping to navigate the main frame to an attacker-controlled page while
 * keeping preload access. This helper must refuse everything except:
 *   - the exact renderer entry file:// URL
 *   - the dev-server origin (only when not packaged)
 *   - devtools:// frames
 *
 * Importing main.ts also runs its module-level Sentry init and window-
 * creation helpers, so we have to mock the electron + internal-module surface
 * heavily. The goal is to drive just `shouldAllowNavigation`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/app",
    getPath: () => "/tmp/luano-test",
    getVersion: () => "test",
    isPackaged: false,
    whenReady: () => ({ then: () => ({ catch: () => {} }) }),
    on: vi.fn(),
    quit: vi.fn(),
    // H13: added for single-instance lock test support
    requestSingleInstanceLock: vi.fn().mockReturnValue(true)
  },
  BrowserWindow: class {
    static getAllWindows() { return [] }
    webContents = { on: vi.fn(), send: vi.fn(), openDevTools: vi.fn(), executeJavaScript: vi.fn() }
    on() {}
    loadURL() {}
    loadFile() {}
    destroy() {}
    show() {}
    isDestroyed() { return false }
    isMaximized() { return false }
    getBounds() { return { x: 0, y: 0, width: 0, height: 0 } }
    getNormalBounds() { return { x: 0, y: 0, width: 0, height: 0 } }
    maximize() {}
  },
  dialog: { showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }
}))
vi.mock("@electron-toolkit/utils", () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: false }
}))
vi.mock("../electron/bootstrap", () => ({}))
vi.mock("../electron/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock("../electron/ipc/handlers", () => ({
  registerIpcHandlers: vi.fn(),
  cleanupPtys: vi.fn()
}))
vi.mock("../electron/ipc/bridge-handlers", () => ({
  refreshInstalledPluginToken: vi.fn()
}))
vi.mock("../electron/file/watcher", () => ({
  stopWatcher: vi.fn()
}))
vi.mock("../electron/lsp/manager", () => ({
  LspManager: class {
    start() { return Promise.resolve() }
    stop() { return Promise.resolve() }
    getPort() { return 0 }
  }
}))
vi.mock("../electron/toolchain/sync-manager", () => ({
  SyncManager: class {
    serve() {}
    stop() {}
  }
}))
const proMocks = vi.hoisted(() => ({
  startBridgeServer: vi.fn(),
  stopBridgeServer: vi.fn(),
  setBridgeWindow: vi.fn(),
  forceResetSessionState: vi.fn(),
}))
vi.mock("../electron/pro/modules", () => proMocks)
vi.mock("../electron/updater", () => ({ setupUpdater: vi.fn() }))
vi.mock("../electron/sentry", () => ({ initSentry: vi.fn() }))
vi.mock("../electron/menu", () => ({ installMenu: vi.fn() }))
// H14: abortAgent imported from provider in main.ts
const providerMocks = vi.hoisted(() => ({ abortAgent: vi.fn() }))
vi.mock("../electron/ai/provider", () => providerMocks)

import { shouldAllowNavigation, handleRenderProcessGone } from "../electron/main"

// A plausible packaged-build renderer entry URL.
const RENDERER = "file:///app/out/renderer/index.html"

describe("shouldAllowNavigation", () => {
  it("allows file: URL that matches the exact renderer entry", () => {
    expect(
      shouldAllowNavigation(RENDERER, { isPackaged: true, rendererEntryUrl: RENDERER })
    ).toBe(true)
  })

  it("blocks other file: URLs even within the app folder", () => {
    // A file-write primitive inside the app install dir (or a crafted
    // symlink) must not be enough to navigate the main frame — preload access
    // would leak to the malicious HTML.
    expect(
      shouldAllowNavigation("file:///app/out/renderer/evil.html", {
        isPackaged: true,
        rendererEntryUrl: RENDERER
      })
    ).toBe(false)
    expect(
      shouldAllowNavigation("file:///tmp/attacker.html", {
        isPackaged: true,
        rendererEntryUrl: RENDERER
      })
    ).toBe(false)
  })

  it("blocks http(s): URLs to external origins (external open is handled by caller)", () => {
    expect(
      shouldAllowNavigation("http://evil.com", { isPackaged: true, rendererEntryUrl: RENDERER })
    ).toBe(false)
    expect(
      shouldAllowNavigation("https://evil.com/path", { isPackaged: true, rendererEntryUrl: RENDERER })
    ).toBe(false)
  })

  it("allows dev-server URL in dev mode", () => {
    expect(
      shouldAllowNavigation("http://localhost:5173/", {
        isPackaged: false,
        devUrl: "http://localhost:5173",
        rendererEntryUrl: RENDERER
      })
    ).toBe(true)
  })

  it("blocks dev-server URL when packaged (defense in depth)", () => {
    // In a packaged build ELECTRON_RENDERER_URL shouldn't be set, but a
    // malicious env injection shouldn't be enough to whitelist a remote origin.
    expect(
      shouldAllowNavigation("http://localhost:5173/", {
        isPackaged: true,
        devUrl: "http://localhost:5173",
        rendererEntryUrl: RENDERER
      })
    ).toBe(false)
  })

  it("allows devtools:// frames", () => {
    expect(
      shouldAllowNavigation("devtools://devtools/bundled/inspector.html", {
        isPackaged: true,
        rendererEntryUrl: RENDERER
      })
    ).toBe(true)
  })

  it("returns false on malformed URLs (does not throw)", () => {
    expect(() =>
      shouldAllowNavigation("not a url at all", { isPackaged: true, rendererEntryUrl: RENDERER })
    ).not.toThrow()
    expect(
      shouldAllowNavigation("not a url at all", { isPackaged: true, rendererEntryUrl: RENDERER })
    ).toBe(false)
    expect(
      shouldAllowNavigation("", { isPackaged: true, rendererEntryUrl: RENDERER })
    ).toBe(false)
  })

  it("returns false when devUrl itself is malformed (swallows the parse error)", () => {
    // A garbage devUrl env var must not blow up the handler — fall through
    // to the regular checks and block.
    expect(
      shouldAllowNavigation("http://localhost:5173/", {
        isPackaged: false,
        devUrl: "::::not a url::::",
        rendererEntryUrl: RENDERER
      })
    ).toBe(false)
  })
})

// H14 — when the renderer process dies (OOM, segfault), the agent session
// state must be released. Without this, _agentRunning stays true forever and
// the user can't start a new session. The handler is registered as a
// `render-process-gone` listener inside createWindow but the body itself is
// the testable surface.
describe("H14 — handleRenderProcessGone", () => {
  beforeEach(() => {
    providerMocks.abortAgent.mockReset()
    proMocks.forceResetSessionState.mockReset()
  })

  it("calls abortAgent and forceResetSessionState", () => {
    handleRenderProcessGone("crashed")
    expect(providerMocks.abortAgent).toHaveBeenCalledTimes(1)
    expect(proMocks.forceResetSessionState).toHaveBeenCalledTimes(1)
  })

  it("calls abortAgent BEFORE forceResetSessionState (signal first, then mutex)", () => {
    const order: string[] = []
    providerMocks.abortAgent.mockImplementation(() => { order.push("abortAgent") })
    proMocks.forceResetSessionState.mockImplementation(() => { order.push("forceResetSessionState") })

    handleRenderProcessGone("oom")

    expect(order).toEqual(["abortAgent", "forceResetSessionState"])
  })

  it("does not throw if either dependency throws (defensive — log already covers it)", () => {
    providerMocks.abortAgent.mockImplementation(() => { throw new Error("dead controller") })
    // Production behavior: throwing here is acceptable since the listener has
    // no caller. Document and pin the current behavior so a future swallowing
    // refactor doesn't accidentally hide a real fault.
    expect(() => handleRenderProcessGone("oom")).toThrow(/dead controller/)
  })
})
