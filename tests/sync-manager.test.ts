/**
 * tests/sync-manager.test.ts — Unit tests for electron/toolchain/sync-manager.ts
 *
 * Tests SyncManager delegation:
 *   - serve() with rojo tool → delegates to RojoManager
 *   - serve() with argon tool → delegates to ArgonManager
 *   - serve() when binary not available → throws
 *   - stop() calls both managers
 *   - getStatus() / getPort() delegate to the active manager
 *   - tool switch: serve rojo then argon → both managers stopped, argon takes over
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockRojoServe = vi.fn()
  const mockRojoStop = vi.fn()
  const mockRojoGetStatus = vi.fn().mockReturnValue("stopped")
  const mockRojoGetPort = vi.fn().mockReturnValue(null)

  const mockArgonServe = vi.fn()
  const mockArgonStop = vi.fn()
  const mockArgonGetStatus = vi.fn().mockReturnValue("stopped")
  const mockArgonGetPort = vi.fn().mockReturnValue(null)

  const MockRojoManager = vi.fn().mockImplementation(() => ({
    serve: mockRojoServe,
    stop: mockRojoStop,
    getStatus: mockRojoGetStatus,
    getPort: mockRojoGetPort
  }))

  const MockArgonManager = vi.fn().mockImplementation(() => ({
    serve: mockArgonServe,
    stop: mockArgonStop,
    getStatus: mockArgonGetStatus,
    getPort: mockArgonGetPort
  }))

  const mockGetActiveTool = vi.fn().mockReturnValue("rojo")
  const mockIsBinaryAvailable = vi.fn().mockReturnValue(true)

  return {
    mockRojoServe, mockRojoStop, mockRojoGetStatus, mockRojoGetPort,
    mockArgonServe, mockArgonStop, mockArgonGetStatus, mockArgonGetPort,
    MockRojoManager, MockArgonManager,
    mockGetActiveTool, mockIsBinaryAvailable
  }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("../electron/sidecar/rojo", () => ({
  RojoManager: h.MockRojoManager
}))

vi.mock("../electron/toolchain/argon-manager", () => ({
  ArgonManager: h.MockArgonManager
}))

vi.mock("../electron/toolchain/config", () => ({
  getActiveTool: h.mockGetActiveTool
}))

vi.mock("../electron/sidecar", () => ({
  isBinaryAvailable: h.mockIsBinaryAvailable
}))

// ── Import under test ─────────────────────────────────────────────────────────

import { SyncManager } from "../electron/toolchain/sync-manager"

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetActiveTool.mockReturnValue("rojo")
  h.mockIsBinaryAvailable.mockReturnValue(true)
  h.mockRojoGetStatus.mockReturnValue("stopped")
  h.mockRojoGetPort.mockReturnValue(null)
  h.mockArgonGetStatus.mockReturnValue("stopped")
  h.mockArgonGetPort.mockReturnValue(null)
})

describe("SyncManager.serve()", () => {
  it("delegates to RojoManager when active tool is rojo", () => {
    h.mockGetActiveTool.mockReturnValue("rojo")
    const mgr = new SyncManager()
    mgr.serve("/project")

    expect(h.mockRojoServe).toHaveBeenCalledWith("/project")
    expect(h.mockArgonServe).not.toHaveBeenCalled()
  })

  it("delegates to ArgonManager when active tool is argon", () => {
    h.mockGetActiveTool.mockReturnValue("argon")
    const mgr = new SyncManager()
    mgr.serve("/project")

    expect(h.mockArgonServe).toHaveBeenCalledWith("/project")
    expect(h.mockRojoServe).not.toHaveBeenCalled()
  })

  it("throws when the required binary is not installed", () => {
    h.mockGetActiveTool.mockReturnValue("rojo")
    h.mockIsBinaryAvailable.mockReturnValue(false)

    const mgr = new SyncManager()
    expect(() => mgr.serve("/project")).toThrow(/rojo binary not installed/)
  })

  it("stops both managers before starting (tool switch cleans up)", () => {
    const mgr = new SyncManager()
    mgr.serve("/project")

    // Both managers are stopped before the new serve
    expect(h.mockRojoStop).toHaveBeenCalled()
    expect(h.mockArgonStop).toHaveBeenCalled()
  })
})

describe("SyncManager.stop()", () => {
  it("stops both managers", () => {
    const mgr = new SyncManager()
    mgr.stop()

    expect(h.mockRojoStop).toHaveBeenCalled()
    expect(h.mockArgonStop).toHaveBeenCalled()
  })
})

describe("SyncManager.getStatus() and getPort()", () => {
  it("delegates getStatus to RojoManager when rojo is active", () => {
    h.mockGetActiveTool.mockReturnValue("rojo")
    h.mockRojoGetStatus.mockReturnValue("running")

    const mgr = new SyncManager()
    mgr.serve("/project")

    expect(mgr.getStatus()).toBe("running")
  })

  it("delegates getStatus to ArgonManager when argon is active", () => {
    h.mockGetActiveTool.mockReturnValue("argon")
    h.mockArgonGetStatus.mockReturnValue("running")

    const mgr = new SyncManager()
    mgr.serve("/project")

    expect(mgr.getStatus()).toBe("running")
  })

  it("delegates getPort to the active manager", () => {
    h.mockGetActiveTool.mockReturnValue("argon")
    h.mockArgonGetPort.mockReturnValue(8080)

    const mgr = new SyncManager()
    mgr.serve("/project")

    expect(mgr.getPort()).toBe(8080)
  })
})

describe("SyncManager.getActiveTool()", () => {
  it("returns 'rojo' before any serve()", () => {
    const mgr = new SyncManager()
    expect(mgr.getActiveTool()).toBe("rojo")
  })

  it("returns 'argon' after serving with argon tool", () => {
    h.mockGetActiveTool.mockReturnValue("argon")
    const mgr = new SyncManager()
    mgr.serve("/project")

    expect(mgr.getActiveTool()).toBe("argon")
  })
})
