import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

export type ChatMode = "chat" | "agent" | "plan"

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "tool"
  content: string
  streaming?: boolean
  toolName?: string
  toolSuccess?: boolean
  /** Seconds spent thinking before this assistant message started streaming. Displayed as "Cogitated for X". */
  thinkingSeconds?: number
  /** Token counts for this single turn (computed as delta from session totals when the message ends). */
  inputTokens?: number
  outputTokens?: number
  cacheTokens?: number
}

export interface SessionEntry {
  id: string
  messages: ChatMessage[]
  createdAt: number
  preview: string
}

interface AIStore {
  messages: ChatMessage[]
  isStreaming: boolean
  globalSummary: string
  mode: ChatMode
  autoAccept: boolean
  sessions: Record<string, SessionEntry[]>
  activeSessionId: string | null
  sessionHandoff: string
  compressedContext: string

  addMessage: (msg: Omit<ChatMessage, "id">) => string
  updateMessage: (id: string, content: string, streaming?: boolean) => void
  setThinkingSeconds: (id: string, seconds: number) => void
  setMessageTokens: (id: string, tokens: { input: number; output: number; cache: number }) => void
  setStreaming: (v: boolean) => void
  setGlobalSummary: (s: string) => void
  clearMessages: () => void
  setMode: (m: ChatMode) => void
  setAutoAccept: (v: boolean) => void
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

/**
 * Tool-name migration for persisted sessions.
 *
 * Pre-v0.8.6 sessions stored toolName in snake_case (read_file, edit_file, …).
 * v0.8.6 renamed to CC-style PascalCase (Read, Edit, …). Without this map the
 * UI falls back to the raw string for old sessions — icons miss, labels drop
 * to "custom_tool" style display. Run on migrate to keep history readable.
 */
const TOOL_NAME_MIGRATION: Record<string, string> = {
  read_file: "Read",
  edit_file: "Edit",
  multi_edit: "MultiEdit",
  create_file: "Write",
  delete_file: "Delete",
  list_files: "Glob",
  grep_files: "Grep",
  lint_file: "Lint",
  format_file: "Format",
  type_check: "TypeCheck",
  patch_file: "Patch",
  search_docs: "SearchDocs",
  read_instance_tree: "ReadInstanceTree",
  get_runtime_logs: "RuntimeLogs",
  run_studio_script: "RunScript",
  set_property: "SetProperty",
  insert_model: "InsertModel",
  todo_write: "TodoWrite",
  wag_read: "WagRead",
  wag_search: "WagSearch",
  wag_update: "WagUpdate",
  ask_user: "AskUser"
  // `grep` intentionally preserved — old name and new name both "grep"/"Grep";
  // case-sensitive mapping below handles lowercase `grep` → `Grep`.
}

function migrateToolName(name: string | undefined): string | undefined {
  if (!name) return name
  if (name in TOOL_NAME_MIGRATION) return TOOL_NAME_MIGRATION[name]
  if (name === "grep") return "Grep"
  return name
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
      mode: "agent",
      autoAccept: false,
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

      setThinkingSeconds: (id, seconds) =>
        set({
          messages: get().messages.map((m) =>
            m.id === id ? { ...m, thinkingSeconds: seconds } : m
          )
        }),

      setMessageTokens: (id, tokens) =>
        set({
          messages: get().messages.map((m) =>
            m.id === id ? { ...m, inputTokens: tokens.input, outputTokens: tokens.output, cacheTokens: tokens.cache } : m
          )
        }),

      setStreaming: (v) => set({ isStreaming: v }),
      setGlobalSummary: (s) => set({ globalSummary: s }),
      clearMessages: () => set({ messages: [] }),
      setMode: (m) => set({ mode: m }),
      setAutoAccept: (v) => set({ autoAccept: v }),

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
        const projectSessions = get().sessions[projectPath] ?? []
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
        sessions: state.sessions
      }),
      version: 1,
      migrate: (persistedState, version) => {
        // v0 → v1: rename snake_case tool names to CC-style PascalCase.
        // Pre-migration data may arrive with undefined version (zustand on
        // older storage wrapper); `undefined < 1` is false, so default to 0
        // to keep the migration defensive against that case.
        if ((version ?? 0) < 1 && persistedState && typeof persistedState === "object") {
          const s = persistedState as { sessions?: Record<string, SessionEntry[]> }
          if (s.sessions) {
            for (const key of Object.keys(s.sessions)) {
              s.sessions[key] = s.sessions[key].map((entry) => ({
                ...entry,
                messages: entry.messages.map((m) => ({
                  ...m,
                  toolName: migrateToolName(m.toolName)
                }))
              }))
            }
          }
        }
        return persistedState as AIStore
      }
    }
  )
)
