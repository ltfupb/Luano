import { describe, it, expect, vi } from "vitest"

// Mock electron's app before the module loads — rag.ts calls app.getAppPath().
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test", getAppPath: () => "/tmp/luano-test" }
}))

// Force getDb() to return null so we test the preprocessing / fallback logic
// without shipping the docs DB into the test environment.
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs")
  return { ...actual, existsSync: vi.fn().mockReturnValue(false) }
})

import { preprocessQuery, searchDocs } from "../electron/ai/rag"

describe("preprocessQuery", () => {
  it("strips stop words and lowercases the rest", () => {
    const { tokens } = preprocessQuery("how do I spawn an enemy character")
    expect(tokens).toEqual(expect.arrayContaining(["spawn", "enemy", "character"]))
    expect(tokens).not.toContain("how")
    expect(tokens).not.toContain("do")
    expect(tokens).not.toContain("i")
    expect(tokens).not.toContain("an")
  })

  it("extracts Roblox-shaped CamelCase identifiers", () => {
    const { identifiers } = preprocessQuery("how do I use GetService and PlayerAdded")
    expect(identifiers).toEqual(expect.arrayContaining(["getservice", "playeradded"]))
  })

  it("extracts dotted API paths like game.Workspace.Camera", () => {
    const { identifiers } = preprocessQuery("set game.Workspace.CurrentCamera")
    expect(identifiers).toContain("game.workspace.currentcamera")
  })

  it("dedupes identifiers across the query", () => {
    const { identifiers } = preprocessQuery("GetService GetService GetService")
    expect(identifiers).toEqual(["getservice"])
  })

  it("does not double-count an identifier in the token list", () => {
    const { tokens, identifiers } = preprocessQuery("GetService is how you fetch services")
    expect(identifiers).toContain("getservice")
    // identifier is stripped from tokens to avoid weighting it twice
    expect(tokens).not.toContain("getservice")
  })

  it("drops 1-char tokens (noise)", () => {
    const { tokens } = preprocessQuery("a b c spawn")
    expect(tokens).toEqual(["spawn"])
  })

  it("returns empty arrays for whitespace-only input", () => {
    const { tokens, identifiers } = preprocessQuery("   \n\t  ")
    expect(tokens).toEqual([])
    expect(identifiers).toEqual([])
  })

  it("returns empty arrays for an all-stop-word query", () => {
    const { tokens, identifiers } = preprocessQuery("how do I")
    expect(tokens).toEqual([])
    expect(identifiers).toEqual([])
  })

  it("normalizes punctuation to spaces before tokenizing", () => {
    const { tokens } = preprocessQuery("spawn! enemy? character.")
    expect(tokens).toEqual(expect.arrayContaining(["spawn", "enemy", "character"]))
  })

  it("ignores identifiers that are fully lowercase words — they go to tokens", () => {
    const { tokens, identifiers } = preprocessQuery("workspace character")
    // "workspace" alone is lowercase, not an identifier
    expect(identifiers).toEqual([])
    expect(tokens).toEqual(expect.arrayContaining(["workspace", "character"]))
  })
})

describe("searchDocs (no DB)", () => {
  it("returns empty array for empty query without crashing", () => {
    expect(searchDocs("")).toEqual([])
    expect(searchDocs("   ")).toEqual([])
  })

  it("returns empty array for an all-stop-word query", () => {
    // Previously this would fall through to FTS with empty tokens and then
    // the LIKE fallback with "%%" would return random docs. Guard it.
    expect(searchDocs("how do I")).toEqual([])
  })

  it("returns empty array when globalTypes + DB both miss", () => {
    // Obscure query, no docs DB in test env, no globalTypes match.
    expect(searchDocs("xyzzy_does_not_exist_anywhere")).toEqual([])
  })
})
