import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

export type AppTheme = "dark" | "tokyo-night"

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
  provider: string
  model: string
  autoSave: boolean
  autoSaveDelay: number
  fontSize: number
  recentProjects: RecentProject[]
  setLanguage: (lang: string) => void
  setTheme: (theme: AppTheme) => void
  setApiKey: (key: string) => void
  setOpenAIKey: (key: string) => void
  setProvider: (provider: string) => void
  setModel: (model: string) => void
  setAutoSave: (enabled: boolean) => void
  setAutoSaveDelay: (ms: number) => void
  setFontSize: (size: number) => void
  addRecentProject: (path: string) => void
  removeRecentProject: (path: string) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      language: "en",
      theme: "tokyo-night" as AppTheme,
      apiKey: "",
      openaiKey: "",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      autoSave: true,
      autoSaveDelay: 1000,
      fontSize: 13,
      recentProjects: [],
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      setApiKey: (apiKey) => set({ apiKey }),
      setOpenAIKey: (openaiKey) => set({ openaiKey }),
      setProvider: (provider) => set({ provider }),
      setModel: (model) => set({ model }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setAutoSaveDelay: (autoSaveDelay) => set({ autoSaveDelay }),
      setFontSize: (fontSize) => set({ fontSize }),
      addRecentProject: (path) => {
        const name = path.split(/[/\\]/).pop() ?? path
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
        provider: state.provider,
        model: state.model,
        autoSave: state.autoSave,
        autoSaveDelay: state.autoSaveDelay,
        fontSize: state.fontSize,
        recentProjects: state.recentProjects
      })
    }
  )
)
