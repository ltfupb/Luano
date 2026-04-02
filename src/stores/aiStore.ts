import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  streaming?: boolean
}

interface AIStore {
  messages: ChatMessage[]
  isStreaming: boolean
  globalSummary: string
  planMode: boolean
  autoAccept: boolean
  chatHistory: Record<string, ChatMessage[]>
  sessionHandoff: string

  addMessage: (msg: Omit<ChatMessage, "id">) => string
  updateMessage: (id: string, content: string, streaming?: boolean) => void
  setStreaming: (v: boolean) => void
  setGlobalSummary: (s: string) => void
  clearMessages: () => void
  setPlanMode: (v: boolean) => void
  setAutoAccept: (v: boolean) => void
  saveProjectChat: (projectPath: string) => void
  loadProjectChat: (projectPath: string) => void
  startNewSession: (projectPath?: string) => void
}

export const useAIStore = create<AIStore>()(
  persist(
    (set, get) => ({
      messages: [],
      isStreaming: false,
      globalSummary: "",
      planMode: false,
      autoAccept: false,
      chatHistory: {},
      sessionHandoff: "",

      addMessage: (msg) => {
        const id = `${Date.now()}-${Math.random()}`
        set({ messages: [...get().messages, { ...msg, id }] })
        return id
      },

      updateMessage: (id, content, streaming) =>
        set({
          messages: get().messages.map((m) =>
            m.id === id ? { ...m, content, streaming: streaming ?? m.streaming } : m
          )
        }),

      setStreaming: (v) => set({ isStreaming: v }),
      setGlobalSummary: (s) => set({ globalSummary: s }),
      clearMessages: () => set({ messages: [] }),
      setPlanMode: (v) => set({ planMode: v }),
      setAutoAccept: (v) => set({ autoAccept: v }),

      saveProjectChat: (projectPath) => {
        const { messages, chatHistory } = get()
        if (messages.length === 0) return
        // Strip streaming flags, keep last 100 messages to cap localStorage usage
        const clean = messages.slice(-100).map(({ streaming: _, ...m }) => m)
        set({ chatHistory: { ...chatHistory, [projectPath]: clean } })
      },

      loadProjectChat: (projectPath) => {
        const saved = get().chatHistory[projectPath]
        set({ messages: saved ?? [] })
      },

      startNewSession: (projectPath) => {
        const { messages } = get()
        // Save current chat if project path exists
        if (projectPath && messages.length > 0) {
          const clean = messages.slice(-100).map(({ streaming: _, ...m }) => m)
          set((s) => ({ chatHistory: { ...s.chatHistory, [projectPath]: clean } }))
        }
        // Build handoff from last assistant messages (brief summary context)
        const assistantMsgs = messages.filter((m) => m.role === "assistant" && !m.streaming)
        const lastAssistant = assistantMsgs.slice(-2).map((m) => m.content).join("\n---\n")
        const userMsgs = messages.filter((m) => m.role === "user")
        const lastUserTopics = userMsgs.slice(-3).map((m) => m.content.slice(0, 100)).join("; ")
        const handoff = lastAssistant
          ? `[Previous session context]\nUser topics: ${lastUserTopics}\nLast responses:\n${lastAssistant.slice(0, 800)}`
          : ""
        set({ messages: [], sessionHandoff: handoff })
      }
    }),
    {
      name: "luano-ai",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        chatHistory: state.chatHistory
      })
    }
  )
)
