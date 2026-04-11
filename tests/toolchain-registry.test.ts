import { describe, it, expect } from "vitest"

import { TOOL_REGISTRY, CATEGORIES, getToolsForCategory, getDefaultToolId, getRecommendedToolIds } from "../electron/toolchain/registry"

describe("TOOL_REGISTRY", () => {
  it("has all expected tools", () => {
    const ids = Object.keys(TOOL_REGISTRY)
    expect(ids).toContain("rojo")
    expect(ids).toContain("selene")
    expect(ids).toContain("stylua")
    expect(ids).toContain("luau-lsp")
    expect(ids).toContain("argon")
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

  it("recommended tools have known binary names", () => {
    const recommended = Object.values(TOOL_REGISTRY).filter(t => t.recommended)
    expect(recommended.length).toBeGreaterThanOrEqual(4)
    for (const tool of recommended) {
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
  it("returns recommended tool for sync", () => {
    expect(getDefaultToolId("sync")).toBe("rojo")
  })
})

describe("getRecommendedToolIds", () => {
  it("returns all recommended tool ids", () => {
    const ids = getRecommendedToolIds()
    expect(ids).toContain("rojo")
    expect(ids).toContain("selene")
    expect(ids).toContain("stylua")
    expect(ids).toContain("luau-lsp")
    expect(ids.length).toBeGreaterThanOrEqual(4)
  })

  it("does not include non-recommended tools", () => {
    const ids = getRecommendedToolIds()
    expect(ids).not.toContain("argon")
  })
})
