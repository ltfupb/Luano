import { describe, it, expect, vi } from "vitest"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockIsBinaryAvailable = vi.fn().mockReturnValue(false)
  return { mockIsBinaryAvailable }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock("../electron/sidecar", () => ({
  getUserBinDir: () => "/tmp/luano-test/binaries",
  isBinaryAvailable: h.mockIsBinaryAvailable
}))

vi.mock("../electron/store", () => ({
  store: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() }
}))

vi.mock("../electron/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// ── Import under test ─────────────────────────────────────────────────────────

import { getDownloadStatus, downloadTool } from "../electron/toolchain/downloader"

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getDownloadStatus", () => {
  it("returns not-installed for unknown tool", () => {
    expect(getDownloadStatus("nonexistent")).toBe("not-installed")
  })

  it("returns not-installed for tool that is not downloaded", () => {
    expect(getDownloadStatus("rojo")).toBe("not-installed")
  })

  it("returns not-installed for any known tool without binary", () => {
    expect(getDownloadStatus("argon")).toBe("not-installed")
    expect(getDownloadStatus("selene")).toBe("not-installed")
  })

  it("returns installed when binary is available", () => {
    h.mockIsBinaryAvailable.mockReturnValueOnce(true)
    expect(getDownloadStatus("rojo")).toBe("installed")
  })
})

describe("downloadTool — guard clauses", () => {
  it("returns failure for unknown tool ID", async () => {
    const result = await downloadTool("nonexistent_tool_xyz")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Unknown tool/)
  })

  it("returns success immediately when binary is already installed", async () => {
    h.mockIsBinaryAvailable.mockReturnValueOnce(true)
    const result = await downloadTool("rojo")
    expect(result.success).toBe(true)
  })
})
