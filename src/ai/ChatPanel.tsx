import React, { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useAIStore, ChatMessage } from "../stores/aiStore"
import { useProjectStore } from "../stores/projectStore"
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
    sessionHandoff, startNewSession
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
  const [checkpointFiles, setCheckpointFiles] = useState<string[]>([])
  const [proFeatures, setProFeatures] = useState<Record<string, boolean>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const t = useT()

  // Load pro status
  useEffect(() => {
    window.api.getProStatus().then((s: { features: Record<string, boolean> }) => {
      setProFeatures(s.features ?? {})
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

  // Listen for checkpoint availability after agent completes
  useEffect(() => {
    if (typeof window.api.onCheckpointAvailable !== "function") return
    return window.api.onCheckpointAvailable((info) => {
      setCheckpointFiles(info.files)
    })
  }, [])

  const handleRevert = useCallback(async () => {
    if (typeof window.api.aiRevert !== "function") return
    const fileNames = checkpointFiles.map((f) => f.split(/[/\\]/).pop()).join(", ")
    const confirmed = window.confirm(`Revert ${checkpointFiles.length} file(s)?\n\n${fileNames}`)
    if (!confirmed) return
    const res = await window.api.aiRevert()
    if (res.success && res.reverted) {
      const names = res.reverted.map((f) => f.split(/[/\\]/).pop()).join(", ")
      addMessage({ role: "assistant", content: `Reverted ${res.reverted.length} file(s): ${names}` })
      setCheckpointFiles([])
    }
  }, [addMessage, checkpointFiles])

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
    sessionHandoff: sessionHandoff || undefined,
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

  const buildApiMessages = (userMsg: string) => {
    const history = messages
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }))
    history.push({ role: "user", content: userMsg })
    return history
  }

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
        }
      } catch (err) {
        updateMessage(assistantId, `Error: ${String(err)}`, false)
      } finally {
        setStreaming(false)
        setAgentRound(0)
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
  }, [input, isStreaming, planMode, proFeatures, addMessage, doSendChat, executeAgent])

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

  const blocked = isStreaming

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--bg-base)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-panel)" }}
      >
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>
          AI
        </span>

        {/* Bridge badge */}
        {bridgeConnected && (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded"
            title="Roblox Studio connected"
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

        {/* Revert button — shown when checkpoint is available */}
        {!isStreaming && checkpointFiles.length > 0 && (
          <button
            onClick={handleRevert}
            title={`Revert:\n${checkpointFiles.map((f) => f.split(/[/\\]/).pop()).join("\n")}`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-100"
            style={{
              fontSize: "10px",
              color: "#f87171",
              background: "rgba(248,113,113,0.1)",
              border: "1px solid rgba(248,113,113,0.3)"
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Revert ({checkpointFiles.length})
          </button>
        )}

        {/* Plan mode toggle */}
        <button
          onClick={() => setPlanMode(!planMode)}
          title={`Plan mode: ${planMode ? "ON" : "OFF"} — AI plans before executing`}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-100"
          style={{
            fontSize: "10px",
            color: planMode ? "#60a5fa" : "var(--text-muted)",
            background: planMode ? "rgba(96,165,250,0.12)" : "transparent",
            border: `1px solid ${planMode ? "rgba(96,165,250,0.3)" : "var(--border-subtle)"}`
          }}
        >
          <IconPlan />
          Plan
        </button>

        {/* Auto Accept toggle */}
        <button
          onClick={() => setAutoAccept(!autoAccept)}
          title={`Auto Accept: ${autoAccept ? "ON" : "OFF"} — auto-apply changes`}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-100"
          style={{
            fontSize: "10px",
            color: autoAccept ? "#10b981" : "var(--text-muted)",
            background: autoAccept ? "rgba(16,185,129,0.12)" : "transparent",
            border: `1px solid ${autoAccept ? "rgba(16,185,129,0.3)" : "var(--border-subtle)"}`
          }}
        >
          <IconLightning />
          {t("autoAccept")}
        </button>

        {/* Export chat */}
        {messages.length > 0 && !isStreaming && (
          <button
            onClick={() => {
              const path = useProjectStore.getState().projectPath
              const name = path?.split(/[/\\]/).pop() ?? "project"
              const exportMsgs = messages.filter((m) => !m.streaming).map((m) => ({ role: m.role, content: m.content }))
              window.api.chatExport(exportMsgs, name)
            }}
            title="Export chat as Markdown"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-100"
            style={{
              fontSize: "10px",
              color: "var(--text-muted)",
              border: "1px solid var(--border-subtle)"
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        )}

        {/* New Session */}
        {messages.length > 0 && !isStreaming && (
          <button
            onClick={() => startNewSession(useProjectStore.getState().projectPath ?? undefined)}
            title="Start new session (context carried over)"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-100"
            style={{
              fontSize: "10px",
              color: "var(--text-muted)",
              border: "1px solid var(--border-subtle)"
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New
          </button>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-md transition-all duration-100"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={e => { (e.currentTarget).style.color = "var(--text-secondary)"; (e.currentTarget).style.background = "var(--bg-elevated)" }}
          onMouseLeave={e => { (e.currentTarget).style.color = "var(--text-muted)"; (e.currentTarget).style.background = "transparent" }}
        >
          <IconClose />
        </button>
      </div>

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
              <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
                Use Agent mode for file edits
              </p>
            </div>
          </div>
        )}
        {displayMessages.map((msg) =>
          isToolMsg(msg) ? (
            <ToolCallBubble key={msg.id} event={msg} />
          ) : (
            <MessageBubble key={msg.id} message={msg} />
          )
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
          className="rounded-lg overflow-hidden transition-all duration-150"
          style={{ border: "1px solid var(--border)" }}
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
            className="w-full resize-none selectable focus:outline-none"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              fontSize: "12px",
              padding: "8px 10px 4px",
              lineHeight: "1.5",
              display: "block"
            }}
          />
          <div
            className="flex items-center justify-between px-2 py-1.5"
            style={{ background: "var(--bg-elevated)", borderTop: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center gap-2">
              <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                {"\u21B5"} send {planMode && " (read-only)"}
              </span>
              {/* Attach file button */}
              <button
                onClick={attachCurrentFile}
                disabled={!activeFile || !projectPath}
                title={activeFile ? `Attach ${activeFile.split(/[/\\]/).pop()}` : "Open a file first"}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-100 disabled:opacity-30"
                style={{ fontSize: "10px", color: "var(--text-muted)", border: "1px solid var(--border-subtle)" }}
                onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)" }}
                onMouseLeave={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.borderColor = "var(--border-subtle)" }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                Attach
              </button>
            </div>
            {blocked ? (
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
  const t = useT()

  return (
    <div
      className={`flex flex-col gap-1 animate-slide-up ${isUser ? "items-end" : "items-start"}`}
    >
      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
        {isUser ? t("me") : "Luano AI"}
      </span>

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

const TOOL_LABELS: Record<string, { label: string; bridge?: boolean }> = {
  read_file:            { label: "Read file" },
  edit_file:            { label: "Edit file" },
  create_file:          { label: "Create file" },
  delete_file:          { label: "Delete file" },
  list_files:           { label: "List files" },
  grep_files:           { label: "Search in files" },
  search_docs:          { label: "Search docs" },
  read_instance_tree:   { label: "Read instance tree", bridge: true },
  get_runtime_logs:     { label: "Get runtime logs",   bridge: true },
  run_studio_script:    { label: "Run Studio script",  bridge: true },
  set_property:         { label: "Set property",       bridge: true }
}

function ToolCallBubble({ event }: { event: ToolCallMessage }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const meta = TOOL_LABELS[event.tool] ?? { label: event.tool }
  const isBridge = meta.bridge === true

  return (
    <div className="animate-fade-in">
      <div
        className="rounded-lg overflow-hidden"
        style={{
          border: `1px solid ${isBridge ? "rgba(129,140,248,0.2)" : "var(--border-subtle)"}`,
          background: isBridge ? "rgba(129,140,248,0.04)" : "var(--bg-panel)"
        }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 w-full px-2.5 py-1.5 transition-colors duration-100"
          style={{ textAlign: "left" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
        >
          <span
            className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: event.success ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
              color: event.success ? "#10b981" : "#ef4444",
              fontSize: "9px"
            }}
          >
            {event.success ? "\u2713" : "\u2717"}
          </span>
          <span style={{ fontSize: "11px", color: isBridge ? "#818cf8" : "var(--text-secondary)", fontFamily: "monospace" }}>
            {meta.label}
          </span>
          <span
            className="ml-auto transition-transform duration-150"
            style={{ color: "var(--text-muted)", fontSize: "9px", transform: expanded ? "rotate(180deg)" : "none" }}
          >
            {"\u25BC"}
          </span>
        </button>
        {expanded && (
          <div
            className="px-2.5 py-2 selectable animate-fade-in"
            style={{
              fontSize: "11px",
              color: "var(--text-muted)",
              fontFamily: "monospace",
              lineHeight: "1.5",
              wordBreak: "break-all",
              borderTop: "1px solid var(--border-subtle)"
            }}
          >
            {event.output}
          </div>
        )}
      </div>
    </div>
  )
}
