import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from "react"
import { useAIStore, ChatMessage } from "../stores/aiStore"
import { useProjectStore } from "../stores/projectStore"
import { useSettingsStore } from "../stores/settingsStore"
import { useT } from "../i18n/useT"
import { useIpcEvent } from "../hooks/useIpc"
import { BUILT_IN_SKILLS, mergeSkills, findSkills, expandSkill, Skill } from "./skills"
import { getFileName } from "../lib/utils"
import { AskUserCard } from "./AskUserCard"
import { EditPreviewCard } from "./EditPreviewCard"
import { ToolCallGroup } from "./ToolCallGroup"
import { MessageBubble, MessageFooter } from "./MessageBubble"
import { pickVerbPair, formatDuration } from "./ThinkingBubble"
import { toast } from "../components/Toast"
import { track, Events } from "../analytics"

interface ToolEvent {
  tool: string
  input: Record<string, unknown>
  output: string
  success: boolean
}

interface ChatPanelProps {
  onClose: () => void
}

function isToolMsg(m: ChatMessage): boolean {
  return m.role === "tool"
}

// ── Icons ────────────────────────────────────────────────────────────────────

function IconSend(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function IconClose(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function IconLightning(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
}

function IconStop(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  )
}

function IconPlan(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

function IconChat(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function IconHistory(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  )
}

function IconNewChat(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

// ── Relative time helper ─────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  const date = new Date(ts)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function groupByDate<T extends { createdAt: number }>(items: T[]): { label: string; items: T[] }[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const weekStart = todayStart - 6 * 86400000

  const groups: Record<string, T[]> = { Today: [], Yesterday: [], "Previous 7 Days": [], Older: [] }
  for (const item of items) {
    if (item.createdAt >= todayStart) groups["Today"].push(item)
    else if (item.createdAt >= yesterdayStart) groups["Yesterday"].push(item)
    else if (item.createdAt >= weekStart) groups["Previous 7 Days"].push(item)
    else groups["Older"].push(item)
  }
  return ["Today", "Yesterday", "Previous 7 Days", "Older"]
    .filter((label) => groups[label].length > 0)
    .map((label) => ({ label, items: groups[label] }))
}

// ── Main Component ────────────────────────────────────────────────────────────

interface AttachedFile {
  path: string
  name: string
  content: string
}

export function ChatPanel({ onClose }: ChatPanelProps): JSX.Element {
  const {
    messages, isStreaming, addMessage, updateMessage, removeMessage, setThinkingSeconds, setMessageTokens, setStreaming,
    globalSummary, mode, autoAccept, setMode, setAutoAccept,
    sessionHandoff, startNewSession, compressedContext, compressOldMessages,
    getProjectSessions, switchSession, deleteSession, saveProjectChat,
    clearMessages
  } = useAIStore()
  const { projectPath, activeFile, fileContents } = useProjectStore()
  const [input, setInput] = useState("")
  const [bridgeConnected, setBridgeConnected] = useState(false)
  const [allSkills, setAllSkills] = useState<Skill[]>(BUILT_IN_SKILLS)
  const [skillMatches, setSkillMatches] = useState<Skill[]>([])
  const [skillIndex, setSkillIndex] = useState(0)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [advisorActive, setAdvisorActive] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<{ id: string; tool: string; input: Record<string, unknown>; preview?: EditPreviewPayload | null } | null>(null)
  const [pendingAskUser, setPendingAskUser] = useState<{ id: string; questions: AskUserQuestion[] } | null>(null)
  const [agentTodos, setAgentTodos] = useState<Array<{ content: string; status: string }>>([])
  const [showSessions, setShowSessions] = useState(false)
  const [sessionsClosing, setSessionsClosing] = useState(false)
  const [showModeDropdown, setShowModeDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [tokens, setTokens] = useState({ input: 0, output: 0, cacheRead: 0 })
  const { provider, model, setModel: setStoreModel } = useSettingsStore()

  // Turn-level status (CC-style ✶ verb… (elapsed · ↑X ↓Y · thought for Xs)) —
  // one object, set on Send, cleared when streaming ends. thoughtMs is the
  // delay from turn start to first text chunk (= pre-emission thinking time).
  const [turn, setTurn] = useState<{
    startedAt: number
    verb: string
    tokenSnap: { input: number; output: number; cacheRead: number }
    thoughtMs: number | null
  } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!isStreaming) { setTurn(null); return }
    const id = setInterval(() => setTick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [isStreaming])

  const sessionsVisible = showSessions || sessionsClosing

  const closeSessions = useCallback(() => {
    if (!showSessions) return
    setSessionsClosing(true)
    setShowSessions(false)
    setTimeout(() => setSessionsClosing(false), 180)
  }, [showSessions])

  const [proFeatures, setProFeatures] = useState<Record<string, boolean>>({})
  const [allModels, setAllModels] = useState<Record<string, Array<{ id: string; label: string }>>>({})
  const availableModels = allModels[provider] ?? []
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // The textarea `disabled` flag drops focus when streaming starts. Refocus
  // when streaming ends so the user can immediately type their next message.
  const wasStreamingRef = useRef(false)
  // Tracks the in-flight assistant message so the token-usage listener can update its footer live.
  const streamingCtxRef = useRef<{ id: string; snap: { input: number; output: number; cacheRead: number } } | null>(null)
  const t = useT()

  // Load pro status + models
  useEffect(() => {
    window.api.getProStatus().then((s: { features: Record<string, boolean> }) => {
      setProFeatures(s.features ?? {})
    }).catch(() => {})
    window.api.aiGetProviderModel().then((result: { provider: string; model: string; models: Record<string, Array<{ id: string; label: string }>> }) => {
      setAllModels(result.models)
    }).catch(() => {})
  }, [])

  // Load custom skills from project
  useEffect(() => {
    if (!projectPath || typeof window.api.skillsLoad !== "function") return
    window.api.skillsLoad(projectPath).then((raw) => {
      const custom = (raw ?? []) as Skill[]
      setAllSkills(mergeSkills(custom))
    }).catch(() => {})
  }, [projectPath])

  useEffect(() => {
    window.api.bridgeIsConnected().then(setBridgeConnected)
  }, [])
  useIpcEvent("bridge:update", (data) => {
    const d = data as { connected?: boolean }
    if (typeof d.connected === "boolean") setBridgeConnected(d.connected)
  })

  // Real-time token usage tracking — also updates the active streaming message's footer live.
  useEffect(() => {
    if (typeof window.api.aiGetTokenUsage === "function") {
      window.api.aiGetTokenUsage().then(setTokens).catch(() => {})
    }
    if (typeof window.api.onTokenUsage === "function") {
      return window.api.onTokenUsage((usage) => {
        setTokens(usage)
        const ctx = streamingCtxRef.current
        if (ctx) {
          setMessageTokens(ctx.id, {
            input: Math.max(0, usage.input - ctx.snap.input),
            output: Math.max(0, usage.output - ctx.snap.output),
            cache: Math.max(0, usage.cacheRead - ctx.snap.cacheRead)
          })
        }
      })
    }
  }, [setMessageTokens])

  // Listen for agent todo updates
  useEffect(() => {
    if (typeof window.api.onTodosUpdated === "function") {
      return window.api.onTodosUpdated(setAgentTodos)
    }
  }, [])

  // Close mode/model dropdowns on outside click (sessions overlay handled separately)
  const closeDropdowns = useCallback(() => {
    setShowModeDropdown(false)
    setShowModelDropdown(false)
  }, [])
  useEffect(() => {
    if (!showModeDropdown && !showModelDropdown) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest("[data-dropdown]")) closeDropdowns()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [showModeDropdown, showModelDropdown, closeDropdowns])

  // Auto-save session when messages change (debounced)
  useEffect(() => {
    if (!projectPath || messages.length === 0 || isStreaming) return
    const timer = setTimeout(() => saveProjectChat(projectPath), 500)
    return () => clearTimeout(timer)
  }, [projectPath, messages, isStreaming, saveProjectChat])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, pendingApproval, pendingAskUser])

  const groupedMessages = useMemo(() => {
    const grouped: (ChatMessage | ChatMessage[])[] = []
    for (const msg of messages) {
      if (isToolMsg(msg)) {
        const last = grouped[grouped.length - 1]
        if (Array.isArray(last)) {
          last.push(msg)
        } else {
          grouped.push([msg])
        }
      } else {
        grouped.push(msg)
      }
    }
    return grouped
  }, [messages])

  const buildContext = () => ({
    globalSummary,
    projectPath: projectPath ?? undefined,
    currentFile: activeFile ?? undefined,
    currentFileContent: activeFile ? fileContents[activeFile] : undefined,
    sessionHandoff: compressedContext
      ? `${compressedContext}${sessionHandoff ? "\n---\n" + sessionHandoff : ""}`
      : sessionHandoff || undefined,
    attachedFiles: attachedFiles.length > 0
      ? attachedFiles.map((f) => ({ path: f.path, content: f.content }))
      : undefined,
    mode
  })

  // Skills autocomplete
  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
      const matches = findSkills(trimmed, allSkills)
      setSkillMatches(matches)
      setSkillIndex(0)
    } else {
      setSkillMatches([])
    }
  }, [input, allSkills])

  const selectSkill = (skill: Skill) => {
    const selection = activeFile ? (fileContents[activeFile] ?? "") : ""
    const expanded = expandSkill(skill, selection, activeFile ?? "")
    setInput(expanded)
    setSkillMatches([])
    textareaRef.current?.focus()
  }

  // Refocus the textarea on the streaming true→false edge so the user can type
  // their next message without clicking back in. The textarea loses focus when
  // it becomes disabled during streaming; nothing auto-restores it.
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      textareaRef.current?.focus()
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  const attachCurrentFile = () => {
    if (!activeFile || !fileContents[activeFile]) return
    if (attachedFiles.some((f) => f.path === activeFile)) return
    const name = getFileName(activeFile)
    setAttachedFiles((prev) => [...prev, {
      path: activeFile,
      name,
      content: fileContents[activeFile]
    }])
  }

  const removeAttachment = (path: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.path !== path))
  }

  const buildApiMessages = useCallback((userMsg: string) => {
    const history = messages
      .filter((m) => !m.streaming && m.role !== "tool")
      .map((m) => ({ role: m.role, content: m.content }))
    history.push({ role: "user", content: userMsg })
    return history
  }, [messages])

  // Auto-detect memories from the last exchange (fire-and-forget)
  const triggerAutoMemory = useCallback(() => {
    if (!projectPath) return
    const nonStreaming = messages.filter((m) => !m.streaming)
    if (nonStreaming.length < 2) return
    const lastUser = [...nonStreaming].reverse().find((m) => m.role === "user")
    const lastAssistant = [...nonStreaming].reverse().find((m) => m.role === "assistant")
    if (!lastUser || !lastAssistant) return
    // Fire and forget — don't block UI
    window.api.memoryAutoDetect(projectPath, lastUser.content, lastAssistant.content).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, projectPath])

  const handleAbort = useCallback(() => {
    window.api.aiAbort()
    setStreaming(false)
    setAdvisorActive(false)
    setPendingApproval(null); setPendingAskUser(null)
    // Mark last streaming message as done
    const last = messages[messages.length - 1]
    if (last?.streaming) {
      updateMessage(last.id, last.content + "\n\n*(cancelled)*", false)
    }
  }, [messages, setStreaming, updateMessage])

  // ── Agent mode: AI reads/writes files directly ──────────────────────────
  const executeAgent = useCallback(
    async (apiMessages: Array<{role: string; content: string}>) => {
      const assistantId = addMessage({ role: "assistant", content: "", streaming: true })
      setStreaming(true)
      setTurn({
        startedAt: Date.now(),
        verb: pickVerbPair(String(Math.random()))[0],
        tokenSnap: { ...tokens },
        thoughtMs: null,
      })
      setAdvisorActive(false)
        setPendingApproval(null); setPendingAskUser(null)
      const thinkingStart = Date.now()
      let thinkingCaptured = false
      const tokenSnapshot = { ...tokens }
      streamingCtxRef.current = { id: assistantId, snap: tokenSnapshot }
      // Track the current assistant bubble. After each tool event we clear
      // currentId; the NEXT text chunk will lazily open a fresh bubble.
      // This avoids empty "Thinking…" placeholders when tools chain with
      // no narration between them.
      let currentId: string | null = assistantId
      // Most recent bubble that ACTUALLY received content. Used as the
      // stats fallback when the agent ends right after a tool — assistantId
      // may have been removed by the empty-bubble cleanup path, leaving
      // setMessageTokens with a dead id.
      let lastLiveId: string = assistantId
      let accumulated = ""
      try {
        await window.api.aiAgentChat(
          apiMessages,
          buildContext(),
          (chunk) => {
            if (chunk === null) return
            // Lazy-create a new bubble if the previous one was closed by a tool
            if (currentId === null) {
              currentId = addMessage({ role: "assistant", content: "", streaming: true })
              accumulated = ""
            }
            if (!thinkingCaptured) {
              const ms = Date.now() - thinkingStart
              setThinkingSeconds(currentId, Math.round(ms / 1000))
              setTurn((t) => t && t.thoughtMs === null ? { ...t, thoughtMs: ms } : t)
              thinkingCaptured = true
            }
            accumulated += chunk
            updateMessage(currentId, accumulated, true)
            lastLiveId = currentId
          },
          (event: ToolEvent) => {
            // Finalize the bubble that led into this tool call (if any)
            if (currentId !== null) {
              // If no text came in for this bubble, drop it so we don't
              // render an empty "Thinking…" placeholder
              if (accumulated.length === 0) {
                removeMessage(currentId)
              } else {
                updateMessage(currentId, accumulated, false)
                lastLiveId = currentId
              }
            }
            addMessage({
              role: "tool",
              content: event.output.slice(0, 200),
              toolName: event.tool,
              toolSuccess: event.success,
              // Prefer input.path for the filename label — output text is
              // unreliable (e.g. Lint's "No lint errors found." has none).
              toolPath: typeof event.input?.path === "string" ? event.input.path : undefined
            })
            currentId = null
            accumulated = ""
          },
          undefined,
          (active) => { setAdvisorActive(active) },
          undefined,  // onThinking — turn-status covers thinking UI globally
          (req) => { setPendingApproval(req as { id: string; tool: string; input: Record<string, unknown>; preview?: EditPreviewPayload | null }) },
          (req) => { setPendingAskUser(req) },
          // Read latest autoAccept via getState — useCallback closure would
          // otherwise freeze it at the first-render value (always false).
          useAIStore.getState().autoAccept
        )
        // If the agent ended right after a tool (no trailing text), there's
        // no live bubble — token stats/final state attach to the initial
        // assistantId instead. Drop the unused initial bubble if it was
        // never populated AND we rotated past it.
        const finalTokens = await window.api.aiGetTokenUsage().catch(() => tokenSnapshot)
        // Attach stats to the last bubble that actually got content. Falling
        // back to assistantId is unsafe — it may have been removed by the
        // empty-bubble cleanup in the tool callback.
        const targetId = currentId ?? lastLiveId
        if (!thinkingCaptured) {
          setThinkingSeconds(targetId, Math.round((Date.now() - thinkingStart) / 1000))
        }
        setMessageTokens(targetId, {
          input: Math.max(0, finalTokens.input - tokenSnapshot.input),
          output: Math.max(0, finalTokens.output - tokenSnapshot.output),
          cache: Math.max(0, finalTokens.cacheRead - tokenSnapshot.cacheRead)
        })
        if (currentId !== null) {
          updateMessage(currentId, accumulated, false)
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const cleaned = errMsg.replace(/^Error invoking remote method '[^']+': /, "")
        updateMessage(currentId ?? assistantId, `Error: ${cleaned}`, false)
      } finally {
        streamingCtxRef.current = null
        setStreaming(false)
        setAdvisorActive(false)
            setPendingApproval(null); setPendingAskUser(null)
        setAgentTodos([])
        // Auto-compress if context is getting large
        compressOldMessages()
        // Auto-detect memories from this exchange
        triggerAutoMemory()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, activeFile, fileContents, globalSummary]
  )

  // ── Plan mode: chat only, no file modifications ─────────────────────────
  const doSendChat = useCallback(
    async (apiMessages: Array<{role: string; content: string}>) => {
      const assistantId = addMessage({ role: "assistant", content: "", streaming: true })
      setStreaming(true)
      setTurn({
        startedAt: Date.now(),
        verb: pickVerbPair(String(Math.random()))[0],
        tokenSnap: { ...tokens },
        thoughtMs: null,
      })
      const thinkingStart = Date.now()
      let thinkingCaptured = false
      const tokenSnapshot = { ...tokens }
      streamingCtxRef.current = { id: assistantId, snap: tokenSnapshot }
      try {
        let accumulated = ""
        await window.api.aiChatStream(
          apiMessages,
          buildContext(),
          (chunk) => {
            if (chunk === null) return
            if (!thinkingCaptured) {
              const ms = Date.now() - thinkingStart
              setThinkingSeconds(assistantId, Math.round(ms / 1000))
              setTurn((t) => t && t.thoughtMs === null ? { ...t, thoughtMs: ms } : t)
              thinkingCaptured = true
            }
            accumulated += chunk
            updateMessage(assistantId, accumulated, true)
          },
          (active) => { setAdvisorActive(active) }
        )
        if (!thinkingCaptured) {
          setThinkingSeconds(assistantId, Math.round((Date.now() - thinkingStart) / 1000))
        }
        // Snapshot final tokens, compute delta for this turn
        const finalTokens = await window.api.aiGetTokenUsage().catch(() => tokenSnapshot)
        setMessageTokens(assistantId, {
          input: Math.max(0, finalTokens.input - tokenSnapshot.input),
          output: Math.max(0, finalTokens.output - tokenSnapshot.output),
          cache: Math.max(0, finalTokens.cacheRead - tokenSnapshot.cacheRead)
        })
        updateMessage(assistantId, accumulated, false)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const cleaned = errMsg.replace(/^Error invoking remote method '[^']+': /, "")
        updateMessage(assistantId, `Error: ${cleaned}`, false)
      } finally {
        streamingCtxRef.current = null
        setStreaming(false)
            // Auto-compress if context is getting large
        compressOldMessages()
        // Auto-detect memories from this exchange
        triggerAutoMemory()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, activeFile, fileContents, globalSummary]
  )

  // ── Send dispatch ────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return
    const userMsg = input.trim()

    if (userMsg === "/clear") {
      setInput("")
      clearMessages()
      return
    }

    setInput("")
    setAttachedFiles([])
    track(Events.MESSAGE_SENT, { mode })
    addMessage({ role: "user", content: userMsg })
    const apiMessages = buildApiMessages(userMsg)

    if (mode === "chat") {
      await doSendChat(apiMessages)
    } else if (mode === "plan") {
      await doSendChat(apiMessages)
    } else if (proFeatures.agent === false) {
      // Agent mode requires Pro — fall back to basic chat with a notice
      addMessage({
        role: "assistant",
        content: "Agent mode requires **Luano Pro**. Switching to chat mode.\n\nStart your **free 7-day trial** at [luano.dev/pricing](https://luano.dev/pricing) — includes autonomous coding, inline edit, Studio bridge, and more."
      })
      await doSendChat(apiMessages)
    } else {
      await executeAgent(apiMessages)
    }
  }, [input, isStreaming, mode, proFeatures, addMessage, buildApiMessages, doSendChat, executeAgent, clearMessages])

  const handleKeyDown = (e: KeyboardEvent) => {
    // Skills autocomplete navigation
    if (skillMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSkillIndex((i) => Math.min(i + 1, skillMatches.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSkillIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault()
        selectSkill(skillMatches[skillIndex])
        return
      }
      if (e.key === "Escape") {
        setSkillMatches([])
        return
      }
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault()
      // Cycle Chat → Agent → Plan → Chat
      if (mode === "chat") setMode("agent")
      else if (mode === "agent") setMode("plan")
      else setMode("chat")
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (isStreaming) return  // streaming — Send button becomes Stop, ignore Enter
      sendMessage()
    }
  }

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }, [input])

  const showStop = isStreaming

  return (
    <div className="flex flex-col h-full overflow-hidden relative" style={{ background: "var(--bg-base)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-panel)", overflow: "visible", zIndex: 20, position: "relative" }}
      >
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>
          AI
        </span>

        {/* Bridge badge */}
        {bridgeConnected && (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded"
            title={t("studioConnected")}
            style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)", fontSize: "10px", color: "var(--success)" }}
          >
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--success)", display: "inline-block" }} />
            Studio
          </span>
        )}

        <div className="flex-1" />

        {/* Advisor indicator */}
        {isStreaming && advisorActive && (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded animate-fade-in"
            style={{
              fontSize: "10px",
              color: "rgb(168,85,247)",
              background: "rgba(168,85,247,0.08)",
              border: "1px solid rgba(168,85,247,0.2)",
              fontFamily: "monospace"
            }}
          >
            <span className="animate-blink" style={{ width: 4, height: 4, borderRadius: "50%", background: "rgb(168,85,247)", display: "inline-block" }} />
            Advisor
          </span>
        )}


        {/* New Chat */}
        {messages.length > 0 && !isStreaming && !showSessions && (
          <button
            onClick={() => startNewSession(projectPath ?? undefined)}
            title="New Chat"
            className="w-6 h-6 flex items-center justify-center rounded-md transition-all duration-100"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => { (e.currentTarget).style.color = "var(--accent)"; (e.currentTarget).style.background = "var(--bg-elevated)" }}
            onMouseLeave={e => { (e.currentTarget).style.color = "var(--text-secondary)"; (e.currentTarget).style.background = "transparent" }}
          >
            <IconNewChat />
          </button>
        )}

        {/* History */}
        {projectPath && (
          <button
            onClick={() => showSessions ? closeSessions() : setShowSessions(true)}
            title="Chat History"
            className="w-6 h-6 flex items-center justify-center rounded-md transition-all duration-100"
            style={{ color: sessionsVisible ? "var(--accent)" : "var(--text-secondary)" }}
            onMouseEnter={e => { (e.currentTarget).style.color = "var(--accent)"; (e.currentTarget).style.background = "var(--bg-elevated)" }}
            onMouseLeave={e => { (e.currentTarget).style.color = sessionsVisible ? "var(--accent)" : "var(--text-secondary)"; (e.currentTarget).style.background = "transparent" }}
          >
            <IconHistory />
          </button>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-md transition-all duration-100"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={e => { (e.currentTarget).style.color = "var(--text-primary)"; (e.currentTarget).style.background = "var(--bg-elevated)" }}
          onMouseLeave={e => { (e.currentTarget).style.color = "var(--text-secondary)"; (e.currentTarget).style.background = "transparent" }}
        >
          <IconClose />
        </button>
      </div>

      {/* Session history overlay */}
      {sessionsVisible && projectPath && (
        <div
          className={`absolute inset-0 z-40 flex flex-col ${sessionsClosing ? "animate-slide-down-out" : "animate-slide-down"}`}
          style={{ background: "var(--bg-base)", top: "37px" }}
        >
          {/* Overlay header */}
          <div
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-panel)" }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.2px" }}>
              Chat History
            </span>
            <div className="flex-1" />
            <button
              onClick={() => { startNewSession(projectPath); closeSessions() }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-150"
              style={{
                fontSize: "11px",
                fontWeight: 500,
                color: "var(--accent)",
                background: "rgba(37,99,235,0.08)",
                border: "1px solid rgba(37,99,235,0.2)"
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement
                el.style.background = "var(--accent)"
                el.style.color = "white"
                el.style.transform = "translateY(-1px)"
                el.style.boxShadow = "0 2px 8px rgba(37,99,235,0.3)"
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement
                el.style.background = "rgba(37,99,235,0.08)"
                el.style.color = "var(--accent)"
                el.style.transform = ""
                el.style.boxShadow = ""
              }}
            >
              <IconNewChat />
              New Chat
            </button>
            <button
              onClick={() => closeSessions()}
              className="w-6 h-6 flex items-center justify-center rounded-md transition-all duration-100"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={e => { (e.currentTarget).style.color = "var(--text-secondary)"; (e.currentTarget).style.background = "var(--bg-elevated)" }}
              onMouseLeave={e => { (e.currentTarget).style.color = "var(--text-muted)"; (e.currentTarget).style.background = "transparent" }}
            >
              <IconClose />
            </button>
          </div>
          {/* Session list grouped by date */}
          <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
            {(() => {
              const sessions = getProjectSessions(projectPath).slice().reverse()
              if (sessions.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center h-full gap-3 py-16 animate-fade-in" style={{ color: "var(--text-muted)" }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                      <IconHistory />
                    </div>
                    <p style={{ fontSize: "12px" }}>No conversations yet</p>
                    <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>Start a chat to see it here</p>
                  </div>
                )
              }
              const groups = groupByDate(sessions)
              let itemCounter = 0
              return groups.map((group) => (
                <div key={group.label}>
                  <div className="px-4 pt-3 pb-1.5">
                    <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      {group.label}
                    </span>
                  </div>
                  {group.items.map((session) => {
                    const isActive = session.id === useAIStore.getState().activeSessionId
                    const delay = Math.min(itemCounter++ * 30, 200)
                    return (
                      <div
                        key={session.id}
                        className={`session-item flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg cursor-pointer${isActive ? " session-active" : ""}`}
                        style={{
                          animation: `staggerIn 0.2s ease-out ${delay}ms both`,
                          paddingLeft: isActive ? "10px" : "12px"
                        }}
                        onMouseUp={() => { if (!isActive) switchSession(projectPath, session.id); closeSessions() }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="truncate" style={{ fontSize: "12px", color: isActive ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: isActive ? 500 : 400 }}>
                            {session.preview || "New conversation"}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5" style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                            <span>{relativeTime(session.createdAt)}</span>
                            <span style={{ opacity: 0.4 }}>·</span>
                            <span>{session.messages.length} msgs</span>
                          </div>
                        </div>
                        {isActive && (
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-glow-pulse"
                            style={{ background: "var(--accent)", boxShadow: "0 0 6px rgba(37,99,235,0.4)" }}
                          />
                        )}
                        {!isActive && (
                          <button
                            className="session-delete w-6 h-6 flex items-center justify-center rounded-md flex-shrink-0"
                            style={{ color: "var(--text-muted)", fontSize: "14px" }}
                            onMouseUp={(e) => { e.stopPropagation(); deleteSession(projectPath, session.id) }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* Agent Todos */}
      {agentTodos.length > 0 && (
        <div className="px-3 py-2 flex flex-col gap-1" style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-panel)" }}>
          {agentTodos.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5" style={{ fontSize: "11px" }}>
              <span style={{
                color: t.status === "completed" ? "var(--success)" : t.status === "in_progress" ? "var(--accent)" : "var(--text-muted)",
                fontFamily: "monospace", fontSize: "10px", width: 14, textAlign: "center"
              }}>
                {t.status === "completed" ? "\u2713" : t.status === "in_progress" ? "\u25B6" : "\u25CB"}
              </span>
              <span style={{
                color: t.status === "completed" ? "var(--text-muted)" : "var(--text-primary)",
                textDecoration: t.status === "completed" ? "line-through" : "none"
              }}>
                {t.content}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3" style={{ scrollbarGutter: "stable" }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12 animate-fade-in">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
                <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2z" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Ask anything or request code edits
              </p>
              <p className="text-xs mt-1.5" style={{ color: "var(--text-secondary)" }}>
                Use Agent mode for file edits
              </p>
            </div>
          </div>
        )}
        {groupedMessages.map((item, i) => {
          // While the turn is active, ALL assistant footers are suppressed —
          // the bottom turn-status line is the single live indicator. Otherwise
          // rotation between bubbles shows a frozen "Unioned for 6s" footer on
          // the just-completed bubble AND the live status at the bottom, which
          // reads as two indicators for the same turn.
          const turnActive = turn !== null
          if (Array.isArray(item)) {
            // Tool group. If the assistant message immediately before this one
            // had its footer deferred (because a tool group followed it), render
            // it here — CC-style footer belongs at the end of the turn, below tools.
            const prev = groupedMessages[i - 1]
            const deferredFooter = !Array.isArray(prev) && prev?.role === "assistant" ? prev : null
            return (
              <div key={`tg-${i}`}>
                <ToolCallGroup events={item} />
                {!turnActive && deferredFooter && <MessageFooter message={deferredFooter} />}
              </div>
            )
          }
          // Hide this message's footer if the next item is a tool group —
          // the footer will render after the tool group instead. Also hide
          // while turn is active (any assistant bubble mid-turn would double
          // up with the turn-status line).
          const next = groupedMessages[i + 1]
          const hasTrailingTools = Array.isArray(next) && item.role === "assistant"
          const hideFooter = hasTrailingTools || (turnActive && item.role === "assistant")
          return (
            <MessageBubble
              key={item.id}
              message={item}
              hideFooter={hideFooter}
            />
          )
        })}

        {/* Ask user interactive card */}
        {pendingAskUser && (
          <AskUserCard
            request={pendingAskUser}
            onSubmit={(id, answers) => {
              window.api.sendAskUserResponse(id, answers)
              setPendingAskUser(null)
            }}
          />
        )}

        {/* Tool approval request — write tools get diff preview card */}
        {pendingApproval && (
          <EditPreviewCard
            tool={pendingApproval.tool}
            preview={pendingApproval.preview ?? null}
            input={pendingApproval.input}
            onAccept={() => { window.api.sendToolApproval(pendingApproval.id, true); setPendingApproval(null); setPendingAskUser(null) }}
            onReject={() => { window.api.sendToolApproval(pendingApproval.id, false); setPendingApproval(null); setPendingAskUser(null) }}
          />
        )}

        {/* Turn status — one line, visible throughout an agent/chat turn */}
        {isStreaming && turn && (
          <div
            className="flex items-center gap-2 px-2 py-1.5 selectable animate-fade-in"
            style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', monospace" }}
            data-tick={tick}
          >
            <span
              aria-hidden
              className="animate-glow-pulse-text"
              style={{ color: "var(--accent)", fontSize: 14, display: "inline-block" }}
            >✶</span>
            <span style={{ color: "var(--text-primary)" }}>{turn.verb}…</span>
            <span style={{ color: "var(--text-muted)" }}>
              ({formatDuration(Math.floor((Date.now() - turn.startedAt) / 1000))}
              {(tokens.input - turn.tokenSnap.input) > 0 && (
                <> · ↑ {((tokens.input - turn.tokenSnap.input) / 1000).toFixed(1)}k</>
              )}
              {(tokens.output - turn.tokenSnap.output) > 0 && (
                <> ↓ {((tokens.output - turn.tokenSnap.output) / 1000).toFixed(1)}k</>
              )}
              {turn.thoughtMs !== null && turn.thoughtMs >= 500 && (
                <> · thought for {formatDuration(Math.round(turn.thoughtMs / 1000))}</>
              )}
              )
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className="px-3 pt-2 pb-3 flex-shrink-0 relative"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        {!projectPath && (
          <div
            className="text-xs mb-2 px-2 py-1 rounded-md animate-fade-in"
            style={{ color: "var(--warning)", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            {t("openProject")}
          </div>
        )}

        {/* Skills autocomplete dropdown */}
        {skillMatches.length > 0 && (
          <div
            className="absolute left-3 right-3 rounded-lg overflow-hidden animate-fade-in"
            style={{
              bottom: "100%",
              marginBottom: 4,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              boxShadow: "0 -8px 24px rgba(0,0,0,0.4)",
              zIndex: 10,
              maxHeight: 200,
              overflowY: "auto"
            }}
          >
            {skillMatches.map((skill, i) => (
              <button
                key={skill.command}
                onClick={() => selectSkill(skill)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors duration-75"
                style={{
                  background: i === skillIndex ? "var(--bg-surface)" : "transparent",
                  borderBottom: i < skillMatches.length - 1 ? "1px solid var(--border-subtle)" : "none"
                }}
              >
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--accent)", fontFamily: "monospace", minWidth: 70 }}>
                  {skill.command}
                </span>
                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  {skill.description}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Attached files chips */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachedFiles.map((f) => (
              <span
                key={f.path}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md"
                style={{
                  fontSize: "10px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)"
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <polyline points="13 2 13 9 20 9" />
                </svg>
                {f.name}
                <button
                  onClick={() => removeAttachment(f.path)}
                  className="ml-0.5 rounded-sm transition-colors duration-75"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}

        <div
          className="rounded-lg transition-all duration-150"
          style={{ border: "1px solid var(--border)", overflow: "visible" }}
          onFocusCapture={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
          onBlurCapture={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === "plan"
                ? "Describe what to build \u2014 AI analyzes without modifying..."
                : mode === "chat"
                ? "Ask a question \u2014 AI replies with code you apply manually..."
                : "Ask anything or request code edits..."
            }
            rows={2}
            disabled={!projectPath}
            className="w-full resize-none selectable focus:outline-none rounded-t-lg"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              fontSize: "13px",
              padding: "8px 10px 0px",
              lineHeight: "1.5",
              display: "block"
            }}
          />
          <div
            className="flex items-center justify-between px-2 py-1.5"
            style={{ background: "var(--bg-elevated)", borderTop: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center gap-1.5">
              {/* Mode dropdown (Chat / Agent / Plan) */}
              <div className="relative" data-dropdown>
                <button
                  onClick={() => { setShowModeDropdown((v) => !v); setShowModelDropdown(false); closeSessions() }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-100"
                  style={{
                    fontSize: "10px",
                    color: mode === "plan" ? "var(--info)" : mode === "chat" ? "var(--text-secondary)" : "var(--success)",
                    border: "1px solid var(--border-subtle)"
                  }}
                >
                  {mode === "plan" ? <><IconPlan /> Plan</> : mode === "chat" ? <><IconChat /> Chat</> : <><IconSend /> Agent</>}
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 15 12 9 18 15" /></svg>
                </button>
                {showModeDropdown && (
                  <div
                    className="absolute left-0 bottom-full mb-1 z-50 rounded-lg overflow-hidden shadow-lg"
                    style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", minWidth: "150px" }}
                  >
                    {([
                      { key: "chat", label: "Chat", icon: <IconChat />, active: mode === "chat" },
                      { key: "agent", label: "Agent", icon: <IconSend />, active: mode === "agent", pro: proFeatures.agent === false },
                      { key: "plan", label: "Plan", icon: <IconPlan />, active: mode === "plan" }
                    ] as const).map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => {
                          setMode(opt.key)
                          setShowModeDropdown(false)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors duration-75"
                        style={{
                          fontSize: "11px",
                          color: opt.active ? "var(--accent)" : "var(--text-secondary)",
                          fontWeight: opt.active ? 500 : 400,
                          borderBottom: "1px solid var(--border-subtle)"
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                      >
                        {opt.icon}
                        <span className="flex-1">{opt.label}</span>
                        {"pro" in opt && opt.pro && (
                          <span style={{ fontSize: "9px", color: "var(--accent)", fontWeight: 600, letterSpacing: "0.5px" }}>PRO</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Auto-accept toggle (only meaningful in Agent mode) */}
              {mode === "agent" && (
                <button
                  onClick={() => setAutoAccept(!autoAccept)}
                  title={autoAccept ? "Auto-accept: ON (tool calls run without approval)" : "Auto-accept: OFF (approve each tool call)"}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-100"
                  style={{
                    fontSize: "10px",
                    color: autoAccept ? "var(--success)" : "var(--text-secondary)",
                    border: "1px solid var(--border-subtle)",
                    opacity: autoAccept ? 1 : 0.7
                  }}
                >
                  <IconLightning />
                  {autoAccept ? "Auto" : "Manual"}
                </button>
              )}

              {/* Model dropdown */}
              <div className="relative" data-dropdown>
                <button
                  onClick={() => { setShowModelDropdown((v) => !v); setShowModeDropdown(false); closeSessions() }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-100"
                  style={{ fontSize: "10px", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
                >
                  {availableModels.find((m) => m.id === model)?.label ?? model}
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 15 12 9 18 15" /></svg>
                </button>
                {showModelDropdown && (
                  <div
                    className="absolute left-0 bottom-full mb-1 z-50 rounded-lg overflow-hidden shadow-lg"
                    style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", minWidth: "160px" }}
                  >
                    {availableModels.map((m) => (
                      <button
                        key={m.id}
                        onClick={async () => {
                          const midConversation = messages.length > 0 && m.id !== model
                          await window.api.aiSetModel(m.id)
                          setStoreModel(m.id)
                          setShowModelDropdown(false)
                          // Mid-conversation switches lose the prompt cache — the new model
                          // rebuilds the prefix from scratch. Flag it so the next turn's cost
                          // isn't a surprise. Matches Claude Code's /model warning.
                          if (midConversation) {
                            toast(
                              `Model switched to ${m.label}. Prompt cache invalidated — next response re-sends the full conversation (higher input cost until cache rebuilds).`,
                              "warn"
                            )
                          }
                        }}
                        className="w-full text-left px-3 py-1.5 transition-colors duration-75"
                        style={{
                          fontSize: "11px",
                          color: m.id === model ? "var(--accent)" : "var(--text-secondary)",
                          fontWeight: m.id === model ? 500 : 400,
                          borderBottom: "1px solid var(--border-subtle)"
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>


              {/* Attach file */}
              <button
                onClick={attachCurrentFile}
                disabled={!activeFile || !projectPath}
                title={activeFile ? `Attach ${getFileName(activeFile)}` : "Open a file first"}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-100 disabled:opacity-30"
                style={{ fontSize: "10px", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
            </div>
            {showStop ? (
              <button
                onClick={handleAbort}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all duration-150"
                style={{
                  background: "var(--danger)",
                  color: "white",
                  fontSize: "11px",
                  fontWeight: 500
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = "0.85"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}
              >
                <IconStop />
                Stop
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim() || !projectPath}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: "var(--accent)",
                  color: "white",
                  fontSize: "11px",
                  fontWeight: 500
                }}
                onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)" }}
                onMouseLeave={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = "var(--accent)" }}
              >
                <IconSend />
                {t("send")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


