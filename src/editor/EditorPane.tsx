// src/editor/EditorPane.tsx
// Monaco editor with Luau LSP, Cmd+K inline edit, and tab bar

import { useEffect, useCallback, useState, useRef } from "react"
import Editor from "@monaco-editor/react"
import type * as Monaco from "monaco-editor"
import { useProjectStore } from "../stores/projectStore"
import { useIpcEvent } from "../hooks/useIpc"
import { InlineEditOverlay } from "../ai/InlineEditOverlay"
import { startLuauLanguageClient, stopLuauLanguageClient } from "./LuauLanguageClient"
import { registerLuauSnippets } from "./LuauSnippets"

// ── Theme ─────────────────────────────────────────────────────────────────────

let _snippetsRegistered = false

function defineEditorTheme(monaco: typeof Monaco): void {
  if (!_snippetsRegistered) {
    registerLuauSnippets(monaco)
    _snippetsRegistered = true
  }
  monaco.editor.defineTheme("luano-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment",    foreground: "3a5272", fontStyle: "italic" },
      { token: "keyword",    foreground: "6ba3f5" },
      { token: "string",     foreground: "7dd3a8" },
      { token: "number",     foreground: "c4a7fb" },
      { token: "identifier", foreground: "d4e2f4" },
      { token: "type",       foreground: "60b8ff" },
      { token: "function",   foreground: "8ec8fb" }
    ],
    colors: {
      "editor.background":                   "#080d18",
      "editor.foreground":                   "#d4e2f4",
      "editor.lineHighlightBackground":      "#0c1423",
      "editor.selectionBackground":          "#1d4ed840",
      "editor.inactiveSelectionBackground":  "#1a2d4530",
      "editorCursor.foreground":             "#2563eb",
      "editorLineNumber.foreground":         "#1e3050",
      "editorLineNumber.activeForeground":   "#3a5272",
      "editorIndentGuide.background":        "#111d30",
      "editorIndentGuide.activeBackground":  "#1a2d45",
      "editorWidget.background":             "#0c1423",
      "editorWidget.border":                 "#1a2d45",
      "editorSuggestWidget.background":      "#0c1423",
      "editorSuggestWidget.border":          "#1a2d45",
      "editorSuggestWidget.selectedBackground": "#152538",
      "input.background":                    "#080d18",
      "input.border":                        "#1a2d45",
      "scrollbarSlider.background":          "#1a2d4560",
      "scrollbarSlider.hoverBackground":     "#243f6280",
      "scrollbarSlider.activeBackground":    "#2563eb60",
      "diffEditor.insertedTextBackground":   "#10b98120",
      "diffEditor.removedTextBackground":    "#e11d4820"
    }
  })
}

// ── Platform key label ────────────────────────────────────────────────────────
// navigator.platform is deprecated but still the most reliable sync check
const isMac = typeof navigator !== "undefined" &&
  (navigator.platform.toLowerCase().includes("mac") ||
   navigator.userAgent.toLowerCase().includes("mac os"))

const KB_LABEL = isMac ? "⌘K" : "Ctrl+K"

// ── Component ─────────────────────────────────────────────────────────────────

export function EditorPane(): JSX.Element {
  const {
    openFiles, activeFile, fileContents, lspPort, dirtyFiles,
    closeFile, setActiveFile, updateFileContent, markClean
  } = useProjectStore()

  const [inlineEditOpen, setInlineEditOpen] = useState(false)
  const [closeConfirm, setCloseConfirm] = useState<string | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  // Keep a ref so the Monaco command callback always has the latest value
  const inlineEditOpenRef = useRef(false)
  inlineEditOpenRef.current = inlineEditOpen

  // ── LSP client lifecycle ───────────────────────────────────────────────────
  useEffect(() => {
    if (!lspPort) return

    let alive = true
    startLuauLanguageClient(lspPort).catch((err) => {
      console.warn("[LSP] Failed to start language client:", err)
    })

    return () => {
      alive = false
      if (!alive) stopLuauLanguageClient()
    }
  }, [lspPort])

  // ── Save on Ctrl+S ─────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!activeFile) return
    const content = useProjectStore.getState().fileContents[activeFile]
    if (content === undefined) return
    await window.api.writeFile(activeFile, content)
    markClean(activeFile)
  }, [activeFile, markClean])

  // ── Ctrl+S — save ─────────────────────────────────────────────────────────
  // (Ctrl+K is registered on the Monaco instance in handleEditorMount)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleSave])

  // ── Lint diagnostics (future: apply to Monaco markers) ────────────────────
  useIpcEvent("lint:diagnostics", (data) => {
    console.log("[lint] diagnostics:", data)
  })

  // ── Inline edit handlers ───────────────────────────────────────────────────
  const handleInlineAccept = useCallback(async (newContent: string) => {
    if (!activeFile) return
    updateFileContent(activeFile, newContent)
    await window.api.writeFile(activeFile, newContent)
    markClean(activeFile)
    setInlineEditOpen(false)
  }, [activeFile, updateFileContent, markClean])

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (activeFile && value !== undefined) {
        updateFileContent(activeFile, value)
      }
    },
    [activeFile, updateFileContent]
  )

  const handleEditorMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monacoInstance: typeof Monaco) => {
      editorRef.current = editor

      // Register Ctrl+K / Cmd+K directly on the Monaco instance.
      // This intercepts the keypress BEFORE Monaco's own Ctrl+K handler
      // (which normally triggers "Cut to end of line"), so it won't bubble
      // to the window handler and must be registered here.
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyK,
        () => {
          setInlineEditOpen(true)
        }
      )
    },
    []
  )

  // ── Empty state ────────────────────────────────────────────────────────────
  if (openFiles.length === 0) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center gap-2 animate-fade-in"
        style={{ color: "var(--text-muted)" }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.3 }}>
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </svg>
        <p className="text-xs">Open a file to edit</p>
        <p className="text-xs" style={{ color: "var(--text-ghost)", marginTop: "2px" }}>{KB_LABEL} — Inline AI Edit</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative" style={{ background: "var(--bg-base)" }}>
      {/* Tab bar */}
      <div
        className="flex items-end overflow-x-auto flex-shrink-0"
        style={{
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border-subtle)",
          minHeight: "34px"
        }}
      >
        {openFiles.map((path) => {
          const name = path.split(/[/\\]/).pop() ?? path
          const isActive = path === activeFile
          const isDirty = dirtyFiles.includes(path)

          // File icon color based on Roblox script type
          let dotColor = "#3a5272"
          if (name.endsWith(".lua") || name.endsWith(".luau")) {
            if (path.includes("/server/") || path.includes("\\server\\") ||
                name.includes(".server")) {
              dotColor = "#10b981" // server = green
            } else if (path.includes("/client/") || path.includes("\\client\\") ||
                       name.includes(".client")) {
              dotColor = "#3b82f6" // client = blue
            } else {
              dotColor = "#8b5cf6" // shared = purple
            }
          }

          return (
            <div
              key={path}
              className="relative flex items-center gap-1.5 px-3 cursor-pointer flex-shrink-0 transition-all duration-150 group"
              style={{
                height: "34px",
                fontSize: "12px",
                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                background: isActive ? "var(--bg-base)" : "transparent",
                borderRight: "1px solid var(--border-subtle)"
              }}
              onClick={() => setActiveFile(path)}
              onMouseEnter={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"
              }}
              onMouseLeave={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"
              }}
            >
              {/* Active top accent */}
              {isActive && (
                <span
                  className="absolute top-0 left-0 right-0 h-[2px] rounded-b-sm animate-fade-in"
                  style={{ background: "var(--accent)" }}
                />
              )}
              {/* Script type dot */}
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  background: dotColor,
                  boxShadow: isActive ? `0 0 4px ${dotColor}80` : "none"
                }}
              />
              <span className="leading-none">{name}</span>
              {/* Dirty indicator — shown when unsaved, hidden on hover to reveal × */}
              {isDirty && (
                <span
                  className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 group-hover:hidden"
                  style={{ color: "var(--accent)", fontSize: "14px", lineHeight: 1 }}
                >
                  ●
                </span>
              )}
              <button
                className={`w-3.5 h-3.5 flex items-center justify-center rounded transition-opacity duration-100 leading-none flex-shrink-0 ${isDirty ? "hidden group-hover:flex" : "opacity-0 group-hover:opacity-100"}`}
                style={{ color: "var(--text-muted)", fontSize: "11px" }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (dirtyFiles.includes(path)) {
                    setCloseConfirm(path)
                  } else {
                    closeFile(path)
                  }
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
              >
                ×
              </button>
            </div>
          )
        })}

        {/* Cmd+K hint — far right */}
        {activeFile && (
          <div
            className="ml-auto flex items-center px-3 flex-shrink-0"
            style={{ height: "34px", fontSize: "11px", color: "var(--text-ghost)" }}
          >
            <span
              className="px-1.5 py-0.5 rounded cursor-pointer transition-colors hover:text-[var(--text-muted)]"
              style={{ background: "var(--bg-surface)", letterSpacing: "0.3px" }}
              onClick={() => setInlineEditOpen(true)}
              title={`Inline AI Edit (${KB_LABEL})`}
            >
              {KB_LABEL}
            </span>
          </div>
        )}
      </div>

      {/* Monaco editor */}
      {activeFile && (
        <div className="flex-1 overflow-hidden">
          <Editor
            key={activeFile}
            height="100%"
            language="lua"
            theme="luano-dark"
            value={fileContents[activeFile] ?? ""}
            onChange={handleEditorChange}
            onMount={handleEditorMount}
            beforeMount={defineEditorTheme}
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              fontLigatures: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              lineNumbers: "on",
              renderLineHighlight: "line",
              tabSize: 2,
              insertSpaces: false,
              automaticLayout: true,
              padding: { top: 10, bottom: 10 },
              lineHeight: 22,
              smoothScrolling: true,
              cursorSmoothCaretAnimation: "on",
              cursorBlinking: "smooth",
              renderWhitespace: "none",
              bracketPairColorization: { enabled: true }
            }}
          />
        </div>
      )}

      {/* Inline edit overlay (Cmd+K) */}
      {inlineEditOpen && activeFile && (
        <InlineEditOverlay
          filePath={activeFile}
          content={fileContents[activeFile] ?? ""}
          onAccept={handleInlineAccept}
          onClose={() => setInlineEditOpen(false)}
        />
      )}

      {/* Close-with-unsaved-changes confirmation */}
      {closeConfirm && (() => {
        const fileName = closeConfirm.split(/[/\\]/).pop() ?? closeConfirm
        const handleSave = async () => {
          const content = useProjectStore.getState().fileContents[closeConfirm]
          if (content !== undefined) await window.api.writeFile(closeConfirm, content)
          markClean(closeConfirm)
          closeFile(closeConfirm)
          setCloseConfirm(null)
        }
        const handleDiscard = () => {
          closeFile(closeConfirm)
          setCloseConfirm(null)
        }
        return (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center animate-fade-in"
            style={{ background: "rgba(5,8,15,0.7)", backdropFilter: "blur(4px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setCloseConfirm(null) }}
          >
            <div
              className="rounded-xl overflow-hidden animate-slide-up"
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
                width: "340px"
              }}
            >
              <div className="px-5 pt-5 pb-3">
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Unsaved Changes
                </p>
                <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
                  Changes to <span style={{ color: "var(--text-secondary)" }}>{fileName}</span> will be lost if not saved.
                </p>
              </div>
              <div className="flex items-center gap-2 px-4 pb-4 pt-1">
                <button
                  onClick={handleSave}
                  className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
                  style={{ background: "var(--accent)", color: "white" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
                >
                  Save
                </button>
                <button
                  onClick={handleDiscard}
                  className="flex-1 py-1.5 rounded-lg text-xs transition-all duration-150"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"}
                >
                  Don't Save
                </button>
                <button
                  onClick={() => setCloseConfirm(null)}
                  className="flex-1 py-1.5 rounded-lg text-xs transition-all duration-150"
                  style={{ background: "transparent", color: "var(--text-muted)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
