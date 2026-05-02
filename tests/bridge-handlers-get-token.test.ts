/**
 * tests/bridge-handlers-get-token.test.ts — H10 bridge:get-token confirmation
 *
 * `bridge:get-token` returns the raw bridge auth token. Without an explicit
 * user-confirmation dialog, a renderer XSS or malicious extension could
 * exfiltrate it silently and then forge bridge commands. The handler shows
 * a native dialog and only returns the token when the user clicks "Show".
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {}
  const mockShowMessageBox = vi.fn()
  const mockGetBridgeToken = vi.fn()
  const mockHasFeature = vi.fn()
  return { handlers, mockShowMessageBox, mockGetBridgeToken, mockHasFeature }
})

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      h.handlers[channel] = fn
    })
  },
  app: { getPath: () => "/tmp/luano-test" },
  dialog: { showMessageBox: h.mockShowMessageBox },
  BrowserWindow: {
    fromWebContents: () => null,
    getFocusedWindow: () => null,
    getAllWindows: () => [{ webContents: { id: 1 } }]
  }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("../electron/pro", () => ({ hasFeature: h.mockHasFeature }))

vi.mock("../electron/pro/modules", () => ({
  getBridgeToken: h.mockGetBridgeToken,
  getBridgeTree: vi.fn(),
  getBridgeLogs: vi.fn(),
  isBridgeConnected: vi.fn(),
  clearBridgeLogs: vi.fn(),
  queueScript: vi.fn(),
  consumeCommandResult: vi.fn()
}))

vi.mock("../electron/ipc/shared", () => ({
  PRO_REQUIRED: () => ({ success: false, error: "pro required" }),
  getCurrentProject: () => null
}))

vi.mock("../electron/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}))

import { registerBridgeHandlers } from "../electron/ipc/bridge-handlers"

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(h.handlers)) delete h.handlers[k]
  h.mockHasFeature.mockReturnValue(true)
  registerBridgeHandlers()
})

describe("H10 — bridge:get-token user-confirmation gate", () => {
  it("returns null when user clicks Cancel and does NOT read the token", async () => {
    h.mockShowMessageBox.mockResolvedValueOnce({ response: 1 }) // Cancel
    h.mockGetBridgeToken.mockReturnValue("super-secret-token")

    const handler = h.handlers["bridge:get-token"]
    const result = await handler({ sender: { id: 1 } })

    expect(result).toBeNull()
    expect(h.mockGetBridgeToken).not.toHaveBeenCalled()
    expect(h.mockShowMessageBox).toHaveBeenCalledTimes(1)
  })

  it("returns the token when user clicks Show", async () => {
    h.mockShowMessageBox.mockResolvedValueOnce({ response: 0 }) // Show
    h.mockGetBridgeToken.mockReturnValue("super-secret-token")

    const handler = h.handlers["bridge:get-token"]
    const result = await handler({ sender: { id: 1 } })

    expect(result).toBe("super-secret-token")
    expect(h.mockGetBridgeToken).toHaveBeenCalledTimes(1)
  })

  it("dialog defaults to Cancel (defaultId=1, cancelId=1)", async () => {
    h.mockShowMessageBox.mockResolvedValueOnce({ response: 1 })
    const handler = h.handlers["bridge:get-token"]
    await handler({ sender: { id: 1 } })

    const opts = h.mockShowMessageBox.mock.calls[0][1]
    expect(opts).toMatchObject({
      cancelId: 1,
      defaultId: 1,
      buttons: expect.arrayContaining(["Show Token", "Cancel"])
    })
  })

  it("returns PRO_REQUIRED when studio-bridge feature is gated off (no dialog)", async () => {
    h.mockHasFeature.mockReturnValue(false)
    const handler = h.handlers["bridge:get-token"]
    const result = await handler({ sender: { id: 1 } })

    expect(result).toMatchObject({ success: false, error: "pro required" })
    expect(h.mockShowMessageBox).not.toHaveBeenCalled()
    expect(h.mockGetBridgeToken).not.toHaveBeenCalled()
  })
})
