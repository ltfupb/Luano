/**
 * tests/updater.test.ts — setupUpdater IPC install gate.
 *
 * Covers:
 *   - updater:install with status='idle' → {success:false, error:/no update/}
 *   - updater:install with status='downloaded' → autoUpdater.quitAndInstall called
 *   - updater:install with status='downloading' → {success:false, error}
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {}
  const ipcMain = {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers[channel] = fn
    }),
  }
  // Minimal inline EventEmitter substitute (can't import from "events" in a
  // hoisted block — it runs before any module imports resolve).
  type Listener = (...args: unknown[]) => void
  const listeners = new Map<string, Listener[]>()
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    // H8: present here so setupUpdater can flip it on. Default false to prove
    // the test asserts the actual write rather than a pre-existing default.
    verifyUpdateCodeSignature: false,
    checkForUpdates: vi.fn().mockResolvedValue({ updateInfo: { version: "0.9.1" } }),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
    on(event: string, fn: Listener) {
      const arr = listeners.get(event) ?? []
      arr.push(fn)
      listeners.set(event, arr)
    },
    emit(event: string, ...args: unknown[]) {
      (listeners.get(event) ?? []).forEach((fn) => fn(...args))
    },
    removeAllListeners() {
      listeners.clear()
    },
  }
  return { handlers, ipcMain, autoUpdater }
})

vi.mock("electron", () => ({
  ipcMain: h.ipcMain,
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => "/tmp/luano-test" },
}))

vi.mock("electron-updater", () => ({
  autoUpdater: h.autoUpdater,
}))

import { setupUpdater } from "../electron/updater"

beforeEach(() => {
  vi.clearAllMocks()
  // Reset handlers map each time because setupUpdater re-registers them
  for (const k of Object.keys(h.handlers)) delete h.handlers[k]
  // Remove any event listeners left from the prior test run
  h.autoUpdater.removeAllListeners()
  // Reset H8 toggle so each test sees the explicit setupUpdater() write.
  h.autoUpdater.verifyUpdateCodeSignature = false
})

describe("H8 — verifyUpdateCodeSignature", () => {
  it("setupUpdater enables verifyUpdateCodeSignature on the autoUpdater", () => {
    expect(h.autoUpdater.verifyUpdateCodeSignature).toBe(false)
    setupUpdater()
    expect(h.autoUpdater.verifyUpdateCodeSignature).toBe(true)
  })
})

describe("updater:check / updater:download rate limit", () => {
  it("rejects a second updater:check within 30s", async () => {
    setupUpdater()
    const check = h.handlers["updater:check"]
    const r1 = await check() as { success: boolean; error?: string }
    expect(r1.success).toBe(true)
    const r2 = await check() as { success: boolean; error?: string }
    expect(r2).toMatchObject({ success: false, error: expect.stringMatching(/rate limited/i) })
  })

  it("rejects a second updater:download within 30s", async () => {
    setupUpdater()
    const download = h.handlers["updater:download"]
    const r1 = await download() as { success: boolean }
    expect(r1.success).toBe(true)
    const r2 = await download() as { success: boolean; error?: string }
    expect(r2).toMatchObject({ success: false, error: expect.stringMatching(/rate limited/i) })
  })
})

describe("updater:install gate", () => {
  it("refuses when no update downloaded (initial state = idle)", async () => {
    setupUpdater()
    const install = h.handlers["updater:install"]
    expect(install).toBeDefined()

    const result = await install()
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/no update/i) })
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it("refuses when status is 'downloading'", async () => {
    setupUpdater()
    // Drive state to 'downloading' via the download-progress event
    h.autoUpdater.emit("download-progress", { percent: 42 })

    const result = await h.handlers["updater:install"]()
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/no update/i) })
    // Error should include the current status for debugging
    expect((result as { error: string }).error).toContain("downloading")
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it("calls quitAndInstall when status is 'downloaded'", async () => {
    setupUpdater()
    // Drive state to 'downloaded' via the update-downloaded event
    h.autoUpdater.emit("update-downloaded", { version: "0.9.1" })

    const result = await h.handlers["updater:install"]()
    expect(result).toMatchObject({ success: true })
    // isSilent=true, isForceRunAfter=true
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
})
