// src/terminal/TerminalPane.tsx
// Integrated terminal using xterm.js + node-pty (via IPC)

import { useEffect, useRef, useState, useCallback } from "react"
import { Terminal } from "xterm"
import { FitAddon } from "xterm-addon-fit"
import { useSettingsStore } from "../stores/settingsStore"

// xterm CSS injected once via Vite-compatible dynamic import
let xtermCssLoaded = false
function ensureXtermStyles() {
  if (xtermCssLoaded) return
  xtermCssLoaded = true
  // xterm 5.x minimal styles
  const style = document.createElement("style")
  style.id = "xterm-styles"
  style.textContent = `
.xterm{font-feature-settings:"liga" 0;position:relative;user-select:none;-ms-user-select:none;-webkit-user-select:none}
.xterm.focus,.xterm:focus{outline:none}
.xterm .xterm-helpers{position:absolute;top:0;z-index:5}
.xterm .xterm-helper-textarea{padding:0;border:0;width:0;height:0;position:absolute;overflow:hidden;opacity:0;left:-9999em;top:0;white-space:nowrap;overflow:hidden;resize:none;-webkit-appearance:none}
.xterm .composition-view{background:#000;color:#fff;display:none;position:absolute;white-space:nowrap;z-index:1}
.xterm .composition-view.active{display:block}
.xterm .xterm-viewport{background-color:#000;overflow-y:scroll;cursor:default;position:absolute;right:0;left:0;top:0;bottom:0}
.xterm .xterm-screen{position:relative}
.xterm .xterm-screen canvas{position:absolute;left:0;top:0}
.xterm .xterm-scroll-area{visibility:hidden}
.xterm-char-measure-element{display:inline-block;visibility:hidden;position:absolute;top:0;left:-9999em;line-height:normal}
.xterm.enable-mouse-events{cursor:default}
.xterm.xterm-cursor-pointer,.xterm .xterm-cursor-pointer{cursor:pointer}
.xterm .xterm-accessibility:not(.debug),.xterm .xterm-message{position:absolute;left:0;top:0;bottom:0;right:0;z-index:10;color:transparent}
.xterm .live-region{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.xterm-dim{opacity:.5}
.xterm-underline-1{text-decoration:underline}
.xterm-strikethrough-1{text-decoration:line-through}
`
  if (!document.getElementById("xterm-styles")) {
    document.head.appendChild(style)
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TerminalPaneProps {
  projectPath: string | null
  onClose: () => void
  height: number
}

const TERMINAL_THEMES = {
  light: {
    background:   "#ffffff",
    foreground:   "#1a1a1a",
    cursor:       "#2563eb",
    cursorAccent: "#ffffff",
    black:        "#1a1a1a",
    brightBlack:  "#6b6b6b",
    red:          "#dc2626",
    brightRed:    "#ef4444",
    green:        "#16a34a",
    brightGreen:  "#22c55e",
    yellow:       "#ca8a04",
    brightYellow: "#eab308",
    blue:         "#2563eb",
    brightBlue:   "#3b82f6",
    magenta:      "#9333ea",
    brightMagenta:"#a855f7",
    cyan:         "#0891b2",
    brightCyan:   "#06b6d4",
    white:        "#e0e0e0",
    brightWhite:  "#f5f5f5",
  },
  dark: {
    background:   "#1e1e1e",
    foreground:   "#d4d4d4",
    cursor:       "#569cd6",
    cursorAccent: "#1e1e1e",
    black:        "#252526",
    brightBlack:  "#5a5a5a",
    red:          "#f44747",
    brightRed:    "#f48771",
    green:        "#4ec9b0",
    brightGreen:  "#73c991",
    yellow:       "#dcdcaa",
    brightYellow: "#e5c07b",
    blue:         "#569cd6",
    brightBlue:   "#6cb6ff",
    magenta:      "#c586c0",
    brightMagenta:"#d18ec2",
    cyan:         "#4fc1ff",
    brightCyan:   "#9cdcfe",
    white:        "#d4d4d4",
    brightWhite:  "#e8e8e8",
  },
  "tokyo-night": {
    background:   "#1a1b26",
    foreground:   "#c0caf5",
    cursor:       "#7aa2f7",
    cursorAccent: "#1a1b26",
    black:        "#1f2133",
    brightBlack:  "#444b6a",
    red:          "#f7768e",
    brightRed:    "#ff9a9e",
    green:        "#73daca",
    brightGreen:  "#9ece6a",
    yellow:       "#e0af68",
    brightYellow: "#ffcb6b",
    blue:         "#7aa2f7",
    brightBlue:   "#89b4fa",
    magenta:      "#bb9af7",
    brightMagenta:"#c8a8f7",
    cyan:         "#2ac3de",
    brightCyan:   "#7dcfff",
    white:        "#c0caf5",
    brightWhite:  "#e0e6f7",
  }
} as const

export function TerminalPane({ projectPath, onClose, height }: TerminalPaneProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<Terminal | null>(null)
  const fitRef       = useRef<FitAddon | null>(null)
  const termIdRef    = useRef<string | null>(null)
  const cleanupRef   = useRef<(() => void) | null>(null)
  const [, setReady]   = useState(false)
  const [exited, setExited] = useState(false)

  // ── Boot terminal ────────────────────────────────────────────────────────
  const boot = useCallback(async () => {
    // Run any previous cleanup
    cleanupRef.current?.()
    cleanupRef.current = null

    if (!containerRef.current) return

    ensureXtermStyles()

    const currentTheme = useSettingsStore.getState().theme
    const term = new Terminal({
      theme: TERMINAL_THEMES[currentTheme],
      fontFamily:  "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
      fontSize:    13,
      lineHeight:  1.4,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback:  5000,
      convertEol:  true,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    termRef.current = term
    fitRef.current  = fit
    setTimeout(() => fit.fit(), 50)

    setReady(false)
    setExited(false)

    // Create pty in main process
    const result = await window.api.terminalCreate(projectPath ?? undefined)
    const { id, error } = result as { id: string; error?: string }

    if (error || !id) {
      term.writeln(`\x1b[31mFailed to start terminal: ${error ?? "unknown error"}\x1b[0m`)
      return
    }

    termIdRef.current = id
    setReady(true)

    // pty data → xterm
    const unsubData = window.api.on(`terminal:data:${id}`, (data) => {
      term.write(data as string)
    })
    const unsubExit = window.api.on(`terminal:exit:${id}`, () => {
      term.writeln("\r\n\x1b[90m[process exited — click Restart to relaunch]\x1b[0m")
      setExited(true)
      termIdRef.current = null
    })

    // xterm keystrokes → pty
    const dataSub = term.onData((data) => {
      if (termIdRef.current) {
        window.api.terminalWrite(termIdRef.current, data)
      }
    })

    // Store cleanup
    cleanupRef.current = () => {
      unsubData()
      unsubExit()
      dataSub.dispose()
      if (termIdRef.current) {
        window.api.terminalKill(termIdRef.current)
        termIdRef.current = null
      }
      term.dispose()
      termRef.current = null
      fitRef.current  = null
    }
  }, [projectPath])

  // Boot on mount / project change
  useEffect(() => {
    void boot()
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [boot])

  // ── Fit on height change ────────────────────────────────────────────────
  const rafRef = useRef(0)

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      if (fitRef.current && termRef.current) {
        fitRef.current.fit()
        if (termIdRef.current) {
          const dims = fitRef.current.proposeDimensions()
          if (dims) {
            window.api.terminalResize(termIdRef.current, dims.cols, dims.rows)
          }
        }
      }
    })
  }, [height])

  const HEADER_H = 28

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col flex-shrink-0"
      style={{
        height: `${height}px`,
        background: "#080d18",
        borderTop: "1px solid var(--border-subtle)",
        overflow: "hidden"
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center gap-2 px-3 flex-shrink-0"
        style={{
          height: `${HEADER_H}px`,
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border-subtle)"
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.4px" }}>TERMINAL</span>

        <div className="ml-auto flex items-center" style={{ gap: "2px" }}>
          {exited && (
            <button
              onClick={boot}
              title="Restart terminal"
              className="flex items-center gap-1 rounded px-2 transition-all"
              style={{ height: "20px", fontSize: "11px", color: "var(--text-muted)", background: "transparent" }}
              onMouseEnter={e => { (e.currentTarget).style.color = "var(--text-secondary)"; (e.currentTarget).style.background = "var(--bg-elevated)" }}
              onMouseLeave={e => { (e.currentTarget).style.color = "var(--text-muted)"; (e.currentTarget).style.background = "transparent" }}
            >
              ↺ Restart
            </button>
          )}
          <button
            onClick={onClose}
            title="Close terminal"
            className="w-5 h-5 flex items-center justify-center rounded transition-all"
            style={{ fontSize: "14px", color: "var(--text-muted)", background: "transparent" }}
            onMouseEnter={e => { (e.currentTarget).style.color = "var(--text-secondary)"; (e.currentTarget).style.background = "var(--bg-elevated)" }}
            onMouseLeave={e => { (e.currentTarget).style.color = "var(--text-muted)"; (e.currentTarget).style.background = "transparent" }}
          >
            ×
          </button>
        </div>
      </div>

      {/* xterm.js container */}
      <div
        ref={containerRef}
        className="overflow-hidden"
        style={{ height: `${Math.max(0, height - HEADER_H)}px`, padding: "4px 8px" }}
        onClick={() => termRef.current?.focus()}
      />
    </div>
  )
}
