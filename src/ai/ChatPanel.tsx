import { useState, useRef, useEffect, useCallback } from "react"
import { useAIStore, ChatMessage, AIMode } from "../stores/aiStore"
import { useProjectStore } from "../stores/projectStore"
import { CodeBlock } from "./CodeBlock"
import { useT } from "../i18n/useT"
import { useIpcEvent } from "../hooks/useIpc"

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

// ── Plan Card ─────────────────────────────────────────────────────────────────

interface PlanCardProps {
  steps: string[]
  isExecuting: boolean
  onConfirm: () => void
  onCancel: () => void
}

function PlanCard({ steps, isExecuting, onConfirm, onCancel }: PlanCardProps): JSX.Element {
  const t = useT()
  return (
    <div
      className="rounded-xl overflow-hidden animate-slide-up"
      style={{ border: "1px solid rgba(37,99,235,0.35)", background: "rgba(37,99,235,0.06)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid rgba(37,99,235,0.2)" }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "#60a5fa" }}>
          {t("planTitle")}
        </span>
      </div>

      {/* Steps */}
      <div className="px-3 py-2.5 flex flex-col gap-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span
              className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center"
              style={{ background: "rgba(37,99,235,0.2)", color: "#60a5fa", fontSize: "9px", fontWeight: 700, marginTop: 1 }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.55" }}>
              {step.replace(/^Step\s+\d+:\s*/i, "")}
            </span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderTop: "1px solid rgba(37,99,235,0.2)" }}
      >
        <button
          onClick={onConfirm}
          disabled={isExecuting}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "var(--accent)", color: "white" }}
          onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)" }}
          onMouseLeave={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = "var(--accent)" }}
        >
          {isExecuting ? (
            <span className="text-shimmer">{t("sending")}</span>
          ) : (
            <>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {t("planConfirm")}
            </>
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={isExecuting}
          className="px-3 py-1 rounded-md text-xs transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
          onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)" }}
          onMouseLeave={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)" }}
        >
          {t("planCancel")}
        </button>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

const MODES: AIMode[] = ["ask", "plan", "agent"]
const MODE_KEYS: Record<AIMode, "askMode" | "planMode" | "agentMode"> = {
  ask: "askMode",
  plan: "planMode",
  agent: "agentMode"
}

export function ChatPanel({ onClose }: ChatPanelProps): JSX.Element {
  const { messages, isStreaming, addMessage, updateMessage, setStreaming, globalSummary, mode, autoAccept, setMode, setAutoAccept } = useAIStore()
  const { projectPath, activeFile, fileContents } = useProjectStore()
  const [input, setInput] = useState("")
  const [toolMessages, setToolMessages] = useState<ToolCallMessage[]>([])
  const [bridgeConnected, setBridgeConnected] = useState(false)
  const [planSteps, setPlanSteps] = useState<string[] | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [pendingPlanMessages, setPendingPlanMessages] = useState<Array<{role: string; content: string}>>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const t = useT()

  useEffect(() => {
    window.api.bridgeIsConnected().then(setBridgeConnected)
  }, [])
  useIpcEvent("bridge:update", (data) => {
    const d = data as { connected?: boolean }
    if (typeof d.connected === "boolean") setBridgeConnected(d.connected)
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, toolMessages, planSteps, planLoading])

  const displayMessages: DisplayMessage[] = [...messages, ...toolMessages].sort((a, b) => {
    const aId = Number(a.id.replace(/\D/g, "").slice(0, 13))
    const bId = Number(b.id.replace(/\D/g, "").slice(0, 13))
    return aId - bId
  })

  const buildContext = () => ({
    globalSummary,
    currentFile: activeFile ?? undefined,
    currentFileContent: activeFile ? fileContents[activeFile] : undefined
  })

  const buildApiMessages = (userMsg: string) => {
    const history = messages
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }))
    history.push({ role: "user", content: userMsg })
    return history
  }

  // ── Execute agent with pre-built messages ────────────────────────────────
  const executeAgent = useCallback(
    async (apiMessages: Array<{role: string; content: string}>) => {
      const assistantId = addMessage({ role: "assistant", content: "", streaming: true })
      setStreaming(true)
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
            setToolMessages((prev) => [
              ...prev,
              {
                id: `tool-${Date.now()}-${Math.random()}`,
                type: "tool",
                tool: event.tool,
                success: event.success,
                output: event.output.slice(0, 200)
              }
            ])
          }
        )
        updateMessage(assistantId, accumulated, false)
        if (result.modifiedFiles.length > 0) {
          const names = result.modifiedFiles.map((f) => f.split(/[/\\]/).pop()).join(", ")
          updateMessage(assistantId, `${accumulated}\n\n✅ Modified: ${names}`, false)
        }
      } catch (err) {
        updateMessage(assistantId, `Error: ${String(err)}`, false)
      } finally {
        setStreaming(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, activeFile, fileContents, globalSummary]
  )

  // ── Ask mode (chat, no tools) ────────────────────────────────────────────
  const doSendAsk = useCallback(
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

  // ── Plan mode ────────────────────────────────────────────────────────────
  const doSendPlan = useCallback(
    async (apiMessages: Array<{role: string; content: string}>) => {
      setPlanLoading(true)
      try {
        const steps = await window.api.aiPlanChat(apiMessages, buildContext())
        setPlanSteps(steps)
        setPendingPlanMessages(apiMessages)
      } catch (err) {
        addMessage({ role: "assistant", content: `Error: ${String(err)}` })
      } finally {
        setPlanLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, activeFile, fileContents, globalSummary]
  )

  const confirmPlan = async () => {
    const savedMessages = pendingPlanMessages
    setPlanSteps(null)
    setPendingPlanMessages([])
    await executeAgent(savedMessages)
  }

  const cancelPlan = () => {
    setPlanSteps(null)
    setPendingPlanMessages([])
  }

  // ── Send dispatch ────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming || planLoading) return
    const userMsg = input.trim()
    setInput("")
    addMessage({ role: "user", content: userMsg })
    const apiMessages = buildApiMessages(userMsg)

    if (mode === "ask") {
      await doSendAsk(apiMessages)
    } else if (mode === "plan") {
      await doSendPlan(apiMessages)
    } else {
      await executeAgent(apiMessages)
    }
  }, [input, isStreaming, planLoading, mode, addMessage, doSendAsk, doSendPlan, executeAgent])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault()
      const idx = MODES.indexOf(mode)
      setMode(MODES[(idx + 1) % MODES.length])
      return
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

  const blocked = isStreaming || planLoading || planSteps !== null

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--bg-base)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-panel)" }}
      >
        {/* Mode pills */}
        <div
          className="flex items-center rounded-md p-0.5 gap-0.5"
          style={{ background: "var(--bg-elevated)" }}
        >
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              title={`${t(MODE_KEYS[m])} mode (Shift+Tab to cycle)`}
              className="px-2 py-0.5 rounded transition-all duration-100"
              style={{
                fontSize: "10px",
                fontWeight: mode === m ? 600 : 400,
                color: mode === m ? "var(--text-primary)" : "var(--text-muted)",
                background: mode === m ? "var(--bg-surface)" : "transparent",
                minWidth: 36,
                textAlign: "center"
              }}
            >
              {t(MODE_KEYS[m])}
            </button>
          ))}
        </div>

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

        {/* Auto Accept toggle */}
        <button
          onClick={() => setAutoAccept(!autoAccept)}
          title={`Auto Accept: ${autoAccept ? "ON" : "OFF"} — skips diff preview`}
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
        {messages.length === 0 && !planLoading && !planSteps && (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12 animate-fade-in">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
                <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2z" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                {mode === "ask" && "Ask anything about Luau / Roblox"}
                {mode === "plan" && "Describe what to build — AI will plan first"}
                {mode === "agent" && "Request edits — AI writes files directly"}
              </p>
              <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
                Shift+Tab to cycle modes
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

        {/* Plan loading */}
        {planLoading && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg animate-fade-in"
            style={{ background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.2)" }}
          >
            <span className="text-shimmer" style={{ fontSize: "11px" }}>{t("planThinking")}</span>
          </div>
        )}

        {/* Plan card */}
        {planSteps && (
          <PlanCard
            steps={planSteps}
            isExecuting={isStreaming}
            onConfirm={confirmPlan}
            onCancel={cancelPlan}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className="px-3 pt-2 pb-3 flex-shrink-0"
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
              mode === "ask"
                ? "Ask anything about Luau development..."
                : mode === "plan"
                ? "Describe what to build — AI will plan steps first..."
                : "Request file edits... (agent writes directly)"
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
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              ↵ {mode === "plan" ? "plan" : "send"} · Shift+Tab: cycle mode
            </span>
            <button
              onClick={sendMessage}
              disabled={blocked || !input.trim() || !projectPath}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: blocked ? "var(--bg-surface)" : "var(--accent)",
                color: "white",
                fontSize: "11px",
                fontWeight: 500
              }}
              onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)" }}
              onMouseLeave={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = blocked ? "var(--bg-surface)" : "var(--accent)" }}
            >
              {blocked ? (
                <span className="text-shimmer">{planLoading ? t("planThinking") : t("sending")}</span>
              ) : (
                <>
                  <IconSend />
                  {t(mode === "plan" ? "planMode" : "send")}
                </>
              )}
            </button>
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

function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.role === "user"
  const segments = isUser ? null : parseMessage(message.content)
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
                  <span className="animate-blink" style={{ color: "var(--accent)" }}>▌</span>
                )}
              </div>
            )
          )}
          {!segments?.length && message.streaming && (
            <div
              className="rounded-xl px-3 py-2"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
            >
              <span className="animate-blink" style={{ color: "var(--accent)" }}>▌</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tool call bubble ──────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, { label: string; bridge?: boolean }> = {
  read_file:            { label: "Read file" },
  edit_file:            { label: "Edit file" },
  create_file:          { label: "Create file" },
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
            {event.success ? "✓" : "✗"}
          </span>
          <span style={{ fontSize: "11px", color: isBridge ? "#818cf8" : "var(--text-secondary)", fontFamily: "monospace" }}>
            {meta.label}
          </span>
          <span
            className="ml-auto transition-transform duration-150"
            style={{ color: "var(--text-muted)", fontSize: "9px", transform: expanded ? "rotate(180deg)" : "none" }}
          >
            ▼
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
