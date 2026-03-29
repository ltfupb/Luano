import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

interface SettingsStore {
  language: string
  apiKey: string
  openaiKey: string
  provider: string
  model: string
  setLanguage: (lang: string) => void
  setApiKey: (key: string) => void
  setOpenAIKey: (key: string) => void
  setProvider: (provider: string) => void
  setModel: (model: string) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      language: "en",
      apiKey: "",
      openaiKey: "",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      setLanguage: (language) => set({ language }),
      setApiKey: (apiKey) => set({ apiKey }),
      setOpenAIKey: (openaiKey) => set({ openaiKey }),
      setProvider: (provider) => set({ provider }),
      setModel: (model) => set({ model })
    }),
    {
      name: "luano-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        language: state.language,
        apiKey: state.apiKey,
        openaiKey: state.openaiKey,
        provider: state.provider,
        model: state.model
      })
    }
  )
)
