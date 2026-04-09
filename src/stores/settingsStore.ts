import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { getFileName } from "../lib/utils"

export type AppTheme = "dark" | "light" | "tokyo-night"

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
  model: string
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
  setLanguage: (lang: string) => void
  setTheme: (theme: AppTheme) => void
  setApiKey: (key: string) => void
  setOpenAIKey: (key: string) => void
  setGeminiKey: (key: string) => void
  setLocalEndpoint: (endpoint: string) => void
  setLocalModel: (model: string) => void
  setProvider: (provider: string) => void
  setModel: (model: string) => void
  setAutoSave: (enabled: boolean) => void
  setAutoSaveDelay: (ms: number) => void
  setFontSize: (size: number) => void
  setUiScale: (scale: number) => void
  setSidePanelWidth: (w: number) => void
  setChatPanelWidth: (w: number) => void
  setTerminalHeight: (h: number) => void
  setTerminalOpen: (open: boolean) => void
  setRightPanelOpen: (open: boolean) => void
  addRecentProject: (path: string) => void
  removeRecentProject: (path: string) => void
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
      model: "claude-sonnet-4-6",
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
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      setApiKey: (apiKey) => set({ apiKey }),
      setOpenAIKey: (openaiKey) => set({ openaiKey }),
      setGeminiKey: (geminiKey) => set({ geminiKey }),
      setLocalEndpoint: (localEndpoint) => set({ localEndpoint }),
      setLocalModel: (localModel) => set({ localModel }),
      setProvider: (provider) => set({ provider }),
      setModel: (model) => set({ model }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setAutoSaveDelay: (autoSaveDelay) => set({ autoSaveDelay }),
      setFontSize: (fontSize) => set({ fontSize }),
      setUiScale: (uiScale) => set({ uiScale }),
      setSidePanelWidth: (sidePanelWidth) => set({ sidePanelWidth }),
      setChatPanelWidth: (chatPanelWidth) => set({ chatPanelWidth }),
      setTerminalHeight: (terminalHeight) => set({ terminalHeight }),
      setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
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
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
        apiKey: state.apiKey,
        openaiKey: state.openaiKey,
        geminiKey: state.geminiKey,
        localEndpoint: state.localEndpoint,
        localModel: state.localModel,
        provider: state.provider,
        model: state.model,
        autoSave: state.autoSave,
        autoSaveDelay: state.autoSaveDelay,
        fontSize: state.fontSize,
        uiScale: state.uiScale,
        recentProjects: state.recentProjects,
        sidePanelWidth: state.sidePanelWidth,
        chatPanelWidth: state.chatPanelWidth,
        terminalHeight: state.terminalHeight,
        terminalOpen: state.terminalOpen,
        rightPanelOpen: state.rightPanelOpen
      })
    }
  )
)
