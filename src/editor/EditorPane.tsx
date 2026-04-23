// src/editor/EditorPane.tsx
// Monaco editor with Luau LSP, Cmd+K inline edit, and tab bar

import "./monacoInit"
import { useEffect, useCallback, useState, useRef } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import Editor from "@monaco-editor/react"
import type * as Monaco from "monaco-editor"
import { useProjectStore } from "../stores/projectStore"
import { useSettingsStore } from "../stores/settingsStore"
import { useIpcEvent } from "../hooks/useIpc"
import { startLuauLanguageClient, stopLuauLanguageClient } from "./LuauLanguageClient"
import { registerLuauSnippets } from "./LuauSnippets"
import { getLanguageFromPath, registerCustomLanguages } from "./languages"
import { InlineEditOverlay } from "../lib/loadPro"
import { getFileName } from "../lib/utils"

// ── Theme ─────────────────────────────────────────────────────────────────────

let _snippetsRegistered = false

function defineEditorTheme(monaco: typeof Monaco): void {
  if (!_snippetsRegistered) {
    registerLuauSnippets(monaco)
    registerCustomLanguages(monaco)
    _snippetsRegistered = true
  }

  // Dark theme (VS Code style)
  monaco.editor.defineTheme("luano-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment",    foreground: "6a9955", fontStyle: "italic" },
      { token: "keyword",    foreground: "569cd6" },
      { token: "string",     foreground: "ce9178" },
      { token: "number",     foreground: "b5cea8" },
      { token: "identifier", foreground: "d4d4d4" },
      { token: "type",       foreground: "4ec9b0" },
      { token: "function",   foreground: "dcdcaa" }
    ],
    colors: {
      "editor.background":                   "#1e1e1e",
      "editor.foreground":                   "#d4d4d4",
      "editor.lineHighlightBackground":      "#252526",
      "editor.selectionBackground":          "#264f7840",
      "editor.inactiveSelectionBackground":  "#3a3d4130",
      "editorCursor.foreground":             "#569cd6",
      "editorLineNumber.foreground":         "#5a5a5a",
      "editorLineNumber.activeForeground":   "#c6c6c6",
      "editorIndentGuide.background":        "#404040",
      "editorIndentGuide.activeBackground":  "#707070",
      "editorWidget.background":             "#252526",
      "editorWidget.border":                 "#3e3e3e",
      "editorSuggestWidget.background":      "#252526",
      "editorSuggestWidget.border":          "#3e3e3e",
      "editorSuggestWidget.selectedBackground": "#2d2d2d",
      "input.background":                    "#1e1e1e",
      "input.border":                        "#3e3e3e",
      "scrollbarSlider.background":          "#4e4e4ea0",
      "scrollbarSlider.hoverBackground":     "#646464a0",
      "scrollbarSlider.activeBackground":    "#569cd660",
      "diffEditor.insertedTextBackground":   "#4ec9b020",
      "diffEditor.removedTextBackground":    "#f4474720"
    }
  })

  // Light theme
  monaco.editor.defineTheme("luano-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment",    foreground: "6a737d", fontStyle: "italic" },
      { token: "keyword",    foreground: "d73a49" },
      { token: "string",     foreground: "032f62" },
      { token: "number",     foreground: "005cc5" },
      { token: "identifier", foreground: "24292e" },
      { token: "type",       foreground: "6f42c1" },
      { token: "function",   foreground: "6f42c1" }
    ],
    colors: {
      "editor.background":                   "#ffffff",
      "editor.foreground":                   "#1a1a1a",
      "editor.lineHighlightBackground":      "#f5f5f5",
      "editor.selectionBackground":          "#2563eb25",
      "editor.inactiveSelectionBackground":  "#2563eb15",
      "editorCursor.foreground":             "#2563eb",
      "editorLineNumber.foreground":         "#9a9a9a",
      "editorLineNumber.activeForeground":   "#1a1a1a",
      "editorIndentGuide.background":        "#e0e0e0",
      "editorIndentGuide.activeBackground":  "#cccccc",
      "editorWidget.background":             "#f5f5f5",
      "editorWidget.border":                 "#cccccc",
      "editorSuggestWidget.background":      "#f5f5f5",
      "editorSuggestWidget.border":          "#cccccc",
      "editorSuggestWidget.selectedBackground": "#ebebeb",
      "input.background":                    "#ffffff",
      "input.border":                        "#cccccc",
      "scrollbarSlider.background":          "#cccccc80",
      "scrollbarSlider.hoverBackground":     "#aaaaaa80",
      "scrollbarSlider.activeBackground":    "#2563eb40",
      "diffEditor.insertedTextBackground":   "#16a34a18",
      "diffEditor.removedTextBackground":    "#dc262618"
    }
  })

  // Tokyo Night theme
  monaco.editor.defineTheme("luano-tokyo-night", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment",    foreground: "565f89", fontStyle: "italic" },
      { token: "keyword",    foreground: "9d7cd8" },
      { token: "string",     foreground: "9ece6a" },
      { token: "number",     foreground: "ff9e64" },
      { token: "identifier", foreground: "c0caf5" },
      { token: "type",       foreground: "2ac3de" },
      { token: "function",   foreground: "7aa2f7" }
    ],
    colors: {
      "editor.background":                   "#1a1b26",
      "editor.foreground":                   "#c0caf5",
      "editor.lineHighlightBackground":      "#1f2133",
      "editor.selectionBackground":          "#33467c50",
      "editor.inactiveSelectionBackground":  "#292e4230",
      "editorCursor.foreground":             "#7aa2f7",
      "editorLineNumber.foreground":         "#3b3f5c",
      "editorLineNumber.activeForeground":   "#737aa2",
      "editorIndentGuide.background":        "#292e42",
      "editorIndentGuide.activeBackground":  "#3b3f5c",
      "editorWidget.background":             "#1f2133",
      "editorWidget.border":                 "#363854",
      "editorSuggestWidget.background":      "#1f2133",
      "editorSuggestWidget.border":          "#363854",
      "editorSuggestWidget.selectedBackground": "#262840",
      "input.background":                    "#1a1b26",
      "input.border":                        "#363854",
      "scrollbarSlider.background":          "#363854a0",
      "scrollbarSlider.hoverBackground":     "#474a6ba0",
      "scrollbarSlider.activeBackground":    "#7aa2f760",
      "diffEditor.insertedTextBackground":   "#73daca20",
      "diffEditor.removedTextBackground":    "#f7768e20"
    }
  })
}

// ── Platform key label ────────────────────────────────────────────────────────
// navigator.platform is deprecated but still the most reliable sync check
const isMac = typeof navigator !== "undefined" &&
  (navigator.platform.toLowerCase().includes("mac") ||
   navigator.userAgent.toLowerCase().includes("mac os"))

const KB_LABEL = isMac ? "⌘K" : "Ctrl+K"

const isWagFile = (path: string | null | undefined): boolean =>
  !!(path && (path.includes("/wag/") || path.includes("\\wag\\")))

// ── Component ─────────────────────────────────────────────────────────────────

export function EditorPane(): JSX.Element {
  const {
    openFiles, activeFile, fileContents, lspPort, dirtyFiles,
    closeFile, setActiveFile, updateFileContent, reorderFiles
  } = useProjectStore()
  const appTheme = useSettingsStore((s) => s.theme)
  const autoSave = useSettingsStore((s) => s.autoSave)
  const autoSaveDelay = useSettingsStore((s) => s.autoSaveDelay)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const setFontSize = useSettingsStore((s) => s.setFontSize)
  const monacoTheme = appTheme === "tokyo-night" ? "luano-tokyo-night" : appTheme === "light" ? "luano-light" : "luano-dark"

  const [inlineEditOpen, setInlineEditOpen] = useState(false)
  /**
   * Captured at the moment Ctrl+K fires. If range is non-null, we're editing
   * just that selection; on accept we apply the AI output to that range via
   * Monaco.executeEdits. If range is null, it's a whole-file edit (fallback
   * behavior when the user has no selection).
   */
  const [inlineEditCtx, setInlineEditCtx] = useState<{
    text: string
    range: Monaco.IRange | null
  } | null>(null)
  const [previewMode, setPreviewMode] = useState(false)
  const [previewContent, setPreviewContent] = useState<string | null>(null) // null = use activeFile content
  const [splitFile, setSplitFile] = useState<string | null>(null)
  const [closeConfirm, setCloseConfirm] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragState = useRef<{
    srcIdx: number
    startX: number
    tabWidths: number[]
    tabLefts: number[]
    currentIdx: number
  } | null>(null)
  const tabBarRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  // Keep a ref so the Monaco command callback always has the latest value
  const inlineEditOpenRef = useRef(false)
  useEffect(() => { inlineEditOpenRef.current = inlineEditOpen }, [inlineEditOpen])

  // ── Chrome-style tab drag ─────────────────────────────────────────────────
  const handleTabMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest("button")) return

    const bar = tabBarRef.current
    if (!bar) return
    const tabs = bar.querySelectorAll<HTMLElement>("[data-tab-idx]")
    const tabWidths: number[] = []
    const tabLefts: number[] = []
    tabs.forEach((tab) => {
      const r = tab.getBoundingClientRect()
      tabWidths.push(r.width)
      tabLefts.push(r.left)
    })

    dragState.current = {
      srcIdx: idx,
      startX: e.clientX,
      tabWidths,
      tabLefts,
      currentIdx: idx
    }

    // Small threshold before activating drag (3px) to allow normal clicks
    const startX = e.clientX
    let activated = false

    const onMouseMove = (ev: MouseEvent) => {
      const ds = dragState.current
      if (!ds) return

      if (!activated) {
        if (Math.abs(ev.clientX - startX) < 3) return
        activated = true
        setIsDragging(true)
      }

      const deltaX = ev.clientX - ds.startX

      // Apply translateX to dragged tab
      const srcTab = tabs[ds.srcIdx] as HTMLElement | undefined
      if (srcTab) {
        srcTab.style.transform = `translateX(${deltaX}px)`
        srcTab.style.zIndex = "10"
        srcTab.style.transition = "none"
      }

      // Dragged tab center vs other tab edges (swap when center crosses boundary)
      const draggedCenter = ds.tabLefts[ds.srcIdx] + ds.tabWidths[ds.srcIdx] / 2 + deltaX
      let newIdx = ds.srcIdx
      for (let i = 0; i < ds.tabLefts.length; i++) {
        if (i === ds.srcIdx) continue
        const left = ds.tabLefts[i]
        const right = left + ds.tabWidths[i]
        if (i > ds.srcIdx && draggedCenter > left) newIdx = i
        if (i < ds.srcIdx && draggedCenter < right) newIdx = i
      }
      ds.currentIdx = newIdx

      // Shift other tabs to make room
      tabs.forEach((tab, i) => {
        if (i === ds.srcIdx) return
        let shift = 0
        if (ds.srcIdx < newIdx && i > ds.srcIdx && i <= newIdx) {
          // Source moved right → tabs in between shift left by source width
          shift = -ds.tabWidths[ds.srcIdx]
        } else if (ds.srcIdx > newIdx && i >= newIdx && i < ds.srcIdx) {
          // Source moved left → tabs in between shift right by source width
          shift = ds.tabWidths[ds.srcIdx]
        }
        tab.style.transform = shift ? `translateX(${shift}px)` : ""
        tab.style.transition = "transform 200ms ease"
      })
    }

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)

      const ds = dragState.current
      // Reset all transforms
      tabs.forEach((tab) => {
        tab.style.transform = ""
        tab.style.zIndex = ""
        tab.style.transition = ""
      })

      if (ds && activated && ds.srcIdx !== ds.currentIdx) {
        reorderFiles(ds.srcIdx, ds.currentIdx)
      }

      dragState.current = null
      setIsDragging(false)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [reorderFiles])

  // ── LSP client lifecycle ───────────────────────────────────────────────────
  // Defer the connection by one microtask so React StrictMode's synchronous
  // dev cleanup wins the race. Otherwise WS A opens and gets closed mid-
  // handshake by the cleanup, producing a Chromium "WebSocket is closed
  // before the connection is established" warning on every dev mount.
  useEffect(() => {
    if (!lspPort) return

    let alive = true
    queueMicrotask(() => {
      if (!alive) return
      startLuauLanguageClient(lspPort).catch((err) => {
        if (alive) console.warn("[LSP] Failed to start language client:", err)
      })
    })

    return () => {
      alive = false
      stopLuauLanguageClient()
    }
  }, [lspPort])

  // Reconnect when main restarts the luau-lsp process after a crash. The
  // bridge port is stable, so we just re-run the same start routine — it
  // tears down the dead WebSocket and brings up a fresh client.
  useIpcEvent("sidecar:lsp-ready", useCallback((data: unknown) => {
    const port = (data as { port?: number } | undefined)?.port
      ?? useProjectStore.getState().lspPort
    if (!port) return
    startLuauLanguageClient(port).catch((err) =>
      console.warn("[LSP] Reconnect failed:", err)
    )
  }, []))

  // ── Lazy content loading on session restore ─────────────────────────────────
  // projectStore persists openFiles + activeFile but NOT fileContents (too large
  // for localStorage). On restart the tabs are back but the content map is empty
  // until App.tsx's restore loop reads each file. That loop races with this
  // component's first render, which is why users see tabs with empty editors.
  // Backstop: any openFile lacking content gets read here, once, per path.
  useEffect(() => {
    for (const filePath of openFiles) {
      if (fileContents[filePath] !== undefined) continue
      // Fire-and-forget. updateFileContent marks dirty (side effect of the
      // existing setter), so we call the store directly to set content without
      // the dirty flag — a post-restore read is NOT a user edit.
      window.api.readFile(filePath).then((content) => {
        if (content === null || content === undefined) return
        useProjectStore.setState((state) => {
          // Skip if another path got loaded in parallel or file was closed.
          if (!state.openFiles.includes(filePath)) return state
          if (state.fileContents[filePath] !== undefined) return state
          return { fileContents: { ...state.fileContents, [filePath]: content } }
        })
      }).catch(() => { /* file deleted between sessions — skip */ })
    }
    // Depend on the OPEN-FILE LIST, not fileContents. Triggering this on every
    // fileContents change would re-scan on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiles])

  // ── Save helpers ────────────────────────────────────────────────────────────
  const saveFile = useCallback(async (path: string) => {
    const content = useProjectStore.getState().fileContents[path]
    if (content === undefined) return
    await window.api.writeFile(path, content)
    useProjectStore.getState().markClean(path)
  }, [])

  // ── Ctrl+S — manual save, Ctrl+=/- — font size ─────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        if (activeFile) saveFile(activeFile)
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault()
        const cur = useSettingsStore.getState().fontSize
        if (cur < 24) {
          setFontSize(cur + 1)
          editorRef.current?.updateOptions({ fontSize: cur + 1 })
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault()
        const cur = useSettingsStore.getState().fontSize
        if (cur > 10) {
          setFontSize(cur - 1)
          editorRef.current?.updateOptions({ fontSize: cur - 1 })
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [activeFile, saveFile, setFontSize])

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeContent = activeFile ? fileContents[activeFile] : undefined

  useEffect(() => {
    if (!autoSave || !activeFile || !dirtyFiles.includes(activeFile)) return

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => saveFile(activeFile), autoSaveDelay)

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [autoSave, autoSaveDelay, activeFile, dirtyFiles, activeContent, saveFile])

  // ── Lint diagnostics → Monaco markers ──────────────────────────────────────
  useIpcEvent("lint:diagnostics", useCallback((data: unknown) => {
    const m = monacoRef.current
    if (!m) return

    const { file, diagnostics } = data as {
      file: string
      diagnostics: Array<{ line: number; col: number; severity: string; message: string; code: string }>
    }

    // Find the model for this file (Monaco uses URI-based lookup)
    const models = m.editor.getModels()
    const model = models.find((mod) => {
      const path = mod.uri.path.replace(/^\//, "") // strip leading /
      return file.replace(/\\/g, "/").endsWith(path) || path.endsWith(file.replace(/\\/g, "/").split("/").pop()!)
    })
    if (!model) return

    const markers: Monaco.editor.IMarkerData[] = diagnostics.map((d) => {
      const sev = d.severity === "error"
        ? m.MarkerSeverity.Error
        : d.severity === "warning"
          ? m.MarkerSeverity.Warning
          : m.MarkerSeverity.Info
      return {
        severity: sev,
        message: `${d.message} (${d.code})`,
        startLineNumber: d.line,
        startColumn: d.col,
        endLineNumber: d.line,
        endColumn: d.col + 1,
        source: "selene"
      }
    })

    m.editor.setModelMarkers(model, "selene", markers)
  }, []))

  // ── Inline edit handlers ───────────────────────────────────────────────────
  const handleInlineAccept = useCallback(async (newContent: string) => {
    if (!activeFile) return
    const editor = editorRef.current
    if (inlineEditCtx?.range && editor) {
      // Selection edit: splice the new text into the original range and
      // leave the rest of the file untouched. executeEdits triggers Monaco's
      // onModelContentChange synchronously, which fires handleEditorChange
      // → updateFileContent — no explicit store write needed here.
      editor.executeEdits("inline-edit", [{
        range: inlineEditCtx.range,
        text: newContent,
        forceMoveMarkers: true,
      }])
    } else {
      // Whole-file fallback (no selection at Ctrl+K time). No editor edit,
      // so the store isn't updated for us — do it explicitly.
      updateFileContent(activeFile, newContent)
    }
    await saveFile(activeFile)
    setInlineEditOpen(false)
    setInlineEditCtx(null)
  }, [activeFile, inlineEditCtx, updateFileContent, saveFile])

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (activeFile && value !== undefined) {
        updateFileContent(activeFile, value)
      }
    },
    [activeFile, updateFileContent]
  )

  const handleSplitEditorChange = useCallback(
    (value: string | undefined) => {
      if (splitFile && value !== undefined) {
        updateFileContent(splitFile, value)
      }
    },
    [splitFile, updateFileContent]
  )

  // Close split if its file is closed
  useEffect(() => {
    if (splitFile && !openFiles.includes(splitFile)) setSplitFile(null)
  }, [openFiles, splitFile])

  // Default to preview mode for wag/ files, source mode for everything else
  useEffect(() => {
    setPreviewMode(!!(isWagFile(activeFile)))
    setPreviewContent(null)
  }, [activeFile])

  const handleEditorMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monacoInstance: typeof Monaco) => {
      editorRef.current = editor
      monacoRef.current = monacoInstance

      // Register Ctrl+K / Cmd+K directly on the Monaco instance.
      // This intercepts the keypress BEFORE Monaco's own Ctrl+K handler
      // (which normally triggers "Cut to end of line"), so it won't bubble
      // to the window handler and must be registered here.
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyK,
        () => {
          // Capture the selection NOW — if we read it later the user may have
          // moved the cursor. Empty selection → whole-file edit.
          const sel = editor.getSelection()
          const model = editor.getModel()
          if (sel && model && !sel.isEmpty()) {
            setInlineEditCtx({
              text: model.getValueInRange(sel),
              range: {
                startLineNumber: sel.startLineNumber,
                startColumn: sel.startColumn,
                endLineNumber: sel.endLineNumber,
                endColumn: sel.endColumn,
              },
            })
          } else {
            setInlineEditCtx({
              text: model?.getValue() ?? "",
              range: null,
            })
          }
          setInlineEditOpen(true)
        }
      )
    },
    []
  )

  // ── Empty state ────────────────────────────────────────────────────────────
  if (openFiles.length === 0) {
    const shortcuts: Array<{ keys: string; desc: string }> = [
      { keys: "Ctrl+P",       desc: "Quick open file" },
      { keys: "Ctrl+Shift+F", desc: "Search in files" },
      { keys: KB_LABEL,       desc: "Inline AI edit" },
      { keys: "Ctrl+`",       desc: "Toggle terminal" }
    ]
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center gap-3 animate-fade-in"
        style={{ color: "var(--text-secondary)" }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.4 }}>
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </svg>
        <p className="text-xs">Open a file to edit</p>
        <div
          className="grid gap-x-4 gap-y-1.5 mt-2 pt-3"
          style={{
            gridTemplateColumns: "auto auto",
            fontSize: "11px",
            color: "var(--text-muted)",
            borderTop: "1px solid var(--border-subtle)",
            minWidth: "220px"
          }}
        >
          {shortcuts.map(({ keys, desc }) => (
            <div key={keys} className="contents">
              <kbd
                className="justify-self-end px-1.5 py-0.5 rounded text-[10px] font-mono"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-secondary)"
                }}
              >
                {keys}
              </kbd>
              <span className="self-center">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative" style={{ background: "var(--bg-base)" }}>
      {/* Tab bar */}
      <div
        ref={tabBarRef}
        className="flex items-end overflow-x-auto flex-shrink-0"
        style={{
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border-subtle)",
          minHeight: "34px"
        }}
      >
        {openFiles.map((path, idx) => {
          const name = getFileName(path)
          const isActive = path === activeFile
          const isDirty = dirtyFiles.includes(path)

          // File icon color based on Roblox script type
          let dotColor = "var(--text-ghost)"
          if (name.endsWith(".lua") || name.endsWith(".luau")) {
            if (path.includes("/server/") || path.includes("\\server\\") ||
                name.includes(".server")) {
              dotColor = "var(--success)" // server = green
            } else if (path.includes("/client/") || path.includes("\\client\\") ||
                       name.includes(".client")) {
              dotColor = "var(--info)" // client = blue
            } else {
              dotColor = "var(--accent)" // shared = purple
            }
          }

          return (
            <div
              key={path}
              data-tab-idx={idx}
              onMouseDown={(e) => handleTabMouseDown(e, idx)}
              className={`relative flex items-center gap-1.5 px-3 flex-shrink-0 group select-none ${isDragging ? "" : "transition-all duration-150"}`}
              style={{
                height: "34px",
                fontSize: "12px",
                color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                background: isActive ? "var(--bg-base)" : "transparent",
                borderRight: "1px solid var(--border-subtle)",
                cursor: isDragging ? "grabbing" : "pointer"
              }}
              onClick={() => { if (!isDragging) setActiveFile(path) }}
              onMouseEnter={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"
              }}
              onMouseLeave={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"
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

      </div>

      {/* Split + Inline AI Edit buttons — pinned top-right.
          EditorPane's root is the positioning context (`relative`) and the outer
          flex layout already puts the chat panel beside us, so right: 0 hugs the
          editor/chat boundary. Older code subtracted `chatPanelWidth` here — that
          was for a legacy layout where the chat panel overlaid the editor. */}
      {activeFile && (
        <div
          data-tour="inline-edit-btn"
          className="absolute top-0 right-0 flex items-center gap-1 px-2 flex-shrink-0"
          style={{ height: "34px", zIndex: 10, background: "var(--bg-panel)" }}
        >
          {/* Markdown preview toggle (only for .md files) */}
          {isWagFile(activeFile) && (
            <button
              className="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150"
              style={{
                color: previewMode ? "var(--accent)" : "var(--text-muted)",
                background: previewMode ? "var(--accent-muted)" : "transparent"
              }}
              onClick={() => setPreviewMode(p => !p)}
              title="Preview Markdown"
              onMouseEnter={e => { if (!previewMode) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)" }}
              onMouseLeave={e => { if (!previewMode) (e.currentTarget as HTMLElement).style.color = "var(--text-muted)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
          {/* Split editor toggle */}
          <button
            className="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150"
            style={{
              color: splitFile ? "var(--accent)" : "var(--text-muted)",
              background: splitFile ? "var(--accent-muted)" : "transparent"
            }}
            onClick={() => {
              if (splitFile) setSplitFile(null)
              else if (activeFile) setSplitFile(activeFile)
            }}
            title="Split Editor"
            onMouseEnter={e => { if (!splitFile) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)" }}
            onMouseLeave={e => { if (!splitFile) (e.currentTarget as HTMLElement).style.color = "var(--text-muted)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="12" y1="3" x2="12" y2="21" />
            </svg>
          </button>
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer transition-all duration-150"
            style={{
              background: "var(--accent-muted)",
              border: "1px solid var(--accent)",
              color: "var(--accent)",
              fontSize: "11px",
              fontWeight: 500
            }}
            onClick={() => setInlineEditOpen(true)}
            title={`Inline AI Edit (${KB_LABEL})`}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "var(--accent)"
              ;(e.currentTarget as HTMLElement).style.color = "white"
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "var(--accent-muted)"
              ;(e.currentTarget as HTMLElement).style.color = "var(--accent)"
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            {KB_LABEL}
          </button>
        </div>
      )}

      {/* Markdown preview (wag/ files) */}
      {activeFile && previewMode && (activeFile.includes("/wag/") || activeFile.includes("\\wag\\")) && (
        <div
          className="flex-1 overflow-auto p-5 markdown-body selectable"
          style={{ fontSize: "13px", lineHeight: "1.7", color: "var(--text-primary)", background: "var(--bg-base)" }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a({ href, children }) {
                if (href?.startsWith("wag://")) {
                  const wagPath = href.slice(6)
                  return (
                    <a
                      href="#"
                      style={{ color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }}
                      onClick={e => {
                        e.preventDefault()
                        // Path traversal guard: reject paths with .. or absolute segments
                        if (/\.\./.test(wagPath) || /^[/\\]/.test(wagPath)) return
                        const { projectPath } = useProjectStore.getState()
                        if (!projectPath) return
                        window.api.readFile(`${projectPath}/wag/${wagPath}.md`)
                          .then((content: string) => setPreviewContent(content))
                          .catch(() => setPreviewContent(`*Entity not found: ${wagPath}*`))
                      }}
                    >
                      {children}
                    </a>
                  )
                }
                return <a href={href} target="_blank" rel="noreferrer">{children}</a>
              }
            }}
          >
            {(previewContent ?? fileContents[activeFile] ?? "").replace(/\[\[([^\]]+)\]\]/g, (_, path) => {
              const name = path.split("/").pop() ?? path
              return `[${name}](wag://${path})`
            })}
          </ReactMarkdown>
        </div>
      )}

      {/* Monaco editor(s) */}
      {activeFile && !previewMode && (
        <div className="flex-1 flex overflow-hidden">
          {/* Primary editor */}
          <div className="flex-1 overflow-hidden min-w-0">
            <Editor
              key={activeFile}
              height="100%"
              language={getLanguageFromPath(activeFile)}
              theme={monacoTheme}
              value={fileContents[activeFile] ?? ""}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              beforeMount={defineEditorTheme}
              options={{
                fontSize,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                fontLigatures: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "off",
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

          {/* Split editor */}
          {splitFile && (
            <>
              <div className="flex-shrink-0" style={{ width: "1px", background: "var(--border)" }} />
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {/* Split header */}
                <div
                  className="flex items-center justify-between px-3 flex-shrink-0"
                  style={{ height: "28px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <span className="text-[11px] truncate" style={{ color: "var(--text-secondary)" }}>
                    {getFileName(splitFile)}
                  </span>
                  <div className="flex items-center gap-1">
                    {/* File picker for split */}
                    <select
                      value={splitFile}
                      onChange={e => setSplitFile(e.target.value)}
                      className="text-[10px] rounded px-1 py-0.5"
                      style={{
                        background: "var(--bg-elevated)",
                        color: "var(--text-muted)",
                        border: "1px solid var(--border-subtle)",
                        outline: "none",
                        maxWidth: "120px"
                      }}
                    >
                      {openFiles.map(f => (
                        <option key={f} value={f}>{getFileName(f)}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setSplitFile(null)}
                      className="flex items-center justify-center w-5 h-5 rounded transition-colors"
                      style={{ color: "var(--text-muted)" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
                {/* Split Monaco */}
                <div className="flex-1 overflow-hidden">
                  <Editor
                    key={`split-${splitFile}`}
                    height="100%"
                    language={getLanguageFromPath(splitFile)}
                    theme={monacoTheme}
                    value={fileContents[splitFile] ?? ""}
                    onChange={handleSplitEditorChange}
                    beforeMount={defineEditorTheme}
                    options={{
                      fontSize,
                      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                      fontLigatures: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      wordWrap: "off",
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
              </div>
            </>
          )}
        </div>
      )}

      {/* Inline edit overlay (Cmd+K) — Pro only */}
      {inlineEditOpen && activeFile && inlineEditCtx && InlineEditOverlay && (
        <InlineEditOverlay
          filePath={activeFile}
          content={inlineEditCtx.text}
          isSelection={inlineEditCtx.range !== null}
          onAccept={handleInlineAccept}
          onClose={() => { setInlineEditOpen(false); setInlineEditCtx(null) }}
        />
      )}

      {/* Close-with-unsaved-changes confirmation */}
      {closeConfirm && (() => {
        const fileName = getFileName(closeConfirm)
        const handleSave = async () => {
          await saveFile(closeConfirm)
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
