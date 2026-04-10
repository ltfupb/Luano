import { describe, it, expect, vi } from "vitest"

// Mock electron and sidecar before importing
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock("../electron/sidecar", () => ({
  getUserBinDir: () => "/tmp/luano-test/binaries",
  isBinaryAvailable: () => false
}))

import { getDownloadStatus } from "../electron/toolchain/downloader"

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
})
