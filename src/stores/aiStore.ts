import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  streaming?: boolean
}

export interface SessionEntry {
  id: string
  messages: ChatMessage[]
  createdAt: number
  preview: string
}

interface PendingReview {
  files: string[]
  messageId: string
}

interface AIStore {
  messages: ChatMessage[]
  isStreaming: boolean
  globalSummary: string
  planMode: boolean
  autoAccept: boolean
  pendingReview: PendingReview | null
  sessions: Record<string, SessionEntry[]>
  activeSessionId: string | null
  sessionHandoff: string
  compressedContext: string

  addMessage: (msg: Omit<ChatMessage, "id">) => string
  updateMessage: (id: string, content: string, streaming?: boolean) => void
  setStreaming: (v: boolean) => void
  setGlobalSummary: (s: string) => void
  clearMessages: () => void
  setPlanMode: (v: boolean) => void
  setAutoAccept: (v: boolean) => void
  setPendingReview: (v: PendingReview | null) => void
  saveProjectChat: (projectPath: string) => void
  loadProjectChat: (projectPath: string) => void
  startNewSession: (projectPath?: string) => void
  switchSession: (projectPath: string, sessionId: string) => void
  deleteSession: (projectPath: string, sessionId: string) => void
  getProjectSessions: (projectPath: string) => SessionEntry[]
  compressOldMessages: () => Promise<void>
}

function makeSessionId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function makePreview(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")
  return first?.content.slice(0, 80) ?? "Empty session"
}

export const useAIStore = create<AIStore>()(
  persist(
    (set, get) => ({
      messages: [],
      isStreaming: false,
      globalSummary: "",
      planMode: false,
      autoAccept: false,
      pendingReview: null,
      sessions: {},
      activeSessionId: null,
      sessionHandoff: "",
      compressedContext: "",

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
      setPendingReview: (v) => set({ pendingReview: v }),

      saveProjectChat: (projectPath) => {
        const { messages, sessions, activeSessionId } = get()
        if (messages.length === 0) return
        const clean = messages.slice(-100).map(({ streaming: _, ...m }) => m)
        const sid = activeSessionId ?? makeSessionId()
        const projectSessions = sessions[projectPath] ?? []
        const existing = projectSessions.findIndex((s) => s.id === sid)
        const entry: SessionEntry = {
          id: sid,
          messages: clean,
          createdAt: existing >= 0 ? projectSessions[existing].createdAt : Date.now(),
          preview: makePreview(clean)
        }
        const updated = existing >= 0
          ? projectSessions.map((s) => (s.id === sid ? entry : s))
          : [...projectSessions, entry]
        // Keep max 20 sessions per project
        const trimmed = updated.slice(-20)
        set({
          sessions: { ...sessions, [projectPath]: trimmed },
          activeSessionId: sid
        })
      },

      loadProjectChat: (projectPath) => {
        const { sessions } = get()
        const projectSessions = sessions[projectPath] ?? []
        // Migrate from old chatHistory format if needed
        const legacy = (get() as unknown as Record<string, unknown>).chatHistory as Record<string, ChatMessage[]> | undefined
        if (projectSessions.length === 0 && legacy?.[projectPath]?.length) {
          const msgs = legacy[projectPath]
          const sid = makeSessionId()
          const entry: SessionEntry = {
            id: sid,
            messages: msgs,
            createdAt: Date.now(),
            preview: makePreview(msgs)
          }
          set({
            messages: msgs,
            activeSessionId: sid,
            sessions: { ...sessions, [projectPath]: [entry] }
          })
          return
        }
        if (projectSessions.length > 0) {
          const latest = projectSessions[projectSessions.length - 1]
          set({ messages: latest.messages, activeSessionId: latest.id })
        } else {
          set({ messages: [], activeSessionId: null })
        }
      },

      compressOldMessages: async () => {
        const { messages, compressedContext } = get()
        if (messages.length < 20) return

        const nonStreaming = messages.filter((m) => !m.streaming)
        try {
          const tokenCount = await window.api.aiEstimateTokens(
            nonStreaming.map((m) => ({ role: m.role, content: m.content }))
          )
          if (tokenCount < 50000) return

          const splitIdx = Math.floor(nonStreaming.length / 2)
          const oldMessages = nonStreaming.slice(0, splitIdx)
          const recentMessages = messages.slice(messages.indexOf(nonStreaming[splitIdx]))

          const summary = await window.api.aiCompressMessages(
            oldMessages.map((m) => ({ role: m.role, content: m.content }))
          )

          const prevContext = compressedContext ? compressedContext + "\n---\n" : ""
          set({
            messages: recentMessages,
            compressedContext: prevContext + summary
          })
        } catch { /* silent — compression is best-effort */ }
      },

      startNewSession: (projectPath) => {
        const { messages } = get()
        if (projectPath && messages.length > 0) {
          get().saveProjectChat(projectPath)
        }
        const assistantMsgs = messages.filter((m) => m.role === "assistant" && !m.streaming)
        const lastAssistant = assistantMsgs.slice(-2).map((m) => m.content).join("\n---\n")
        const userMsgs = messages.filter((m) => m.role === "user")
        const lastUserTopics = userMsgs.slice(-3).map((m) => m.content.slice(0, 100)).join("; ")
        const handoff = lastAssistant
          ? `[Previous session context]\nUser topics: ${lastUserTopics}\nLast responses:\n${lastAssistant.slice(0, 800)}`
          : ""
        set({ messages: [], sessionHandoff: handoff, activeSessionId: null })
      },

      switchSession: (projectPath, sessionId) => {
        // Save current session first (even if activeSessionId is null — auto-save may not have fired yet)
        const { messages } = get()
        if (messages.length > 0) {
          get().saveProjectChat(projectPath)
        }
        // Re-read sessions after save
        const projectSessions = get().sessions[projectPath] ?? []
        const target = projectSessions.find((s) => s.id === sessionId)
        if (target) {
          set({
            messages: [...target.messages],
            activeSessionId: target.id,
            sessionHandoff: "",
            compressedContext: ""
          })
        }
      },

      deleteSession: (projectPath, sessionId) => {
        const { sessions, activeSessionId } = get()
        const projectSessions = sessions[projectPath] ?? []
        const filtered = projectSessions.filter((s) => s.id !== sessionId)
        const newSessions = { ...sessions, [projectPath]: filtered }
        if (activeSessionId === sessionId) {
          const latest = filtered[filtered.length - 1]
          set({
            sessions: newSessions,
            messages: latest?.messages ?? [],
            activeSessionId: latest?.id ?? null
          })
        } else {
          set({ sessions: newSessions })
        }
      },

      getProjectSessions: (projectPath) => {
        return get().sessions[projectPath] ?? []
      }
    }),
    {
      name: "luano-ai",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        // Keep chatHistory for backwards compat migration
        ...(((state as unknown as Record<string, unknown>).chatHistory) ? { chatHistory: (state as unknown as Record<string, unknown>).chatHistory } : {})
      })
    }
  )
)
