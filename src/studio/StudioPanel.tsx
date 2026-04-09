import { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { useAIStore } from "../stores/aiStore"
import { useProjectStore } from "../stores/projectStore"
import { InstanceTree } from "./InstanceTree"

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = "console" | "tree"

// ── Log color ─────────────────────────────────────────────────────────────────
const logColor: Record<string, string> = {
  error:  "#fb7185",
  warn:   "#fbbf24",
  output: "var(--text-secondary)"
}

// ── Script Runner overlay ─────────────────────────────────────────────────────
interface ScriptRunnerProps {
  onClose: () => void
  onRun: (code: string) => Promise<{ id: string }>
}

function ScriptRunner({ onClose, onRun }: ScriptRunnerProps): JSX.Element {
  const [code, setCode] = useState('print("Hello from Luano!")')
  const [result, setResult] = useState<{ success: boolean; text: string } | null>(null)
  const [running, setRunning] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pendingId = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  // Cleanup on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const handleRun = async () => {
    if (!code.trim() || running) return
    setRunning(true)
    setResult(null)

    const { id } = await onRun(code)
    pendingId.current = id

    // Poll for result
    let attempts = 0
    pollRef.current = setInterval(async () => {
      attempts++
      const res = await window.api.bridgeGetCommandResult(id)
      if (res !== null) {
        if (pollRef.current) clearInterval(pollRef.current)
        setResult({ success: res.success, text: res.result })
        setRunning(false)
        pendingId.current = null
      } else if (attempts > 15) { // 7.5s timeout
        if (pollRef.current) clearInterval(pollRef.current)
        setResult({ success: false, text: "Timeout: Studio did not respond" })
        setRunning(false)
      }
    }, 500)
  }

  return createPortal(
    <div
      className="animate-fade-in"
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center"
      }}
    >
      <div
        ref={overlayRef}
        className="animate-slide-up"
        style={{
          width: 520, background: "var(--bg-elevated)",
          border: "1px solid var(--border)", borderRadius: 10,
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)", overflow: "hidden"
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>
            Run Script in Studio
          </span>
          <button
            onClick={onClose}
            style={{ fontSize: "16px", color: "var(--text-muted)", lineHeight: 1 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
          >
            ✕
          </button>
        </div>

        {/* Code area */}
        <div style={{ padding: "12px 16px" }}>
          <textarea
            value={code}
            onChange={e => setCode(e.target.value)}
            spellCheck={false}
            className="w-full selectable focus:outline-none resize-none"
            style={{
              fontFamily: "monospace", fontSize: "12px",
              background: "var(--bg-base)", color: "var(--text-primary)",
              border: "1px solid var(--border)", borderRadius: 6,
              padding: "10px 12px", lineHeight: 1.6, height: 140
            }}
            onFocus={e => (e.currentTarget).style.borderColor = "var(--accent)"}
            onBlur={e => (e.currentTarget).style.borderColor = "var(--border)"}
          />
        </div>

        {/* Result */}
        {result && (
          <div
            className="mx-4 mb-3 px-3 py-2 rounded-md animate-fade-in selectable"
            style={{
              fontSize: "11px", fontFamily: "monospace", lineHeight: 1.5,
              color: result.success ? "#4ade80" : "#fb7185",
              background: result.success ? "rgba(74,222,128,0.08)" : "rgba(251,113,133,0.08)",
              border: `1px solid ${result.success ? "rgba(74,222,128,0.2)" : "rgba(251,113,133,0.2)"}`,
              wordBreak: "break-all"
            }}
          >
            {result.success ? "✓ " : "✗ "}{result.text}
          </div>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md transition-all duration-100"
            style={{ fontSize: "11px", color: "var(--text-muted)", background: "var(--bg-surface)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
          >
            Cancel
          </button>
          <button
            onClick={handleRun}
            disabled={running || !code.trim()}
            className="px-3 py-1.5 rounded-md transition-all duration-100 disabled:opacity-40"
            style={{ fontSize: "11px", fontWeight: 500, color: "white", background: "var(--accent)" }}
            onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)" }}
            onMouseLeave={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = "var(--accent)" }}
          >
            {running ? "Running…" : "▶ Run"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Studio Panel ──────────────────────────────────────────────────────────────
export function StudioPanel(): JSX.Element {
  const [tab, setTab] = useState<Tab>("console")
  const [connected, setConnected] = useState(false)
  const [logs, setLogs] = useState<BridgeLogEntry[]>([])
  const [tree, setTree] = useState<BridgeInstanceNode | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installMsg, setInstallMsg] = useState<string | null>(null)
  const [scriptRunnerOpen, setScriptRunnerOpen] = useState(false)
  const [aiExplanation, setAiExplanation] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { globalSummary } = useAIStore()
  const { projectPath } = useProjectStore()

  // ── Initial fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    window.api.bridgeIsConnected().then(setConnected)
    window.api.bridgeGetLogs().then(r => { if (Array.isArray(r)) setLogs(r) })
    window.api.bridgeGetTree().then(r => { if (r === null || (r && "name" in r)) setTree(r as BridgeInstanceNode | null) })
  }, [])

  // ── Live push from bridge ──────────────────────────────────────────────────
  useEffect(() => {
    const cleanup = window.api.on("bridge:update", (data: unknown) => {
      const update = data as {
        connected?: boolean
        newLogs?: BridgeLogEntry[]
        hasTree?: boolean
        justConnected?: boolean
      }
      if (update.connected !== undefined) setConnected(update.connected)
      if (update.newLogs?.length) {
        setLogs(prev => [...prev, ...update.newLogs!].slice(-1000))
      }
      if (update.hasTree) {
        window.api.bridgeGetTree().then(setTree)
      }
    })
    return cleanup
  }, [])

  // Auto-scroll console
  useEffect(() => {
    if (tab === "console" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, tab])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleInstall = async () => {
    setInstalling(true)
    setInstallMsg(null)
    const result = await window.api.bridgeInstallPlugin()
    setInstalling(false)
    if (result.success) {
      setInstallMsg(`Installed: ${result.path}`)
    } else {
      setInstallMsg(`Error: ${result.error}`)
    }
    setTimeout(() => setInstallMsg(null), 5000)
  }

  const handleClearLogs = async () => {
    await window.api.bridgeClearLogs()
    setLogs([])
    setAiExplanation(null)
  }

  const handleRunScript = async (code: string) => {
    return window.api.bridgeRunScript(code)
  }

  const handleAiExplain = useCallback(async () => {
    const errors = logs.filter(l => l.kind === "error").map(l => l.text).join("\n")
    if (!errors) return
    setAiLoading(true)
    setAiExplanation(null)
    try {
      const result = await window.api.explainError(errors, { globalSummary, projectPath: projectPath ?? "" })
      setAiExplanation(result)
    } catch (err) {
      setAiExplanation(`Error: ${String(err)}`)
    } finally {
      setAiLoading(false)
    }
  }, [logs, globalSummary, projectPath])

  const errorCount = logs.filter(l => l.kind === "error").length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
          Studio
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* Connection dot */}
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{
              background: connected ? "#10b981" : "var(--text-ghost)",
              boxShadow: connected ? "0 0 6px #10b981" : "none",
              transition: "all 0.3s ease"
            }}
          />
          <span style={{ fontSize: "10px", color: connected ? "#10b981" : "var(--text-muted)" }}>
            {connected ? "Live" : "Offline"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center gap-0 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        {(["console", "tree"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="relative px-3 py-1.5 transition-colors duration-100"
            style={{
              fontSize: "11px",
              color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
              background: "transparent",
              borderRadius: 0
            }}
          >
            {t === "console" ? "Console" : "Tree"}
            {tab === t && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
            )}
          </button>
        ))}

        {/* Toolbar right */}
        <div className="ml-auto flex items-center gap-1 pr-2">
          {tab === "console" && errorCount > 0 && (
            <button
              onClick={handleAiExplain}
              disabled={aiLoading}
              className="px-1.5 py-1 rounded transition-all duration-100 disabled:opacity-40"
              style={{ fontSize: "10px", color: "#60a5fa" }}
              title="AI error analysis"
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(37,99,235,0.1)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
            >
              {aiLoading ? "…" : `AI (${errorCount})`}
            </button>
          )}

          {connected && (
            <button
              onClick={() => setScriptRunnerOpen(true)}
              className="w-6 h-6 flex items-center justify-center rounded transition-all duration-100"
              style={{ color: "var(--text-muted)", fontSize: "13px" }}
              title="Run script in Studio"
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)" }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.background = "transparent" }}
            >
              ▶
            </button>
          )}

          {tab === "console" && (
            <button
              onClick={handleClearLogs}
              className="w-6 h-6 flex items-center justify-center rounded transition-all duration-100"
              style={{ color: "var(--text-muted)", fontSize: "12px" }}
              title="Clear"
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)" }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.background = "transparent" }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Not connected banner */}
      {!connected && (
        <div className="flex-shrink-0 px-3 py-2 animate-fade-in" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div
            className="rounded-md px-3 py-2"
            style={{ background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.15)" }}
          >
            <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: 6 }}>
              Install the Studio plugin to connect.
            </p>
            <button
              onClick={handleInstall}
              disabled={installing}
              className="w-full py-1.5 rounded-md transition-all duration-150 disabled:opacity-40"
              style={{ fontSize: "11px", fontWeight: 500, color: "white", background: "var(--accent)" }}
              onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)" }}
              onMouseLeave={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = "var(--accent)" }}
            >
              {installing ? "Installing…" : "Install Plugin"}
            </button>
            {installMsg && (
              <p className="mt-1.5 animate-fade-in" style={{ fontSize: "10px", color: installMsg.startsWith("Error") ? "#fb7185" : "#4ade80" }}>
                {installMsg}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Console tab */}
      {tab === "console" && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 min-h-0 selectable">
            {logs.length === 0 && (
              <div className="text-center py-8 animate-fade-in" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                {connected ? "Waiting for logs…" : "Logs will appear once Studio is connected"}
              </div>
            )}
            {logs.map((entry, i) => (
              <div
                key={i}
                className="py-[1px] leading-relaxed break-all"
                style={{ fontSize: "11px", fontFamily: "monospace", color: logColor[entry.kind] }}
              >
                {entry.text}
              </div>
            ))}
          </div>

          {/* AI explanation */}
          {aiExplanation && (
            <div
              className="flex-shrink-0 max-h-40 overflow-y-auto animate-slide-up"
              style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}
            >
              <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#60a5fa" }}>AI Analysis</span>
                <button
                  onClick={() => setAiExplanation(null)}
                  style={{ fontSize: "11px", color: "var(--text-muted)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
                >
                  ✕
                </button>
              </div>
              <div className="px-3 py-2 selectable whitespace-pre-wrap" style={{ fontSize: "11px", lineHeight: 1.6, color: "var(--text-primary)" }}>
                {aiExplanation}
              </div>
            </div>
          )}
        </>
      )}

      {/* Tree tab */}
      {tab === "tree" && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <InstanceTree tree={tree} />
        </div>
      )}

      {scriptRunnerOpen && (
        <ScriptRunner
          onClose={() => setScriptRunnerOpen(false)}
          onRun={handleRunScript}
        />
      )}
    </div>
  )
}
