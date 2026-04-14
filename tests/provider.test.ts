import { describe, it, expect, vi } from "vitest"

// Mock Electron modules before importing provider
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] }
}))

import {
  toCachedSystem, toCachedTools, MODELS, type Provider,
  isAdvisorAvailable, setAdvisorEnabled, setProvider, setModel,
  getProvider, getModel, getProviderAndModel,
  setApiKey, getApiKey, setOpenAIKey, getOpenAIKey,
  setGeminiKey, getGeminiKey, setLocalEndpoint, getLocalEndpoint,
  setLocalKey, getLocalKey, setLocalModel, getLocalModel,
  trackUsage, getTokenUsage, resetTokenUsage,
  abortAgent, _setActiveAbortController,
  getAdvisorEnabled
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

// ── getProvider / getModel / getProviderAndModel ──────────────────────────────

describe("getProvider / getModel", () => {
  it("getProvider returns stored provider", () => {
    setProvider("openai")
    expect(getProvider()).toBe("openai")
  })

  it("returns anthropic after setProvider('anthropic')", () => {
    setProvider("anthropic")
    expect(getProvider()).toBe("anthropic")
  })

  it("getModel returns first model for provider after setProvider", () => {
    setProvider("anthropic")
    expect(getModel()).toBe(MODELS.anthropic[0].id)
  })

  it("setModel overrides the stored model", () => {
    setProvider("openai")
    setModel("gpt-4-turbo")
    expect(getModel()).toBe("gpt-4-turbo")
  })

  it("getProviderAndModel returns both fields", () => {
    setProvider("gemini")
    const { provider, model } = getProviderAndModel()
    expect(provider).toBe("gemini")
    expect(model).toBe(MODELS.gemini[0].id)
  })
})

// ── Key setters / getters ─────────────────────────────────────────────────────

describe("API key setters and getters", () => {
  it("setApiKey / getApiKey roundtrip", () => {
    setApiKey("sk-test-anthropic")
    expect(getApiKey()).toBe("sk-test-anthropic")
  })

  it("setOpenAIKey / getOpenAIKey roundtrip", () => {
    setOpenAIKey("sk-test-openai")
    expect(getOpenAIKey()).toBe("sk-test-openai")
  })

  it("setGeminiKey / getGeminiKey roundtrip", () => {
    setGeminiKey("gmk-test")
    expect(getGeminiKey()).toBe("gmk-test")
  })

  it("setLocalEndpoint / getLocalEndpoint roundtrip", () => {
    setLocalEndpoint("http://localhost:1234/v1")
    expect(getLocalEndpoint()).toBe("http://localhost:1234/v1")
  })

  it("getLocalEndpoint returns default when not set", () => {
    // After setLocalEndpoint("") the store returns empty, so default kicks in
    setLocalEndpoint("")
    // Default is "http://localhost:11434/v1"
    expect(getLocalEndpoint()).toBe("http://localhost:11434/v1")
  })

  it("setLocalKey / getLocalKey roundtrip", () => {
    setLocalKey("mykey")
    expect(getLocalKey()).toBe("mykey")
  })

  it("setLocalModel / getLocalModel roundtrip", () => {
    setLocalModel("llama3")
    expect(getLocalModel()).toBe("llama3")
  })
})

// ── Token usage tracking ──────────────────────────────────────────────────────

describe("trackUsage / getTokenUsage / resetTokenUsage", () => {
  it("getTokenUsage starts at zero (after reset)", () => {
    resetTokenUsage()
    expect(getTokenUsage()).toEqual({ input: 0, output: 0, cacheRead: 0 })
  })

  it("trackUsage accumulates counts", () => {
    resetTokenUsage()
    trackUsage(100, 50)
    trackUsage(200, 30, 10)
    expect(getTokenUsage()).toEqual({ input: 300, output: 80, cacheRead: 10 })
  })

  it("resetTokenUsage zeroes all counters", () => {
    trackUsage(999, 999, 999)
    resetTokenUsage()
    expect(getTokenUsage()).toEqual({ input: 0, output: 0, cacheRead: 0 })
  })

  it("getTokenUsage returns a copy, not a reference", () => {
    resetTokenUsage()
    trackUsage(10, 5)
    const a = getTokenUsage()
    trackUsage(10, 5)
    expect(a.input).toBe(10) // original snapshot unchanged
  })
})

// ── abortAgent ────────────────────────────────────────────────────────────────

describe("abortAgent", () => {
  it("calls abort() on the active controller", () => {
    const ctrl = new AbortController()
    const spy = vi.spyOn(ctrl, "abort")
    _setActiveAbortController(ctrl)
    abortAgent()
    expect(spy).toHaveBeenCalled()
  })

  it("is safe to call when no active controller", () => {
    _setActiveAbortController(null)
    expect(() => abortAgent()).not.toThrow()
  })
})

// ── getAdvisorEnabled ─────────────────────────────────────────────────────────

describe("getAdvisorEnabled", () => {
  it("returns false after setAdvisorEnabled(false)", () => {
    setAdvisorEnabled(false)
    expect(getAdvisorEnabled()).toBe(false)
  })

  it("returns true after setAdvisorEnabled(true)", () => {
    setAdvisorEnabled(true)
    expect(getAdvisorEnabled()).toBe(true)
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
