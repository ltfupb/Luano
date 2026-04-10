// src/sync/SyncPanel.tsx
// Combined Rojo + Studio Bridge panel

import { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { useRojoStore } from "../stores/rojoStore"
import { useProjectStore } from "../stores/projectStore"
import { useAIStore } from "../stores/aiStore"
import { useT } from "../i18n/useT"

// ── Types ─────────────────────────────────────────────────────────────────────

type SyncTab = "console" | "tree"

// ── Rojo status config ────────────────────────────────────────────────────────

const rojoStatusCfg: Record<string, { color: string; glow: boolean }> = {
  stopped:  { color: "var(--text-ghost)", glow: false },
  starting: { color: "var(--warning)", glow: false },
  running:  { color: "var(--success)", glow: true },
  error:    { color: "var(--danger)", glow: false }
}

// ── Log color ─────────────────────────────────────────────────────────────────

const logColor: Record<string, string> = {
  error:  "var(--danger)",
  warn:   "var(--warning)",
  output: "var(--text-secondary)"
}

// ── Script Runner overlay ─────────────────────────────────────────────────────

function ScriptRunner({ onClose, onRun }: {
  onClose: () => void
  onRun: (code: string) => Promise<{ id: string }>
}): JSX.Element {
  const [code, setCode] = useState('print("Hello from Luano!")')
  const [result, setResult] = useState<{ success: boolean; text: string } | null>(null)
  const [running, setRunning] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const handleRun = async () => {
    if (!code.trim() || running) return
    setRunning(true)
    setResult(null)
    const { id } = await onRun(code)
    let attempts = 0
    pollRef.current = setInterval(async () => {
      attempts++
      const res = await window.api.bridgeGetCommandResult(id)
      if (res !== null) {
        if (pollRef.current) clearInterval(pollRef.current)
        setResult({ success: res.success, text: res.result })
        setRunning(false)
      } else if (attempts > 15) {
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
        background: "rgba(5,8,15,0.7)", backdropFilter: "blur(4px)",
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
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>Run Script in Studio</span>
          <button
            onClick={onClose}
            style={{ fontSize: "16px", color: "var(--text-muted)", lineHeight: 1 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
          >✕</button>
        </div>
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
        {result && (
          <div
            className="mx-4 mb-3 px-3 py-2 rounded-md animate-fade-in selectable"
            style={{
              fontSize: "11px", fontFamily: "monospace", lineHeight: 1.5,
              color: result.success ? "var(--success)" : "var(--danger)",
              background: result.success ? "rgba(74,222,128,0.08)" : "rgba(251,113,133,0.08)",
              border: `1px solid ${result.success ? "rgba(74,222,128,0.2)" : "rgba(251,113,133,0.2)"}`,
              wordBreak: "break-all"
            }}
          >
            {result.success ? "✓ " : "✗ "}{result.text}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md transition-all duration-100"
            style={{ fontSize: "11px", color: "var(--text-muted)", background: "var(--bg-surface)" }}
          >Cancel</button>
          <button
            onClick={handleRun}
            disabled={running || !code.trim()}
            className="px-3 py-1.5 rounded-md transition-all duration-100 disabled:opacity-40"
            style={{ fontSize: "11px", fontWeight: 500, color: "white", background: "var(--accent)" }}
          >{running ? "Running…" : "▶ Run"}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Instance Tree (inline) ───────────────────────────────────────────────────

function getClassColor(className: string): string {
  if (className === "DataModel" || className === "game") return "var(--info)"
  if (className.endsWith("Service"))                    return "var(--accent)"
  if (className === "Script")                           return "var(--success)"
  if (className === "LocalScript")                      return "#34d399"
  if (className === "ModuleScript")                     return "#6ee7b7"
  if (className === "Model" || className === "Folder")  return "var(--text-secondary)"
  if (className.includes("Part") || className.includes("Mesh")) return "#fb923c"
  if (className.includes("Gui") || className.includes("Frame") || className.includes("Label")) return "#c084fc"
  if (className === "RemoteEvent" || className === "RemoteFunction") return "#f472b6"
  return "var(--text-muted)"
}

function TreeNode({ node, depth = 0 }: { node: BridgeInstanceNode; depth?: number }): JSX.Element {
  const [expanded, setExpanded] = useState(depth < 2)
  const hasChildren = (node.children?.length ?? 0) > 0
  const color = getClassColor(node.class)

  return (
    <div>
      <div
        className="flex items-center gap-1 py-[2px] cursor-pointer select-none rounded"
        style={{ paddingLeft: `${6 + depth * 11}px`, paddingRight: "6px" }}
        onClick={() => hasChildren && setExpanded(v => !v)}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
      >
        {hasChildren ? (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, transition: "transform 0.12s ease", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", color: "var(--text-muted)" }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        ) : <span style={{ width: 8, flexShrink: 0 }} />}
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "block", flexShrink: 0 }} />
        <span className="truncate" style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: 3 }} title={`${node.name} [${node.class}]`}>
          {node.name}
        </span>
        <span className="ml-auto" style={{ fontSize: "10px", color: "var(--text-ghost)", fontFamily: "monospace", flexShrink: 0 }}>
          {node.class !== node.name ? node.class : ""}
        </span>
      </div>
      {hasChildren && expanded && node.children!.map((child, i) => (
        <TreeNode key={`${child.name}-${i}`} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export function SyncPanel(): JSX.Element {
  const { status: rojoStatus, port } = useRojoStore()
  const { projectPath } = useProjectStore()
  const { globalSummary } = useAIStore()
  const t = useT()

  const [tab, setTab] = useState<SyncTab>("console")
  const [connected, setConnected] = useState(false)
  const [studioLogs, setStudioLogs] = useState<BridgeLogEntry[]>([])
  const [tree, setTree] = useState<BridgeInstanceNode | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [installMsg, setInstallMsg] = useState<string | null>(null)
  const [scriptRunnerOpen, setScriptRunnerOpen] = useState(false)
  const [aiExplanation, setAiExplanation] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const consoleScrollRef = useRef<HTMLDivElement>(null)

  const rcfg = rojoStatusCfg[rojoStatus] ?? rojoStatusCfg.stopped
  const isRojoActive = rojoStatus === "running" || rojoStatus === "starting"

  // ── Studio initial fetch ──────────────────────────────────────────────────
  useEffect(() => {
    window.api.bridgeIsConnected().then(setConnected)
    window.api.bridgeIsPluginInstalled().then(setInstalled)
    window.api.bridgeGetLogs().then(r => { if (Array.isArray(r)) setStudioLogs(r) })
    window.api.bridgeGetTree().then(r => { if (r === null || (r && "name" in r)) setTree(r as BridgeInstanceNode | null) })
  }, [])

  // ── Studio live push ──────────────────────────────────────────────────────
  useEffect(() => {
    const cleanup = window.api.on("bridge:update", (data: unknown) => {
      const update = data as {
        connected?: boolean
        newLogs?: BridgeLogEntry[]
        hasTree?: boolean
      }
      if (update.connected !== undefined) setConnected(update.connected)
      if (update.newLogs?.length) setStudioLogs(prev => [...prev, ...update.newLogs!].slice(-1000))
      if (update.hasTree) window.api.bridgeGetTree().then(setTree)
    })
    return cleanup
  }, [])

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab === "console" && consoleScrollRef.current) consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight
  }, [studioLogs, tab])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleRojoToggle = async () => {
    if (!projectPath) return
    if (isRojoActive) await window.api.rojoStop()
    else await window.api.rojoServe(projectPath)
  }

  const handleInstall = async () => {
    setInstalling(true)
    setInstallMsg(null)
    const result = await window.api.bridgeInstallPlugin()
    setInstalling(false)
    if (result.success) setInstalled(true)
    setInstallMsg(result.success ? `Installed: ${result.path}` : `Error: ${result.error}`)
    setTimeout(() => setInstallMsg(null), 5000)
  }

  const handleAiExplain = useCallback(async () => {
    const errors = studioLogs.filter(l => l.kind === "error").map(l => l.text).join("\n")
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
  }, [studioLogs, globalSummary, projectPath])

  const errorCount = studioLogs.filter(l => l.kind === "error").length

  const tabs: SyncTab[] = ["console", "tree"]
  const tabLabels: Record<SyncTab, string> = { console: "Console", tree: "Tree" }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-secondary)" }}>{t("sync")}</span>
      </div>

      {/* Status cards */}
      <div className="px-3 py-2 flex flex-col gap-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        {/* Rojo status */}
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: rcfg.color,
              boxShadow: rcfg.glow ? `0 0 6px ${rcfg.color}` : "none",
              transition: "all 0.3s ease"
            }}
          />
          <span style={{ fontSize: "11px", color: "var(--text-secondary)", flex: 1 }}>
            Rojo{rojoStatus === "running" && port && (
              <span style={{ color: "var(--text-muted)" }}>:{port}</span>
            )}
          </span>
          <button
            onClick={handleRojoToggle}
            className="px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-150"
            style={{
              background: isRojoActive ? "rgba(225,29,72,0.12)" : "rgba(37,99,235,0.12)",
              color: isRojoActive ? "var(--danger)" : "var(--info)",
              border: `1px solid ${isRojoActive ? "rgba(225,29,72,0.3)" : "rgba(37,99,235,0.3)"}`
            }}
          >
            {isRojoActive ? t("stop") : t("startServing")}
          </button>
        </div>

        {/* Studio status */}
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: connected ? "var(--success)" : "var(--text-ghost)",
              boxShadow: connected ? "0 0 6px var(--success)" : "none",
              transition: "all 0.3s ease"
            }}
          />
          <span style={{ fontSize: "11px", color: connected ? "var(--success)" : "var(--text-muted)", flex: 1 }}>
            Studio {connected ? "Live" : "Offline"}
          </span>
          {connected ? (
            <button
              onClick={() => setScriptRunnerOpen(true)}
              className="px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-150"
              style={{ background: "var(--accent-muted)", color: "var(--success)", border: "1px solid var(--border-subtle)" }}
            >
              ▶ Run
            </button>
          ) : !installed && (
            <button
              onClick={handleInstall}
              disabled={installing}
              className="px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-150 disabled:opacity-40"
              style={{ background: "var(--accent-muted)", color: "var(--info)", border: "1px solid var(--border-subtle)" }}
            >
              {installing ? "..." : "Install Plugin"}
            </button>
          )}
        </div>
        {installMsg && (
          <p className="animate-fade-in" style={{ fontSize: "10px", color: installMsg.startsWith("Error") ? "var(--danger)" : "var(--success)" }}>
            {installMsg}
          </p>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-0 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="relative flex-1 py-1.5 transition-colors duration-100"
            style={{ fontSize: "11px", color: tab === t ? "var(--text-primary)" : "var(--text-muted)", background: "transparent" }}
          >
            {tabLabels[t]}
            {tab === t && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: "var(--accent)" }} />
            )}
          </button>
        ))}

        {/* Tab toolbar */}
        <div className="flex items-center gap-1 pr-2">
          {tab === "console" && errorCount > 0 && (
            <button
              onClick={handleAiExplain}
              disabled={aiLoading}
              className="px-1.5 py-1 rounded transition-all duration-100 disabled:opacity-40"
              style={{ fontSize: "10px", color: "var(--info)" }}
              title="AI error analysis"
            >{aiLoading ? "…" : `AI (${errorCount})`}</button>
          )}
        </div>
      </div>

      {/* Tab content */}
      {tab === "console" && (
        <>
          <div ref={consoleScrollRef} className="flex-1 overflow-y-auto p-2 min-h-0 selectable">
            {studioLogs.length === 0 && (
              <div className="text-center py-8 animate-fade-in" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                {connected ? "Waiting for logs…" : "Logs will appear once Studio is connected"}
              </div>
            )}
            {studioLogs.map((entry, i) => (
              <div
                key={i}
                className="py-[1px] leading-relaxed break-all"
                style={{ fontSize: "11px", fontFamily: "monospace", color: logColor[entry.kind] }}
              >{entry.text}</div>
            ))}
          </div>

          {aiExplanation && (
            <div
              className="flex-shrink-0 max-h-40 overflow-y-auto animate-slide-up"
              style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}
            >
              <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--info)" }}>AI Analysis</span>
                <button onClick={() => setAiExplanation(null)} style={{ fontSize: "11px", color: "var(--text-muted)" }}>✕</button>
              </div>
              <div className="px-3 py-2 selectable whitespace-pre-wrap" style={{ fontSize: "11px", lineHeight: 1.6, color: "var(--text-primary)" }}>
                {aiExplanation}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "tree" && (
        <div className="flex-1 overflow-y-auto min-h-0 py-1">
          {tree ? (
            <TreeNode node={tree} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-8" style={{ color: "var(--text-muted)", fontSize: "11px" }}>
              Studio not connected
            </div>
          )}
        </div>
      )}

      {scriptRunnerOpen && (
        <ScriptRunner
          onClose={() => setScriptRunnerOpen(false)}
          onRun={(code) => window.api.bridgeRunScript(code)}
        />
      )}
    </div>
  )
}
