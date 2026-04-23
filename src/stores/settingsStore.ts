import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { getFileName } from "../lib/utils"

export type AppTheme = "dark" | "light" | "tokyo-night"

/** Extended thinking / reasoning effort, mirroring Claude Code's `/effort` levels. */
export type ThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max"

export interface RecentProject {
  path: string
  name: string
  openedAt: number
}

interface SettingsStore {
  language: string
  theme: AppTheme
  apiKey: string
  openaiKey: string
  geminiKey: string
  localEndpoint: string
  localModel: string
  provider: string
  prevByokProvider: string
  model: string
  advisorEnabled: boolean
  autoSave: boolean
  autoSaveDelay: number
  fontSize: number
  uiScale: number
  recentProjects: RecentProject[]
  // Layout persistence
  sidePanelWidth: number
  chatPanelWidth: number
  terminalHeight: number
  terminalOpen: boolean
  rightPanelOpen: boolean
  /** true after the very first app launch — used to auto-detect system theme once. */
  hasInitialized: boolean
  thinkingEffort: ThinkingEffort
  setLanguage: (lang: string) => void
  setTheme: (theme: AppTheme) => void
  setApiKey: (key: string) => void
  setOpenAIKey: (key: string) => void
  setGeminiKey: (key: string) => void
  setLocalEndpoint: (endpoint: string) => void
  setLocalModel: (model: string) => void
  setProvider: (provider: string) => void
  setPrevByokProvider: (provider: string) => void
  setModel: (model: string) => void
  setAdvisorEnabled: (enabled: boolean) => void
  setAutoSave: (enabled: boolean) => void
  setAutoSaveDelay: (ms: number) => void
  setFontSize: (size: number) => void
  setUiScale: (scale: number) => void
  setSidePanelWidth: (w: number) => void
  setChatPanelWidth: (w: number) => void
  setTerminalHeight: (h: number) => void
  setTerminalOpen: (open: boolean) => void
  setRightPanelOpen: (open: boolean) => void
  setHasInitialized: (v: boolean) => void
  setThinkingEffort: (e: ThinkingEffort) => void
  addRecentProject: (path: string) => void
  removeRecentProject: (path: string) => void
}

/**
 * On app boot, pull the "is key set" signal from the main process (which stores
 * keys encrypted via safeStorage). The main process returns `"***set***"` or
 * `null`; the renderer only ever sees the marker, never the raw key.
 */
export async function hydrateKeyStatus(): Promise<void> {
  const api = (window as { api?: Window["api"] }).api
  if (!api) return
  const [a, o, g] = await Promise.all([
    api.aiGetKey().catch(() => null),
    api.aiGetOpenAIKey().catch(() => null),
    api.aiGetGeminiKey().catch(() => null),
  ])
  useSettingsStore.setState({
    apiKey: a ?? "",
    openaiKey: o ?? "",
    geminiKey: g ?? "",
  })
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      language: "en",
      theme: "dark" as AppTheme,
      apiKey: "",
      openaiKey: "",
      geminiKey: "",
      localEndpoint: "http://localhost:11434/v1",
      localModel: "",
      provider: "anthropic",
      prevByokProvider: "anthropic",
      model: "claude-sonnet-4-6",
      advisorEnabled: false,
      autoSave: true,
      autoSaveDelay: 1000,
      fontSize: 14,
      uiScale: 100,
      recentProjects: [],
      sidePanelWidth: 224,
      chatPanelWidth: 360,
      terminalHeight: 220,
      terminalOpen: false,
      rightPanelOpen: true,
      hasInitialized: false,
      thinkingEffort: "medium" as ThinkingEffort,
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      setApiKey: (apiKey) => set({ apiKey }),
      setOpenAIKey: (openaiKey) => set({ openaiKey }),
      setGeminiKey: (geminiKey) => set({ geminiKey }),
      setLocalEndpoint: (localEndpoint) => set({ localEndpoint }),
      setLocalModel: (localModel) => set({ localModel }),
      setProvider: (provider) => set({ provider }),
      setPrevByokProvider: (prevByokProvider) => set({ prevByokProvider }),
      setModel: (model) => set({ model }),
      setAdvisorEnabled: (advisorEnabled) => set({ advisorEnabled }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setAutoSaveDelay: (autoSaveDelay) => set({ autoSaveDelay }),
      setFontSize: (fontSize) => set({ fontSize }),
      setUiScale: (uiScale) => set({ uiScale }),
      setSidePanelWidth: (sidePanelWidth) => set({ sidePanelWidth }),
      setChatPanelWidth: (chatPanelWidth) => set({ chatPanelWidth }),
      setTerminalHeight: (terminalHeight) => set({ terminalHeight }),
      setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
      setHasInitialized: (hasInitialized) => set({ hasInitialized }),
      setThinkingEffort: (thinkingEffort) => set({ thinkingEffort }),
      addRecentProject: (path) => {
        const name = getFileName(path)
        const existing = get().recentProjects.filter((p) => p.path !== path)
        set({ recentProjects: [{ path, name, openedAt: Date.now() }, ...existing].slice(0, 10) })
      },
      removeRecentProject: (path) => {
        set({ recentProjects: get().recentProjects.filter((p) => p.path !== path) })
      }
    }),
    {
      name: "luano-settings",
      storage: createJSONStorage(() => localStorage),
      // API keys are intentionally NOT persisted here. The main process stores
      // them encrypted via safeStorage (OS keychain). On boot, hydrateKeyStatus()
      // reads back a "***set***" marker so UI booleans work. Persisting the raw
      // key in localStorage would leak them to any renderer-side XSS or anyone
      // with filesystem access.
      version: 1,
      migrate: (state) => {
        if (!state || typeof state !== "object") return state
        const s = state as Record<string, unknown>
        // v1: strip any previously-persisted plaintext API keys. Main process
        // still has the encrypted copy — the boot hydration will repopulate
        // the in-memory markers.
        delete s.apiKey
        delete s.openaiKey
        delete s.geminiKey
        return s
      },
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
        localEndpoint: state.localEndpoint,
        localModel: state.localModel,
        provider: state.provider,
        prevByokProvider: state.prevByokProvider,
        model: state.model,
        advisorEnabled: state.advisorEnabled,
        autoSave: state.autoSave,
        autoSaveDelay: state.autoSaveDelay,
        fontSize: state.fontSize,
        uiScale: state.uiScale,
        recentProjects: state.recentProjects,
        sidePanelWidth: state.sidePanelWidth,
        chatPanelWidth: state.chatPanelWidth,
        terminalHeight: state.terminalHeight,
        terminalOpen: state.terminalOpen,
        rightPanelOpen: state.rightPanelOpen,
        hasInitialized: state.hasInitialized,
        thinkingEffort: state.thinkingEffort
      })
    }
  )
)
