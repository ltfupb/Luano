/**
 * tests/settings-store.test.ts — Unit tests for src/stores/settingsStore.ts
 *
 * Runs in jsdom (localStorage available).
 * Tests defaults, setters, and recentProjects management.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { useSettingsStore } from "../src/stores/settingsStore"

// ── Reset helpers ─────────────────────────────────────────────────────────────

const INITIAL: Parameters<typeof useSettingsStore.setState>[0] = {
  language: "en",
  theme: "dark",
  apiKey: "",
  openaiKey: "",
  geminiKey: "",
  localEndpoint: "http://localhost:11434/v1",
  localModel: "",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  advisorEnabled: false,
  autoSave: true,
  autoSaveDelay: 1000,
  fontSize: 13,
  uiScale: 100,
  recentProjects: [],
  sidePanelWidth: 224,
  chatPanelWidth: 320,
  terminalHeight: 220,
  terminalOpen: false,
  rightPanelOpen: true
}

beforeEach(() => {
  useSettingsStore.setState(INITIAL)
})

afterEach(() => {
  localStorage.clear()
})

// ── defaults ──────────────────────────────────────────────────────────────────

describe("defaults", () => {
  it("has correct default provider and model", () => {
    expect(useSettingsStore.getState().provider).toBe("anthropic")
    expect(useSettingsStore.getState().model).toBe("claude-sonnet-4-6")
  })

  it("has correct default layout values", () => {
    const s = useSettingsStore.getState()
    expect(s.sidePanelWidth).toBe(224)
    expect(s.chatPanelWidth).toBe(320)
    expect(s.terminalHeight).toBe(220)
    expect(s.terminalOpen).toBe(false)
    expect(s.rightPanelOpen).toBe(true)
  })

  it("has correct default theme", () => {
    expect(useSettingsStore.getState().theme).toBe("dark")
  })
})

// ── simple setters ────────────────────────────────────────────────────────────

describe("simple setters", () => {
  it("setLanguage", () => {
    useSettingsStore.getState().setLanguage("ko")
    expect(useSettingsStore.getState().language).toBe("ko")
  })

  it("setTheme", () => {
    useSettingsStore.getState().setTheme("tokyo-night")
    expect(useSettingsStore.getState().theme).toBe("tokyo-night")
  })

  it("setApiKey", () => {
    useSettingsStore.getState().setApiKey("sk-test")
    expect(useSettingsStore.getState().apiKey).toBe("sk-test")
  })

  it("setOpenAIKey", () => {
    useSettingsStore.getState().setOpenAIKey("openai-key")
    expect(useSettingsStore.getState().openaiKey).toBe("openai-key")
  })

  it("setGeminiKey", () => {
    useSettingsStore.getState().setGeminiKey("gemini-key")
    expect(useSettingsStore.getState().geminiKey).toBe("gemini-key")
  })

  it("setProvider and setModel", () => {
    useSettingsStore.getState().setProvider("openai")
    useSettingsStore.getState().setModel("gpt-4o")
    expect(useSettingsStore.getState().provider).toBe("openai")
    expect(useSettingsStore.getState().model).toBe("gpt-4o")
  })

  it("setAdvisorEnabled", () => {
    useSettingsStore.getState().setAdvisorEnabled(true)
    expect(useSettingsStore.getState().advisorEnabled).toBe(true)
  })

  it("setAutoSave and setAutoSaveDelay", () => {
    useSettingsStore.getState().setAutoSave(false)
    useSettingsStore.getState().setAutoSaveDelay(500)
    expect(useSettingsStore.getState().autoSave).toBe(false)
    expect(useSettingsStore.getState().autoSaveDelay).toBe(500)
  })

  it("setFontSize and setUiScale", () => {
    useSettingsStore.getState().setFontSize(16)
    useSettingsStore.getState().setUiScale(125)
    expect(useSettingsStore.getState().fontSize).toBe(16)
    expect(useSettingsStore.getState().uiScale).toBe(125)
  })

  it("layout setters", () => {
    useSettingsStore.getState().setSidePanelWidth(300)
    useSettingsStore.getState().setChatPanelWidth(400)
    useSettingsStore.getState().setTerminalHeight(180)
    useSettingsStore.getState().setTerminalOpen(true)
    useSettingsStore.getState().setRightPanelOpen(false)
    const s = useSettingsStore.getState()
    expect(s.sidePanelWidth).toBe(300)
    expect(s.chatPanelWidth).toBe(400)
    expect(s.terminalHeight).toBe(180)
    expect(s.terminalOpen).toBe(true)
    expect(s.rightPanelOpen).toBe(false)
  })
})

// ── addRecentProject ──────────────────────────────────────────────────────────

describe("addRecentProject", () => {
  it("adds a new project to the front of the list", () => {
    useSettingsStore.getState().addRecentProject("/projects/foo")
    const projects = useSettingsStore.getState().recentProjects
    expect(projects[0].path).toBe("/projects/foo")
    expect(projects[0].name).toBe("foo")
  })

  it("moves existing project to front instead of duplicating", () => {
    useSettingsStore.getState().addRecentProject("/projects/foo")
    useSettingsStore.getState().addRecentProject("/projects/bar")
    useSettingsStore.getState().addRecentProject("/projects/foo") // re-open foo
    const projects = useSettingsStore.getState().recentProjects
    expect(projects).toHaveLength(2)
    expect(projects[0].path).toBe("/projects/foo")
    expect(projects[1].path).toBe("/projects/bar")
  })

  it("limits list to 10 entries", () => {
    for (let i = 0; i < 12; i++) {
      useSettingsStore.getState().addRecentProject(`/projects/p${i}`)
    }
    expect(useSettingsStore.getState().recentProjects).toHaveLength(10)
  })

  it("extracts correct name from path with separators", () => {
    useSettingsStore.getState().addRecentProject("/home/user/my-project")
    expect(useSettingsStore.getState().recentProjects[0].name).toBe("my-project")
  })

  it("records openedAt timestamp", () => {
    const before = Date.now()
    useSettingsStore.getState().addRecentProject("/projects/ts-test")
    const after = Date.now()
    const { openedAt } = useSettingsStore.getState().recentProjects[0]
    expect(openedAt).toBeGreaterThanOrEqual(before)
    expect(openedAt).toBeLessThanOrEqual(after)
  })
})

// ── removeRecentProject ───────────────────────────────────────────────────────

describe("removeRecentProject", () => {
  it("removes the specified project from the list", () => {
    useSettingsStore.getState().addRecentProject("/projects/foo")
    useSettingsStore.getState().addRecentProject("/projects/bar")
    useSettingsStore.getState().removeRecentProject("/projects/foo")
    const projects = useSettingsStore.getState().recentProjects
    expect(projects).toHaveLength(1)
    expect(projects[0].path).toBe("/projects/bar")
  })

  it("is safe to call for a project that does not exist", () => {
    useSettingsStore.getState().addRecentProject("/projects/foo")
    expect(() => useSettingsStore.getState().removeRecentProject("/nonexistent")).not.toThrow()
    expect(useSettingsStore.getState().recentProjects).toHaveLength(1)
  })
})
