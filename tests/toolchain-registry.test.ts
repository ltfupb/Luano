import { describe, it, expect } from "vitest"

import { TOOL_REGISTRY, CATEGORIES, getToolsForCategory, getDefaultToolId } from "../electron/toolchain/registry"

describe("TOOL_REGISTRY", () => {
  it("has all expected tools", () => {
    const ids = Object.keys(TOOL_REGISTRY)
    expect(ids).toContain("rojo")
    expect(ids).toContain("selene")
    expect(ids).toContain("stylua")
    expect(ids).toContain("luau-lsp")
    expect(ids).toContain("argon")
    expect(ids).toContain("wally")
    expect(ids).toContain("pesde")
    expect(ids).toContain("darklua")
  })

  it("every tool has valid releaseUrls for all platforms", () => {
    for (const tool of Object.values(TOOL_REGISTRY)) {
      expect(tool.releaseUrls.win).toMatch(/^https:\/\/github\.com\//)
      expect(tool.releaseUrls.mac).toMatch(/^https:\/\/github\.com\//)
      expect(tool.releaseUrls.linux).toMatch(/^https:\/\/github\.com\//)
    }
  })

  it("every tool has assetKeywords for all platforms", () => {
    for (const tool of Object.values(TOOL_REGISTRY)) {
      expect(tool.assetKeywords.win.length).toBeGreaterThan(0)
      expect(tool.assetKeywords.mac.length).toBeGreaterThan(0)
      expect(tool.assetKeywords.linux.length).toBeGreaterThan(0)
    }
  })

  it("bundled tools have known binary names", () => {
    const bundled = Object.values(TOOL_REGISTRY).filter(t => t.bundled)
    expect(bundled.length).toBeGreaterThanOrEqual(4)
    for (const tool of bundled) {
      expect(tool.binaryName).toBeTruthy()
    }
  })
})

describe("CATEGORIES", () => {
  it("has expected categories", () => {
    const ids = CATEGORIES.map(c => c.id)
    expect(ids).toContain("sync")
    expect(ids).toContain("linter")
    expect(ids).toContain("formatter")
    expect(ids).toContain("lsp")
    expect(ids).toContain("package-manager")
    expect(ids).toContain("processor")
  })
})

describe("getToolsForCategory", () => {
  it("returns sync tools", () => {
    const syncTools = getToolsForCategory("sync")
    const ids = syncTools.map(t => t.id)
    expect(ids).toContain("rojo")
    expect(ids).toContain("argon")
  })

  it("returns empty for unknown category", () => {
    expect(getToolsForCategory("nonexistent" as never)).toEqual([])
  })
})

describe("getDefaultToolId", () => {
  it("returns bundled tool for sync", () => {
    expect(getDefaultToolId("sync")).toBe("rojo")
  })

  it("returns null for category with no bundled tool", () => {
    expect(getDefaultToolId("package-manager")).toBeNull()
  })
})
