import { useState, useEffect, useRef, useCallback } from "react"
import { useProjectStore } from "./stores/projectStore"
import { useRojoStore } from "./stores/rojoStore"
import { useAIStore } from "./stores/aiStore"
import { useSettingsStore } from "./stores/settingsStore"
import { useIpcEvent } from "./hooks/useIpc"
import { Sidebar, SidePanel } from "./components/Sidebar"
import { SettingsPanel } from "./components/SettingsPanel"
import { SearchPanel } from "./components/SearchPanel"
import { QuickOpen } from "./components/QuickOpen"
import { FileExplorer } from "./explorer/FileExplorer"
import { EditorPane } from "./editor/EditorPane"
import { ChatPanel } from "./ai/ChatPanel"
import { SyncPanel } from "./sync/SyncPanel"
import { TerminalPane } from "./terminal/TerminalPane"
import { StatusBar } from "./components/StatusBar"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { ToastContainer, toast } from "./components/Toast"
import { TutorialOverlay, shouldShowTutorial } from "./components/TutorialOverlay"
import { useT } from "./i18n/useT"
import { usePanelResize } from "./hooks/usePanelResize"
import { CrossScriptPanel, DataStorePanel, TopologyPanel } from "./lib/loadPro"

const TERMINAL_MIN = 80
const TERMINAL_MAX = 600

const SIDEPANEL_MIN = 150
const SIDEPANEL_MAX = 500

function IconChat(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function WelcomeScreen({
  onOpenFolder,
  onNewProject,
  onOpenRecent
}: {
  onOpenFolder: () => void
  onNewProject: () => void
  onOpenRecent: (path: string) => void
}): JSX.Element {
  const t = useT()
  const recentProjects = useSettingsStore((s) => s.recentProjects)
  const removeRecent = useSettingsStore((s) => s.removeRecentProject)

  return (
    <div className="flex-1 flex flex-col items-center justify-center animate-fade-in" style={{ gap: "32px" }}>
      {/* Header */}
      <div className="text-center" style={{ marginBottom: "8px" }}>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{t("welcome")}</h1>
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{t("welcomeSub")}</p>
      </div>

      {/* Action cards */}
      <div className="flex gap-3" style={{ maxWidth: "520px", width: "100%", padding: "0 24px" }}>
        {/* New Game */}
        <button
          onClick={onNewProject}
          className="flex-1 flex flex-col items-start gap-2 rounded-lg p-4 transition-all duration-150 text-left"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-surface)" }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-elevated)" }}
        >
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t("welcomeNewGame")}</span>
          </div>
          <span className="text-xs" style={{ color: "var(--text-muted)", lineHeight: "1.4" }}>{t("welcomeNewGameDesc")}</span>
        </button>

        {/* Open Existing */}
        <button
          onClick={onOpenFolder}
          className="flex-1 flex flex-col items-start gap-2 rounded-lg p-4 transition-all duration-150 text-left"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-surface)" }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-elevated)" }}
        >
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t("welcomeOpenProject")}</span>
          </div>
          <span className="text-xs" style={{ color: "var(--text-muted)", lineHeight: "1.4" }}>{t("welcomeOpenProjectDesc")}</span>
        </button>
      </div>

      {/* Recent projects */}
      <div style={{ maxWidth: "520px", width: "100%", padding: "0 24px" }}>
        <p className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>{t("welcomeRecentProjects")}</p>
        {recentProjects.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)", opacity: 0.5 }}>{t("welcomeNoRecent")}</p>
        ) : (
          <div className="flex flex-col rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {recentProjects.map((proj, i) => (
              <div
                key={proj.path}
                className="flex items-center justify-between px-3 py-2 transition-colors duration-100 cursor-pointer"
                style={{
                  background: "var(--bg-elevated)",
                  borderTop: i > 0 ? "1px solid var(--border-subtle)" : undefined
                }}
                onClick={() => onOpenRecent(proj.path)}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-surface)")}
                onMouseLeave={e => (e.currentTarget.style.background = "var(--bg-elevated)")}
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{proj.name}</span>
                  <span className="text-xs truncate" style={{ color: "var(--text-muted)", fontSize: "10px" }}>{proj.path}</span>
                </div>
                <button
                  className="ml-2 flex-shrink-0 p-1 rounded transition-colors duration-100"
                  style={{ color: "var(--text-muted)" }}
                  onClick={(e) => { e.stopPropagation(); removeRecent(proj.path) }}
                  onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                  title="Remove"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tip */}
      <div className="rounded-lg p-3" style={{ maxWidth: "520px", width: "100%", margin: "0 24px", background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
        <p className="text-xs font-medium mb-1" style={{ color: "var(--accent)" }}>{t("welcomeTipTitle")}</p>
        <p className="text-xs" style={{ color: "var(--text-muted)", lineHeight: "1.5" }}>{t("welcomeTipBody")}</p>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const { projectPath, dirtyFiles, setProject, closeProject, setFileTree, openFile } = useProjectStore()
  const { setStatus, setPort } = useRojoStore()
  const { setGlobalSummary, clearMessages, saveProjectChat, loadProjectChat } = useAIStore()
  const theme = useSettingsStore((s) => s.theme)
  const uiScale = useSettingsStore((s) => s.uiScale)
  const addRecentProject = useSettingsStore((s) => s.addRecentProject)
  const t = useT()

  // Apply theme and UI scale to document root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
  }, [theme])
  useEffect(() => {
    document.documentElement.style.zoom = `${uiScale}%`
  }, [uiScale])
  const [activePanel, _setActivePanel] = useState<SidePanel>("explorer")
  const setActivePanel = useCallback((panel: SidePanel) => {
    _setActivePanel(panel)
    if (panel !== "analysis") setShowTopology(false)
  }, [])
  const rightPanelOpen = useSettingsStore((s) => s.rightPanelOpen)
  const setRightPanelOpen = useSettingsStore((s) => s.setRightPanelOpen)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const terminalOpen = useSettingsStore((s) => s.terminalOpen)
  const setTerminalOpen = useSettingsStore((s) => s.setTerminalOpen)
  const [terminalHeight, _setTerminalHeight] = useState(() => useSettingsStore.getState().terminalHeight)
  const [sidePanelWidth, _setSidePanelWidth] = useState(() => useSettingsStore.getState().sidePanelWidth)
  const [chatPanelWidth, _setChatPanelWidth] = useState(() => useSettingsStore.getState().chatPanelWidth)
  const [quickOpenVisible, setQuickOpenVisible] = useState(false)
  const [showTopology, setShowTopology] = useState(false)
  const [showTutorial, setShowTutorial] = useState(() => shouldShowTutorial())

  // Sync layout to store on change
  const storeSetTerminalHeight = useSettingsStore((s) => s.setTerminalHeight)
  const storeSetSidePanelWidth = useSettingsStore((s) => s.setSidePanelWidth)
  const storeSetChatPanelWidth = useSettingsStore((s) => s.setChatPanelWidth)

  const setTerminalHeight: React.Dispatch<React.SetStateAction<number>> = useCallback((v) => {
    _setTerminalHeight((prev) => {
      const next = typeof v === "function" ? v(prev) : v
      storeSetTerminalHeight(next)
      return next
    })
  }, [storeSetTerminalHeight])
  const setSidePanelWidth: React.Dispatch<React.SetStateAction<number>> = useCallback((v) => {
    _setSidePanelWidth((prev) => {
      const next = typeof v === "function" ? v(prev) : v
      storeSetSidePanelWidth(next)
      return next
    })
  }, [storeSetSidePanelWidth])
  const setChatPanelWidth: React.Dispatch<React.SetStateAction<number>> = useCallback((v) => {
    _setChatPanelWidth((prev) => {
      const next = typeof v === "function" ? v(prev) : v
      storeSetChatPanelWidth(next)
      return next
    })
  }, [storeSetChatPanelWidth])

  // Panel resize hooks
  const handleResizeMouseDown = usePanelResize("y", TERMINAL_MIN, TERMINAL_MAX, setTerminalHeight, true)
  const handleSideResizeMouseDown = usePanelResize("x", SIDEPANEL_MIN, SIDEPANEL_MAX, setSidePanelWidth)
  const computeChatLimits = (w: number) => {
    const min = w >= 2560 ? 600 : w >= 1920 ? 450 : w >= 1280 ? 300 : 240
    const max = w >= 2560 ? 1200 : w >= 1920 ? 900 : w >= 1280 ? 600 : 480
    return { min, max }
  }
  const [chatPanelMin, setChatPanelMin] = useState(() => computeChatLimits(window.innerWidth).min)
  const [chatPanelMax, setChatPanelMax] = useState(() => computeChatLimits(window.innerWidth).max)
  useEffect(() => {
    const onResize = () => {
      const { min, max } = computeChatLimits(window.innerWidth)
      setChatPanelMin(min)
      setChatPanelMax(max)
      setChatPanelWidth((w) => Math.max(min, Math.min(w, max)))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [setChatPanelWidth])
  const handleChatResizeMouseDown = usePanelResize("x", chatPanelMin, chatPanelMax, setChatPanelWidth, true)

  useIpcEvent("rojo:status-changed", useCallback((...args: unknown[]) => {
    setStatus(args[0] as "stopped" | "starting" | "running" | "error")
    if (typeof args[1] === "number") setPort(args[1])
  }, [setStatus, setPort]))
  useIpcEvent("file:added", () => refreshFileTree())
  useIpcEvent("file:deleted", () => refreshFileTree())

  // ── Sidecar error toasts (LSP, StyLua, Selene) ──────────────────────────
  useIpcEvent("sidecar:error", useCallback((data: unknown) => {
    const { tool } = data as { tool: string; message: string }
    const labels: Record<string, string> = { "luau-lsp": "LSP", stylua: "StyLua", selene: "Selene" }
    toast(`${labels[tool] ?? tool} ${t("sidecarFailed")}`, "warn")
  }, [t]))

  const refreshFileTree = async () => {
    if (!projectPath) return
    const tree = await window.api.readDir(projectPath)
    setFileTree(tree)
  }

  const openPath = useCallback(async (path: string) => {
    try {
      const { success, lspPort } = await window.api.openProject(path)
      if (!success) return
      const [tree, { globalSummary }] = await Promise.all([
        window.api.readDir(path),
        window.api.buildContext(path)
      ])
      setProject(path, tree, lspPort)
      setGlobalSummary(globalSummary)
      addRecentProject(path)
      return true
    } catch (err) {
      console.error("[App] openProject failed:", err)
      return false
    }
  }, [setProject, setGlobalSummary, addRecentProject])

  // ── Session Restore — reopen last project + files on restart ────────────
  useEffect(() => {
    const { projectPath: savedPath, openFiles: savedOpenFiles } = useProjectStore.getState()
    if (!savedPath) return

    openPath(savedPath).then(async (ok) => {
      if (!ok) return
      // Reload previously open files
      for (const filePath of savedOpenFiles) {
        try {
          const content = await window.api.readFile(filePath)
          openFile(filePath, content ?? "")
        } catch { /* Skip if file was deleted */ }
      }
      // Restore chat history for this project
      loadProjectChat(savedPath)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Save chat + check unsaved on app exit ────────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const path = useProjectStore.getState().projectPath
      if (path) useAIStore.getState().saveProjectChat(path)
      const dirty = useProjectStore.getState().dirtyFiles
      if (dirty.length > 0) {
        e.preventDefault()
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)

    // Expose helpers for native quit confirmation dialog
    const w = window as unknown as Record<string, unknown>
    w.__luanoDirtyCount = () =>
      useProjectStore.getState().dirtyFiles.length
    w.__luanoSaveAll = async () => {
      const { dirtyFiles, fileContents, markClean } = useProjectStore.getState()
      for (const f of dirtyFiles) {
        const content = fileContents[f]
        if (content !== undefined) {
          await window.api.writeFile(f, content)
          markClean(f)
        }
      }
    }

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      delete w.__luanoDirtyCount
      delete w.__luanoSaveAll
    }
  }, [])

  // ── Offline Detection ────────────────────────────────────────────────────────
  useEffect(() => {
    const onOffline = () => toast(t("offlineWarning"), "warn")
    const onOnline = () => toast(t("onlineRestored"), "info")
    window.addEventListener("offline", onOffline)
    window.addEventListener("online", onOnline)
    return () => {
      window.removeEventListener("offline", onOffline)
      window.removeEventListener("online", onOnline)
    }
  }, [t])

  // ── Global Keyboard Shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+P — Quick file open
      if (ctrl && e.key === "p" && !e.shiftKey) {
        if (!projectPath) return
        e.preventDefault()
        setQuickOpenVisible((v) => !v)
        return
      }

      // Ctrl+Shift+F — Search in files
      if (ctrl && e.shiftKey && e.key === "F") {
        if (!projectPath) return
        e.preventDefault()
        setActivePanel("search")
        return
      }

      // Ctrl+W — Close current tab
      if (ctrl && e.key === "w" && !e.shiftKey) {
        const { activeFile, dirtyFiles: dirty, closeFile } = useProjectStore.getState()
        if (!activeFile) return
        e.preventDefault()
        if (dirty.includes(activeFile)) return // Skip dirty files (needs confirmation dialog)
        closeFile(activeFile)
        return
      }

      // Ctrl+` — Toggle terminal
      if (ctrl && e.key === "`") {
        if (!projectPath) return
        e.preventDefault()
        setTerminalOpen(!useSettingsStore.getState().terminalOpen)
        return
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [projectPath, setActivePanel, setTerminalOpen])

  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const [switchConfirm, setSwitchConfirm] = useState<{ action: "open" | "new" | "close"; path?: string } | null>(null)
  const [rojoSetup, setRojoSetup] = useState<string | null>(null)

  // Close file menu on outside click
  useEffect(() => {
    if (!fileMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false)
      }
    }
    window.addEventListener("mousedown", handler)
    return () => window.removeEventListener("mousedown", handler)
  }, [fileMenuOpen])

  const switchToProject = useCallback(async (path: string, isNew: boolean) => {
    // Save current project's chat before switching
    const currentPath = useProjectStore.getState().projectPath
    if (currentPath) saveProjectChat(currentPath)
    closeProject()
    clearMessages()
    setGlobalSummary("")
    if (isNew) await window.api.initProject(path)
    await openPath(path)
    // Load new project's chat history
    loadProjectChat(path)
  }, [closeProject, clearMessages, setGlobalSummary, openPath, saveProjectChat, loadProjectChat])

  const checkRojoAndOpen = async (path: string) => {
    let hasRojo = false
    try {
      await window.api.readFile(`${path}/default.project.json`)
      hasRojo = true
    } catch { /* no project file */ }
    if (!hasRojo) {
      setRojoSetup(path)
      return
    }
    await switchToProject(path, false)
  }

  const handleOpenFolder = async () => {
    const path = await window.api.openFolder()
    if (!path) return
    if (projectPath && dirtyFiles.length > 0) {
      setSwitchConfirm({ action: "open", path })
      return
    }
    await checkRojoAndOpen(path)
  }

  const handleNewProject = async () => {
    const path = await window.api.openFolder()
    if (!path) return
    if (projectPath && dirtyFiles.length > 0) {
      setSwitchConfirm({ action: "new", path })
      return
    }
    await switchToProject(path, true)
  }

  const handleCloseProject = () => {
    if (!projectPath) return
    if (dirtyFiles.length > 0) {
      setSwitchConfirm({ action: "close" })
      return
    }
    closeProject()
    clearMessages()
    setGlobalSummary("")
  }

  const handleOpenRecent = async (path: string) => {
    if (projectPath && dirtyFiles.length > 0) {
      setSwitchConfirm({ action: "open", path })
      return
    }
    await checkRojoAndOpen(path)
  }


  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      {/* Titlebar */}
      <div
        className="h-9 flex items-center px-2 flex-shrink-0 drag-region"
        style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-0.5">
          <div ref={fileMenuRef} className="relative">
            <button
              data-tour="file-btn"
              onClick={() => setFileMenuOpen((v) => !v)}
              className="px-2.5 h-7 flex items-center rounded-md text-xs transition-all duration-150"
              style={{ color: fileMenuOpen ? "var(--text-primary)" : "var(--text-secondary)", background: fileMenuOpen ? "var(--bg-elevated)" : "transparent" }}
              onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
              onMouseLeave={e => { if (!fileMenuOpen) { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" } }}
            >
              File
            </button>
            {fileMenuOpen && (
              <div
                className="absolute left-0 top-full mt-0.5 z-50 rounded-lg overflow-hidden animate-fade-in"
                style={{
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                  minWidth: "180px"
                }}
              >
                <button
                  onClick={() => { setFileMenuOpen(false); handleNewProject() }}
                  className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors duration-100"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
                  onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" }}
                >
                  {t("newProject")}
                </button>
                <button
                  onClick={() => { setFileMenuOpen(false); handleOpenFolder() }}
                  className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors duration-100"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
                  onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" }}
                >
                  {t("openFolder")}
                </button>
                {projectPath && (
                  <>
                    <div style={{ height: "1px", background: "var(--border-subtle)", margin: "2px 8px" }} />
                    <button
                      onClick={() => { setFileMenuOpen(false); handleCloseProject() }}
                      className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors duration-100"
                      style={{ color: "var(--text-secondary)" }}
                      onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
                      onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" }}
                    >
                      Close Project
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <button
            data-tour="settings-btn"
            onClick={() => setSettingsOpen(true)}
            className="px-2.5 h-7 flex items-center rounded-md text-xs transition-all duration-150"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
            onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" }}
          >
            Settings
          </button>
          {projectPath && (
            <button
              onClick={() => setTerminalOpen(!terminalOpen)}
              className="px-2.5 h-7 flex items-center rounded-md text-xs transition-all duration-150"
              style={{ color: terminalOpen ? "var(--text-primary)" : "var(--text-secondary)" }}
              onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
              onMouseLeave={e => { if (!terminalOpen) { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" } }}
            >
              Terminal
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0 relative">
        {/* Sidebar */}
        {projectPath && (
          <div data-tour="sidebar">
            <Sidebar
              activePanel={activePanel}
              onSelect={setActivePanel}
            />
          </div>
        )}

        {/* Left panel + resize handle */}
        {projectPath && (
          <>
            <div
              className="flex-shrink-0 flex flex-col overflow-hidden animate-slide-in-right"
              style={{ width: `${sidePanelWidth}px`, background: "var(--bg-panel)" }}
            >
              <ErrorBoundary>
                {activePanel === "explorer" && <FileExplorer />}
                {activePanel === "search" && <SearchPanel />}
                {activePanel === "sync" && <SyncPanel />}
                {activePanel === "analysis" && <CrossScriptPanel onShowTopology={setShowTopology} />}
                {activePanel === "datastore" && <DataStorePanel />}
              </ErrorBoundary>
            </div>
            <div
              onMouseDown={handleSideResizeMouseDown}
              className="flex-shrink-0 transition-colors duration-100"
              style={{
                width: "3px",
                cursor: "col-resize",
                background: "var(--border-subtle)"
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--border-subtle)"}
            />
          </>
        )}

        {/* Editor area (with optional terminal at bottom) */}
        <div data-tour="editor-area" className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
          {/* Main editor / topology */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            <ErrorBoundary>
              {projectPath && activePanel === "analysis" && showTopology ? (
                <TopologyPanel />
              ) : projectPath ? (
                <EditorPane />
              ) : (
                <WelcomeScreen onOpenFolder={handleOpenFolder} onNewProject={handleNewProject} onOpenRecent={handleOpenRecent} />
              )}
            </ErrorBoundary>
          </div>

          {/* Terminal resize handle */}
          {projectPath && terminalOpen && (
            <div
              onMouseDown={handleResizeMouseDown}
              className="flex-shrink-0 flex items-center justify-center transition-colors duration-100"
              style={{
                height: "5px",
                cursor: "row-resize",
                background: "var(--border-subtle)"
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--border-subtle)"}
            />
          )}

          {/* Terminal panel (bottom) */}
          {projectPath && terminalOpen && (
            <TerminalPane
              projectPath={projectPath}
              height={terminalHeight}
              onClose={() => setTerminalOpen(false)}
            />
          )}
        </div>

        {/* AI Chat panel + resize handle — overlays editor instead of pushing it */}
        {projectPath && rightPanelOpen && (
          <div
            className="absolute top-0 right-0 bottom-0 flex z-10"
            style={{ width: `${chatPanelWidth + 3}px` }}
          >
            <div
              onMouseDown={handleChatResizeMouseDown}
              className="flex-shrink-0 transition-colors duration-100"
              style={{
                width: "3px",
                cursor: "col-resize",
                background: "var(--border-subtle)"
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--border-subtle)"}
            />
            <div
              data-tour="chat-panel"
              className="flex-1 flex flex-col overflow-hidden animate-slide-in-right"
              style={{ background: "var(--bg-panel)" }}
            >
              <ErrorBoundary>
                <ChatPanel onClose={() => setRightPanelOpen(false)} />
              </ErrorBoundary>
            </div>
          </div>
        )}

        {/* Chat toggle when closed */}
        {projectPath && !rightPanelOpen && (
          <button
            className="w-8 flex-shrink-0 flex items-center justify-center transition-all duration-150"
            style={{ borderLeft: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}
            onClick={() => setRightPanelOpen(true)}
            title="Open AI Chat"
            onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-secondary)" }}
            onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-muted)" }}
          >
            <IconChat />
          </button>
        )}
      </div>

      <StatusBar />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {quickOpenVisible && <QuickOpen onClose={() => setQuickOpenVisible(false)} />}
      <ToastContainer />

      {/* Tutorial overlay */}
      {showTutorial && <TutorialOverlay onDone={() => setShowTutorial(false)} />}

      {/* Switch project confirmation (unsaved changes) */}
      {switchConfirm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center animate-fade-in"
          style={{ background: "rgba(5,8,15,0.7)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setSwitchConfirm(null) }}
        >
          <div
            className="rounded-xl overflow-hidden animate-slide-up"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
              width: "380px"
            }}
          >
            <div className="px-5 pt-5 pb-3">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {switchConfirm.action === "close" ? "Close Project" : "Switch Project"}
              </p>
              <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
                You have <span style={{ color: "var(--accent)" }}>{dirtyFiles.length} unsaved file{dirtyFiles.length > 1 ? "s" : ""}</span> in the current project. Unsaved changes will be lost.
              </p>
            </div>
            <div className="flex items-center gap-2 px-4 pb-4 pt-1">
              <button
                onClick={async () => {
                  const { path, action } = switchConfirm
                  setSwitchConfirm(null)
                  if (action === "close") {
                    closeProject()
                    clearMessages()
                    setGlobalSummary("")
                  } else if (path) {
                    await switchToProject(path, action === "new")
                  }
                }}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
                style={{ background: "var(--accent)", color: "white" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
              >
                {switchConfirm.action === "close" ? "Close Anyway" : "Switch Anyway"}
              </button>
              <button
                onClick={() => setSwitchConfirm(null)}
                className="flex-1 py-1.5 rounded-lg text-xs transition-all duration-150"
                style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rojo setup dialog */}
      {rojoSetup && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center animate-fade-in"
          style={{ background: "rgba(5,8,15,0.7)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setRojoSetup(null) }}
        >
          <div
            className="rounded-xl overflow-hidden animate-slide-up"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
              width: "400px"
            }}
          >
            <div className="px-5 pt-5 pb-3">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("rojoSetupTitle")}
              </p>
              <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
                {t("rojoSetupBody")}
              </p>
            </div>
            <div className="flex items-center gap-2 px-4 pb-4 pt-1">
              <button
                onClick={async () => {
                  const path = rojoSetup
                  setRojoSetup(null)
                  await switchToProject(path, true)
                }}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
                style={{ background: "var(--accent)", color: "white" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
              >
                {t("rojoSetupConfirm")}
              </button>
              <button
                onClick={async () => {
                  const path = rojoSetup
                  setRojoSetup(null)
                  await switchToProject(path, false)
                }}
                className="flex-1 py-1.5 rounded-lg text-xs transition-all duration-150"
                style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"}
              >
                {t("rojoSetupCancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
