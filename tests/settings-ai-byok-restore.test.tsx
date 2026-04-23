/**
 * tests/settings-ai-byok-restore.test.tsx — BYOK restore logic in SettingsAI
 *
 * Covers the prevByokProvider persistence + fallback chain:
 *   BYOK(openai) → Managed → BYOK click restores openai
 *   Managed → BYOK click, no saved provider → falls back to anthropic
 *   Managed → BYOK click, saved=openai but no openai key → falls back to
 *     whichever provider has credentials
 */

import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { useSettingsStore } from "../src/stores/settingsStore"

void React

const mockApi = {
  aiSetProvider: vi.fn().mockResolvedValue({ success: true }),
  aiSetModel: vi.fn().mockResolvedValue({ success: true }),
  aiGetProviderModel: vi.fn(),
  aiGetLocalKey: vi.fn().mockResolvedValue(""),
  aiSetLocalEndpoint: vi.fn(),
  aiSetLocalKey: vi.fn(),
  aiSetLocalModel: vi.fn(),
  aiSetAdvisor: vi.fn(),
  aiSetThinkingEffort: vi.fn(),
  aiFetchLocalModels: vi.fn().mockResolvedValue([]),
  managedFetchUsage: vi.fn().mockResolvedValue(null),
  aiSetKey: vi.fn(),
  aiSetOpenAIKey: vi.fn(),
  aiSetGeminiKey: vi.fn(),
}

// @ts-expect-error partial mock
globalThis.window = globalThis.window ?? {}
// @ts-expect-error partial mock
window.api = mockApi

// Import after window.api is set
import { SettingsAI } from "../src/components/SettingsAI"

const resetStore = (overrides: Partial<ReturnType<typeof useSettingsStore.getState>> = {}) => {
  useSettingsStore.setState({
    language: "en",
    theme: "dark",
    apiKey: "",
    openaiKey: "",
    geminiKey: "",
    localEndpoint: "http://localhost:11434/v1",
    localModel: "",
    provider: "anthropic",
    prevByokProvider: "anthropic",
    model: "claude-sonnet-4-6",
    advisorEnabled: false,
    thinkingEffort: "medium",
    autoSave: true,
    autoSaveDelay: 1000,
    fontSize: 13,
    uiScale: 100,
    recentProjects: [],
    sidePanelWidth: 224,
    chatPanelWidth: 320,
    terminalHeight: 220,
    terminalOpen: false,
    rightPanelOpen: true,
    hasInitialized: true,
    ...overrides,
  } as never)
}

const models = { anthropic: [], openai: [], gemini: [], local: [] }

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
})

describe("BYOK → Managed transition persists prevByokProvider", () => {
  it("switching from openai to managed saves openai as prevByokProvider", async () => {
    resetStore({ apiKey: "sk-ant-xxx", openaiKey: "sk-proj-xxx", provider: "openai" })
    mockApi.aiGetProviderModel.mockResolvedValue({
      provider: "managed",
      model: "claude-sonnet-4-6",
    })
    render(<SettingsAI models={models} setModels={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: /managed \(pro\)/i }))

    await waitFor(() => {
      expect(mockApi.aiSetProvider).toHaveBeenCalledWith("managed")
    })
    expect(useSettingsStore.getState().prevByokProvider).toBe("openai")
  })

  it("switching from gemini to managed saves gemini", async () => {
    resetStore({ geminiKey: "AIza-xxx", provider: "gemini" })
    mockApi.aiGetProviderModel.mockResolvedValue({
      provider: "managed",
      model: "claude-sonnet-4-6",
    })
    render(<SettingsAI models={models} setModels={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /managed \(pro\)/i }))
    await waitFor(() => {
      expect(mockApi.aiSetProvider).toHaveBeenCalledWith("managed")
    })
    expect(useSettingsStore.getState().prevByokProvider).toBe("gemini")
  })

  it("managed → managed (no-op) does not overwrite prevByokProvider", async () => {
    resetStore({
      apiKey: "sk-ant-xxx",
      provider: "managed",
      prevByokProvider: "anthropic",
    })
    render(<SettingsAI models={models} setModels={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /managed \(pro\)/i }))
    // provider already managed, so handleSetProvider should return early
    expect(mockApi.aiSetProvider).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().prevByokProvider).toBe("anthropic")
  })
})

describe("BYOK click from Managed restores best provider", () => {
  it("restores prevByokProvider when it has credentials", async () => {
    resetStore({
      apiKey: "sk-ant-xxx",
      openaiKey: "sk-proj-xxx",
      provider: "managed",
      prevByokProvider: "openai",
    })
    mockApi.aiGetProviderModel.mockResolvedValue({
      provider: "openai",
      model: "gpt-4o",
    })
    render(<SettingsAI models={models} setModels={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /bring your own key/i }))
    await waitFor(() => {
      expect(mockApi.aiSetProvider).toHaveBeenCalledWith("openai")
    })
  })

  it("falls back to any provider with credentials when prevByokProvider has none", async () => {
    resetStore({
      apiKey: "",
      openaiKey: "sk-proj-xxx",
      geminiKey: "",
      provider: "managed",
      prevByokProvider: "anthropic",  // no anthropic key stored
    })
    mockApi.aiGetProviderModel.mockResolvedValue({
      provider: "openai",
      model: "gpt-4o",
    })
    render(<SettingsAI models={models} setModels={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /bring your own key/i }))
    await waitFor(() => {
      expect(mockApi.aiSetProvider).toHaveBeenCalledWith("openai")
    })
  })

  it("falls back to anthropic when no provider has credentials (shows key input)", async () => {
    resetStore({
      apiKey: "",
      openaiKey: "",
      geminiKey: "",
      provider: "managed",
      prevByokProvider: "gemini",
    })
    mockApi.aiGetProviderModel.mockResolvedValue({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    })
    render(<SettingsAI models={models} setModels={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /bring your own key/i }))
    await waitFor(() => {
      expect(mockApi.aiSetProvider).toHaveBeenCalledWith("anthropic")
    })
  })

  it("local is considered valid only when both endpoint and model are set", async () => {
    resetStore({
      apiKey: "",
      openaiKey: "",
      geminiKey: "",
      localEndpoint: "http://localhost:11434/v1",
      localModel: "",  // no explicit model — local not considered configured
      provider: "managed",
      prevByokProvider: "local",
    })
    mockApi.aiGetProviderModel.mockResolvedValue({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    })
    render(<SettingsAI models={models} setModels={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /bring your own key/i }))
    // local without model should not be chosen → falls through to anthropic
    await waitFor(() => {
      expect(mockApi.aiSetProvider).toHaveBeenCalledWith("anthropic")
    })
  })

  it("local IS chosen when both endpoint and model are set", async () => {
    resetStore({
      apiKey: "",
      openaiKey: "",
      geminiKey: "",
      localEndpoint: "http://localhost:11434/v1",
      localModel: "llama3",
      provider: "managed",
      prevByokProvider: "local",
    })
    mockApi.aiGetProviderModel.mockResolvedValue({
      provider: "local",
      model: "llama3",
    })
    render(<SettingsAI models={models} setModels={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /bring your own key/i }))
    await waitFor(() => {
      expect(mockApi.aiSetProvider).toHaveBeenCalledWith("local")
    })
  })
})
