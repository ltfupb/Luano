import React, { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useAIStore, ChatMessage } from "../stores/aiStore"
import { useProjectStore } from "../stores/projectStore"
import { useSettingsStore } from "../stores/settingsStore"
import { CodeBlock } from "./CodeBlock"
import { useT } from "../i18n/useT"
import { useIpcEvent } from "../hooks/useIpc"
import { BUILT_IN_SKILLS, mergeSkills, findSkills, expandSkill, Skill } from "./skills"

interface ToolEvent {
  tool: string
  input: Record<string, unknown>
  output: string
  success: boolean
}

interface ChatPanelProps {
  onClose: () => void
}

interface ToolCallMessage {
  id: string
  type: "tool"
  tool: string
  success: boolean
  output: string
  ts: number
}

type DisplayMessage = ChatMessage | ToolCallMessage

function isToolMsg(m: DisplayMessage): m is ToolCallMessage {
  return (m as ToolCallMessage).type === "tool"
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
    messages, isStreaming, addMessage, updateMessage, setStreaming,
    globalSummary, planMode, autoAccept, setPlanMode, setAutoAccept,
    pendingReview, setPendingReview,
    sessionHandoff, startNewSession, compressedContext, compressOldMessages,
    getProjectSessions, switchSession, deleteSession, saveProjectChat
  } = useAIStore()
  const { projectPath, activeFile, fileContents } = useProjectStore()
  const [input, setInput] = useState("")
  const [toolMessages, setToolMessages] = useState<ToolCallMessage[]>([])
  const [bridgeConnected, setBridgeConnected] = useState(false)
  const [allSkills, setAllSkills] = useState<Skill[]>(BUILT_IN_SKILLS)
  const [skillMatches, setSkillMatches] = useState<Skill[]>([])
  const [skillIndex, setSkillIndex] = useState(0)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [agentRound, setAgentRound] = useState(0)
  const [showSessions, setShowSessions] = useState(false)
  const [sessionsClosing, setSessionsClosing] = useState(false)
  const [showModeDropdown, setShowModeDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const { provider, model, setModel: setStoreModel } = useSettingsStore()

  const sessionsVisible = showSessions || sessionsClosing
  const showSessionsRef = useRef(showSessions)
  showSessionsRef.current = showSessions

  const closeSessions = useCallback(() => {
    if (!showSessionsRef.current) return
    setSessionsClosing(true)
    setShowSessions(false)
    setTimeout(() => setSessionsClosing(false), 180)
  }, [])

  const [proFeatures, setProFeatures] = useState<Record<string, boolean>>({})
  const [allModels, setAllModels] = useState<Record<string, Array<{ id: string; label: string }>>>({})
  const availableModels = allModels[provider] ?? []
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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

  const handleAcceptChanges = useCallback(() => {
    setPendingReview(null)
  }, [setPendingReview])

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

  const handleRejectChanges = useCallback(async () => {
    if (!pendingReview) return
    if (typeof window.api.aiRevert !== "function") return
    const res = await window.api.aiRevert()
    if (res.success && res.reverted) {
      const names = res.reverted.map((f) => f.split(/[/\\]/).pop()).join(", ")
      addMessage({ role: "assistant", content: `Reverted ${res.reverted.length} file(s): ${names}` })
    }
    setPendingReview(null)
  }, [pendingReview, addMessage, setPendingReview])

  // Auto-save session when messages change (debounced)
  useEffect(() => {
    if (!projectPath || messages.length === 0 || isStreaming) return
    const timer = setTimeout(() => saveProjectChat(projectPath), 500)
    return () => clearTimeout(timer)
  }, [projectPath, messages, isStreaming, saveProjectChat])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, toolMessages])

  const displayMessages = useMemo<DisplayMessage[]>(() =>
    [...messages, ...toolMessages].sort((a, b) => {
      const aTs = "ts" in a ? a.ts : Number(a.id.split("-")[0]) || 0
      const bTs = "ts" in b ? b.ts : Number(b.id.split("-")[0]) || 0
      return aTs - bTs
    }),
    [messages, toolMessages]
  )

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
      : undefined
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

  const attachCurrentFile = () => {
    if (!activeFile || !fileContents[activeFile]) return
    if (attachedFiles.some((f) => f.path === activeFile)) return
    const name = activeFile.split(/[/\\]/).pop() ?? activeFile
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
      .filter((m) => !m.streaming)
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
    setAgentRound(0)
  }, [])

  // ── Agent mode: AI reads/writes files directly ──────────────────────────
  const executeAgent = useCallback(
    async (apiMessages: Array<{role: string; content: string}>) => {
      const assistantId = addMessage({ role: "assistant", content: "", streaming: true })
      setStreaming(true)
      setAgentRound(0)
      try {
        let accumulated = ""
        const result = await window.api.aiAgentChat(
          apiMessages,
          buildContext(),
          (chunk) => {
            if (chunk === null) return
            accumulated += chunk
            updateMessage(assistantId, accumulated, true)
          },
          (event: ToolEvent) => {
            const now = Date.now()
            setToolMessages((prev) => [
              ...prev.slice(-99),
              {
                id: `tool-${now}-${Math.random()}`,
                type: "tool",
                tool: event.tool,
                success: event.success,
                output: event.output.slice(0, 200),
                ts: now
              }
            ])
          },
          (roundInfo) => {
            setAgentRound(roundInfo.round)
          }
        )
        updateMessage(assistantId, accumulated, false)
        if (result.modifiedFiles.length > 0) {
          const names = result.modifiedFiles.map((f) => f.split(/[/\\]/).pop()).join(", ")
          updateMessage(assistantId, `${accumulated}\n\n Modified: ${names}`, false)
          if (!autoAccept) {
            setPendingReview({ files: result.modifiedFiles, messageId: assistantId })
          }
        }
      } catch (err) {
        updateMessage(assistantId, `Error: ${String(err)}`, false)
      } finally {
        setStreaming(false)
        setAgentRound(0)
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
      try {
        let accumulated = ""
        await window.api.aiChatStream(
          apiMessages,
          buildContext(),
          (chunk) => {
            if (chunk === null) return
            accumulated += chunk
            updateMessage(assistantId, accumulated, true)
          }
        )
        updateMessage(assistantId, accumulated, false)
      } catch (err) {
        updateMessage(assistantId, `Error: ${String(err)}`, false)
      } finally {
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
    setInput("")
    setAttachedFiles([])
    addMessage({ role: "user", content: userMsg })
    const apiMessages = buildApiMessages(userMsg)

    if (planMode) {
      await doSendChat(apiMessages)
    } else if (proFeatures.agent === false) {
      // Agent mode requires Pro — fall back to basic chat with a notice
      addMessage({
        role: "assistant",
        content: "Agent mode requires **Luano Pro**. Switching to chat mode.\n\nUpgrade at [luano.dev/pricing](https://luano.dev/pricing) for autonomous coding, inline edit, Studio bridge, and more."
      })
      await doSendChat(apiMessages)
    } else {
      await executeAgent(apiMessages)
    }
  }, [input, isStreaming, planMode, proFeatures, addMessage, buildApiMessages, doSendChat, executeAgent])

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }, [input])

  const blocked = isStreaming || !!pendingReview
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
            style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)", fontSize: "10px", color: "#10b981" }}
          >
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            Studio
          </span>
        )}

        <div className="flex-1" />

        {/* Agent round indicator */}
        {isStreaming && agentRound > 0 && (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded animate-fade-in"
            style={{
              fontSize: "10px",
              color: "var(--accent)",
              background: "rgba(37,99,235,0.08)",
              border: "1px solid rgba(37,99,235,0.2)",
              fontFamily: "monospace"
            }}
          >
            <span className="animate-blink" style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
            Round {agentRound}
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
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
        {(() => {
          const grouped: (DisplayMessage | ToolCallMessage[])[] = []
          for (const msg of displayMessages) {
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
          return grouped.map((item, i) =>
            Array.isArray(item) ? (
              <ToolCallGroup key={`tg-${i}`} events={item} />
            ) : (
              <MessageBubble key={(item as ChatMessage).id} message={item as ChatMessage} />
            )
          )
        })()}

        {/* Accept / Reject review bar */}
        {pendingReview && !isStreaming && (
          <div
            className="mx-2 mb-2 rounded-lg p-2.5 animate-fade-in"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)"
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
              <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                {pendingReview.files.length} {t("reviewFileCount")}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 mb-2.5">
              {pendingReview.files.map((f) => (
                <span
                  key={f}
                  className="px-1.5 py-0.5 rounded font-mono"
                  style={{
                    fontSize: "10px",
                    background: "var(--bg-surface)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border-subtle)"
                  }}
                >
                  {f.split(/[/\\]/).pop()}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAcceptChanges}
                className="px-3 py-1 rounded-md font-medium transition-all duration-150"
                style={{
                  fontSize: "11px",
                  background: "#10b981",
                  color: "white"
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#059669"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#10b981"}
              >
                {t("acceptChanges")}
              </button>
              <button
                onClick={handleRejectChanges}
                className="px-3 py-1 rounded-md transition-all duration-150"
                style={{
                  fontSize: "11px",
                  background: "var(--bg-surface)",
                  color: "#f87171",
                  border: "1px solid rgba(248,113,113,0.3)"
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.1)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
              >
                {t("rejectChanges")}
              </button>
            </div>
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
            style={{ color: "#f59e0b", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
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
              planMode
                ? "Describe what to build \u2014 AI analyzes without modifying..."
                : "Ask anything or request code edits..."
            }
            rows={2}
            disabled={blocked || !projectPath}
            className="w-full resize-none selectable focus:outline-none rounded-t-lg"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              fontSize: "12px",
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
              {/* Mode dropdown (Agent / Plan / Auto) */}
              <div className="relative" data-dropdown>
                <button
                  onClick={() => { setShowModeDropdown((v) => !v); setShowModelDropdown(false); closeSessions() }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-100"
                  style={{
                    fontSize: "10px",
                    color: planMode ? "#60a5fa" : autoAccept ? "#10b981" : "var(--text-secondary)",
                    border: "1px solid var(--border-subtle)"
                  }}
                >
                  {planMode ? <><IconPlan /> Plan</> : autoAccept ? <><IconLightning /> Agent (Auto)</> : <><IconSend /> Agent</>}
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 15 12 9 18 15" /></svg>
                </button>
                {showModeDropdown && (
                  <div
                    className="absolute left-0 bottom-full mb-1 z-50 rounded-lg overflow-hidden shadow-lg"
                    style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", minWidth: "150px" }}
                  >
                    {([
                      { key: "agent", label: "Agent", icon: <IconSend />, active: !planMode && !autoAccept },
                      { key: "auto", label: "Agent (Auto Accept)", icon: <IconLightning />, active: !planMode && autoAccept },
                      { key: "plan", label: "Plan", icon: <IconPlan />, active: planMode }
                    ] as const).map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => {
                          if (opt.key === "agent") { setPlanMode(false); setAutoAccept(false) }
                          else if (opt.key === "auto") { setPlanMode(false); setAutoAccept(true) }
                          else { setPlanMode(true); setAutoAccept(false) }
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
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

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
                          await window.api.aiSetModel(m.id)
                          setStoreModel(m.id)
                          setShowModelDropdown(false)
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
                title={activeFile ? `Attach ${activeFile.split(/[/\\]/).pop()}` : "Open a file first"}
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
                  background: "#ef4444",
                  color: "white",
                  fontSize: "11px",
                  fontWeight: 500
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#dc2626"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#ef4444"}
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

// ── Message parsing ──────────────────────────────────────────────────────────

interface TextSegment { type: "text"; content: string }
interface CodeSegment { type: "code"; lang: string; content: string }
type Segment = TextSegment | CodeSegment

function parseMessage(raw: string): Segment[] {
  const segments: Segment[] = []
  const codeBlockRegex = /```(lua|luau|)?\n?([\s\S]*?)```/g
  let last = 0
  let match

  while ((match = codeBlockRegex.exec(raw)) !== null) {
    if (match.index > last) {
      segments.push({ type: "text", content: raw.slice(last, match.index) })
    }
    segments.push({ type: "code", lang: match[1] || "lua", content: match[2].trimEnd() })
    last = match.index + match[0].length
  }

  if (last < raw.length) {
    segments.push({ type: "text", content: raw.slice(last) })
  }

  return segments
}

// ── Message bubble ────────────────────────────────────────────────────────────

const MessageBubble = React.memo(function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.role === "user"
  const segments = useMemo(() => isUser ? null : parseMessage(message.content), [isUser, message.content])

  return (
    <div
      className={`flex flex-col gap-1 animate-slide-up ${isUser ? "items-end" : "items-start"}`}
    >
      {isUser ? (
        <div
          className="max-w-full rounded-xl px-3 py-2 selectable"
          style={{
            fontSize: "12px",
            lineHeight: "1.6",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "var(--accent-muted)",
            border: "1px solid rgba(37,99,235,0.25)",
            color: "var(--text-primary)"
          }}
        >
          {message.content}
        </div>
      ) : (
        <div className="max-w-full w-full flex flex-col gap-1">
          {segments?.map((seg, i) =>
            seg.type === "code" ? (
              <CodeBlock key={i} code={seg.content} lang={seg.lang} />
            ) : (
              <div
                key={i}
                className="rounded-xl px-3 py-2 selectable"
                style={{
                  fontSize: "12px",
                  lineHeight: "1.65",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)"
                }}
              >
                {seg.content}
                {i === segments.length - 1 && message.streaming && (
                  <span className="animate-blink" style={{ color: "var(--accent)" }}>{"\u258C"}</span>
                )}
              </div>
            )
          )}
          {!segments?.length && message.streaming && (
            <div
              className="rounded-xl px-3 py-2"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
            >
              <span className="animate-blink" style={{ color: "var(--accent)" }}>{"\u258C"}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// ── Tool call bubble ──────────────────────────────────────────────────────────

const TOOL_META: Record<string, { label: string; icon: string; bridge?: boolean }> = {
  read_file:            { label: "Read file",           icon: "eye" },
  edit_file:            { label: "Edit file",           icon: "pencil" },
  create_file:          { label: "Create file",         icon: "plus" },
  delete_file:          { label: "Delete file",         icon: "trash" },
  list_files:           { label: "List files",          icon: "folder" },
  grep_files:           { label: "Search in files",     icon: "search" },
  search_docs:          { label: "Search docs",         icon: "book" },
  read_instance_tree:   { label: "Read instance tree",  icon: "tree",   bridge: true },
  get_runtime_logs:     { label: "Get runtime logs",    icon: "log",    bridge: true },
  run_studio_script:    { label: "Run Studio script",   icon: "play",   bridge: true },
  set_property:         { label: "Set property",        icon: "gear",   bridge: true }
}

function ToolIcon({ type, size = 10 }: { type: string; size?: number }): JSX.Element {
  const s = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  switch (type) {
    case "eye":    return <svg {...s}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
    case "pencil": return <svg {...s}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
    case "plus":   return <svg {...s}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
    case "trash":  return <svg {...s}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
    case "folder": return <svg {...s}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
    case "search": return <svg {...s}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
    case "book":   return <svg {...s}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
    case "tree":   return <svg {...s}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
    case "log":    return <svg {...s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
    case "play":   return <svg {...s}><polygon points="5 3 19 12 5 21 5 3" /></svg>
    case "gear":   return <svg {...s}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
    default:       return <svg {...s}><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></svg>
  }
}

function ToolCallGroup({ events }: { events: ToolCallMessage[] }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const allSuccess = events.every((e) => e.success)
  const failCount = events.filter((e) => !e.success).length

  const toggleItem = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Summarize tool names for the collapsed view
  const toolSummary = (() => {
    const counts: Record<string, number> = {}
    for (const e of events) {
      const label = TOOL_META[e.tool]?.label ?? e.tool
      counts[label] = (counts[label] ?? 0) + 1
    }
    return Object.entries(counts).map(([label, n]) => n > 1 ? `${label} x${n}` : label).join(", ")
  })()

  return (
    <div className="animate-fade-in" style={{ margin: "2px 0" }}>
      <div
        className="rounded-lg overflow-hidden transition-all duration-150"
        style={{
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-panel)"
        }}
      >
        {/* Summary header */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2.5 w-full px-3 py-2 transition-all duration-100"
          style={{ textAlign: "left" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
        >
          {/* Tool icon */}
          <span
            className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background: allSuccess ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
              color: allSuccess ? "#10b981" : "#ef4444"
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 500 }}>
              Used {events.length} tool{events.length > 1 ? "s" : ""}
            </span>
            {failCount > 0 && (
              <span style={{ fontSize: "10px", color: "#ef4444", marginLeft: 6 }}>
                {failCount} failed
              </span>
            )}
            {!expanded && (
              <div className="truncate" style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: 1 }}>
                {toolSummary}
              </div>
            )}
          </div>
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            className="flex-shrink-0 transition-transform duration-200"
            style={{ transform: expanded ? "rotate(180deg)" : "none" }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Expanded tool list */}
        {expanded && (
          <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
            {events.map((event, i) => {
              const meta = TOOL_META[event.tool] ?? { label: event.tool, icon: "default" }
              const isBridge = meta.bridge === true
              const isOpen = expandedItems.has(event.id)
              const isLast = i === events.length - 1
              return (
                <div
                  key={event.id}
                  className="animate-fade-in"
                  style={{
                    borderBottom: isLast ? "none" : "1px solid var(--border-subtle)",
                    animationDelay: `${i * 20}ms`
                  }}
                >
                  <button
                    onClick={() => toggleItem(event.id)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 transition-all duration-100"
                    style={{ textAlign: "left" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                  >
                    {/* Per-tool icon */}
                    <span
                      className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                      style={{
                        color: isBridge ? "#818cf8" : event.success ? "var(--text-muted)" : "#ef4444",
                        opacity: 0.7
                      }}
                    >
                      <ToolIcon type={meta.icon} size={10} />
                    </span>
                    <span style={{
                      fontSize: "11px",
                      color: isBridge ? "#818cf8" : "var(--text-secondary)",
                      fontWeight: 400
                    }}>
                      {meta.label}
                    </span>
                    {!event.success && (
                      <span
                        className="px-1 py-0.5 rounded text-center"
                        style={{ fontSize: "8px", background: "rgba(239,68,68,0.1)", color: "#ef4444", lineHeight: 1 }}
                      >
                        failed
                      </span>
                    )}
                    <svg
                      width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--text-ghost)" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round"
                      className="ml-auto flex-shrink-0 transition-transform duration-150"
                      style={{ transform: isOpen ? "rotate(180deg)" : "none" }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {isOpen && (
                    <div
                      className="px-3 py-2 selectable animate-fade-in"
                      style={{
                        fontSize: "10px",
                        color: "var(--text-muted)",
                        fontFamily: "'JetBrains Mono', monospace",
                        lineHeight: "1.6",
                        wordBreak: "break-all",
                        borderTop: "1px solid var(--border-subtle)",
                        background: "var(--bg-base)",
                        maxHeight: "120px",
                        overflowY: "auto"
                      }}
                    >
                      {event.output || <span style={{ fontStyle: "italic", opacity: 0.5 }}>No output</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
