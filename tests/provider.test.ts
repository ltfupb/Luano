import { describe, it, expect, vi } from "vitest"

// Mock Electron modules before importing provider
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] }
}))

import {
  toCachedSystem, toCachedTools, MODELS, type Provider,
  isAdvisorAvailable, setAdvisorEnabled, setProvider, setModel
} from "../electron/ai/provider"

describe("toCachedSystem", () => {
  it("wraps entire prompt with cache_control when no PROJECT CONTEXT marker", () => {
    const result = toCachedSystem("You are a Luau assistant.")
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe("You are a Luau assistant.")
    expect(result[0].cache_control).toEqual({ type: "ephemeral" })
  })

  it("splits at PROJECT CONTEXT marker", () => {
    const prompt = "Static rules here\nPROJECT CONTEXT:\nDynamic context here"
    const result = toCachedSystem(prompt)
    expect(result).toHaveLength(2)
    expect(result[0].text).toBe("Static rules here")
    expect(result[0].cache_control).toEqual({ type: "ephemeral" })
    expect(result[1].text).toContain("PROJECT CONTEXT:")
    expect(result[1].cache_control).toBeUndefined()
  })
})

describe("toCachedTools", () => {
  it("returns empty array for empty input", () => {
    expect(toCachedTools([])).toEqual([])
  })

  it("adds cache_control to last tool only", () => {
    const tools = [
      { name: "read_file", description: "Read a file" },
      { name: "write_file", description: "Write a file" },
      { name: "lint", description: "Lint a file" }
    ]
    const result = toCachedTools(tools)
    expect(result[0]).not.toHaveProperty("cache_control")
    expect(result[1]).not.toHaveProperty("cache_control")
    expect(result[2].cache_control).toEqual({ type: "ephemeral" })
  })

  it("does not mutate original tools", () => {
    const tools = [{ name: "test" }]
    const result = toCachedTools(tools)
    expect(tools[0]).not.toHaveProperty("cache_control")
    expect(result[0].cache_control).toEqual({ type: "ephemeral" })
  })
})

describe("MODELS", () => {
  it("has all four providers", () => {
    const providers: Provider[] = ["anthropic", "openai", "gemini", "local"]
    for (const p of providers) {
      expect(MODELS).toHaveProperty(p)
    }
  })

  it("anthropic has at least one model", () => {
    expect(MODELS.anthropic.length).toBeGreaterThanOrEqual(1)
    expect(MODELS.anthropic[0]).toHaveProperty("id")
    expect(MODELS.anthropic[0]).toHaveProperty("label")
  })

  it("gemini has at least one model", () => {
    expect(MODELS.gemini.length).toBeGreaterThanOrEqual(1)
    expect(MODELS.gemini[0].id).toMatch(/^gemini-/)
  })

  it("local has empty model list (dynamic)", () => {
    expect(MODELS.local).toEqual([])
  })
})

describe("isAdvisorAvailable", () => {
  it("returns true for Anthropic Sonnet with advisor enabled", () => {
    setProvider("anthropic")
    setModel("claude-sonnet-4-6")
    setAdvisorEnabled(true)
    expect(isAdvisorAvailable()).toBe(true)
  })

  it("returns false for Opus (advisor is the same model)", () => {
    setProvider("anthropic")
    setModel("claude-opus-4-6")
    setAdvisorEnabled(true)
    expect(isAdvisorAvailable()).toBe(false)
  })

  it("returns false when advisor disabled", () => {
    setProvider("anthropic")
    setModel("claude-sonnet-4-6")
    setAdvisorEnabled(false)
    expect(isAdvisorAvailable()).toBe(false)
  })

  it("returns false for non-Anthropic providers", () => {
    setProvider("openai")
    setModel("gpt-4o")
    setAdvisorEnabled(true)
    expect(isAdvisorAvailable()).toBe(false)
  })
})
