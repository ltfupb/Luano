import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react"
import { useProjectStore } from "./stores/projectStore"
import { useRojoStore } from "./stores/rojoStore"
import { useAIStore } from "./stores/aiStore"
import { useSettingsStore } from "./stores/settingsStore"
import { useIpcEvent } from "./hooks/useIpc"
import { Sidebar, SidePanel } from "./components/Sidebar"
import { QuickOpen } from "./components/QuickOpen"
import { FileExplorer } from "./explorer/FileExplorer"
import { StatusBar } from "./components/StatusBar"
import { WelcomeScreen } from "./components/WelcomeScreen"
import { AppTitlebar } from "./components/AppTitlebar"
import { ConfirmDialog } from "./components/ConfirmDialog"

// Heavy panels — lazy-loaded to keep cold start fast. Each panel only mounts
// once the user actually opens it.
const EditorPane = lazy(() => import("./editor/EditorPane").then((m) => ({ default: m.EditorPane })))
const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((m) => ({ default: m.SettingsPanel })))
const ToolchainPanel = lazy(() => import("./toolchain/ToolchainPanel").then((m) => ({ default: m.ToolchainPanel })))
const SearchPanel = lazy(() => import("./components/SearchPanel").then((m) => ({ default: m.SearchPanel })))
const ChatPanel = lazy(() => import("./ai/ChatPanel").then((m) => ({ default: m.ChatPanel })))
const SyncPanel = lazy(() => import("./sync/SyncPanel").then((m) => ({ default: m.SyncPanel })))
const TerminalPane = lazy(() => import("./terminal/TerminalPane").then((m) => ({ default: m.TerminalPane })))
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

export default function App(): JSX.Element {
  const { projectPath, dirtyFiles, setProject, closeProject, setFileTree, openFile } = useProjectStore()
  const { setStatus, setPort, setToolName } = useRojoStore()
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
    window.api.setZoomFactor(uiScale / 100)
  }, [uiScale])
  const [activePanel, _setActivePanel] = useState<SidePanel>("explorer")
  const setActivePanel = useCallback((panel: SidePanel) => {
    _setActivePanel(panel)
    if (panel !== "analysis") setShowTopology(false)
  }, [])
  const rightPanelOpen = useSettingsStore((s) => s.rightPanelOpen)
  const setRightPanelOpen = useSettingsStore((s) => s.setRightPanelOpen)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toolchainOpen, setToolchainOpen] = useState(false)
  const [toolchainSetupMode, setToolchainSetupMode] = useState(false)
  const pendingProjectRef = useRef<{ path: string; isNew: boolean } | null>(null)

  // Allow StatusBar to open toolchain panel via custom event
  useEffect(() => {
    const handler = () => setToolchainOpen(true)
    window.addEventListener("open-toolchain", handler)
    return () => window.removeEventListener("open-toolchain", handler)
  }, [])
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
      const [tree, { globalSummary }, tcConfig] = await Promise.all([
        window.api.readDir(path),
        window.api.buildContext(path),
        window.api.toolchainGetConfig(path)
      ])
      const syncTool = tcConfig.selections.sync ?? "rojo"
      setToolName(syncTool === "argon" ? "Argon" : "Rojo")
      setProject(path, tree, lspPort)
      setGlobalSummary(globalSummary)
      addRecentProject(path)
      return true
    } catch (err) {
      console.error("[App] openProject failed:", err)
      return false
    }
  }, [setProject, setGlobalSummary, addRecentProject, setToolName])

  const handleToolchainClose = useCallback(async () => {
    setToolchainOpen(false)
    setToolchainSetupMode(false)
    const pending = pendingProjectRef.current
    if (pending) {
      pendingProjectRef.current = null
      // Now safe to close old project and open the pending one
      const currentPath = useProjectStore.getState().projectPath
      if (currentPath) useAIStore.getState().saveProjectChat(currentPath)
      closeProject()
      clearMessages()
      setGlobalSummary("")
      await openPath(pending.path)
      loadProjectChat(pending.path)
    }
  }, [openPath, loadProjectChat, closeProject, clearMessages, setGlobalSummary])

  // ── Session Restore — reopen last project + files on restart ────────────
  useEffect(() => {
    const { projectPath: savedPath, openFiles: savedOpenFiles } = useProjectStore.getState()
    if (!savedPath) return

    openPath(savedPath).then(async (ok) => {
      if (!ok) {
        closeProject()
        return
      }
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

  const [switchConfirm, setSwitchConfirm] = useState<{ action: "open" | "new" | "close"; path?: string } | null>(null)
  const [rojoSetup, setRojoSetup] = useState<string | null>(null)

  const switchToProject = useCallback(async (path: string, isNew: boolean) => {
    // Gate: check if minimum toolchain (luau-lsp) is installed BEFORE closing current project
    const ready = await window.api.toolchainIsMinimumReady()
    if (!ready) {
      if (isNew) await window.api.initProject(path)
      pendingProjectRef.current = { path, isNew }
      setToolchainSetupMode(true)
      setToolchainOpen(true)
      return
    }

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
      <AppTitlebar
        projectPath={projectPath}
        terminalOpen={terminalOpen}
        onNewProject={handleNewProject}
        onOpenFolder={handleOpenFolder}
        onCloseProject={handleCloseProject}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        onOpenToolchain={() => setToolchainOpen(true)}
      />

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
                <Suspense fallback={null}>
                  {activePanel === "explorer" && <FileExplorer />}
                  {activePanel === "search" && <SearchPanel />}
                  {activePanel === "sync" && <SyncPanel />}
                  {activePanel === "analysis" && <CrossScriptPanel onShowTopology={setShowTopology} />}
                  {activePanel === "datastore" && <DataStorePanel />}
                </Suspense>
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
              <Suspense fallback={null}>
                {projectPath && activePanel === "analysis" && showTopology ? (
                  <TopologyPanel />
                ) : projectPath ? (
                  <EditorPane />
                ) : (
                  <WelcomeScreen onOpenFolder={handleOpenFolder} onNewProject={handleNewProject} onOpenRecent={handleOpenRecent} />
                )}
              </Suspense>
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
            <ErrorBoundary>
              <Suspense fallback={null}>
                <TerminalPane
                  projectPath={projectPath}
                  height={terminalHeight}
                  onClose={() => setTerminalOpen(false)}
                />
              </Suspense>
            </ErrorBoundary>
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
                <Suspense fallback={null}>
                  <ChatPanel onClose={() => setRightPanelOpen(false)} />
                </Suspense>
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
      <ErrorBoundary>
        <Suspense fallback={null}>
          {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
          {toolchainOpen && <ToolchainPanel onClose={handleToolchainClose} mode={toolchainSetupMode ? "setup" : "normal"} />}
        </Suspense>
      </ErrorBoundary>
      {quickOpenVisible && <QuickOpen onClose={() => setQuickOpenVisible(false)} />}
      <ToastContainer />

      {/* Tutorial overlay */}
      {showTutorial && <TutorialOverlay onDone={() => setShowTutorial(false)} />}

      {switchConfirm && (
        <ConfirmDialog
          title={switchConfirm.action === "close" ? "Close Project" : "Switch Project"}
          body={
            <>
              You have <span style={{ color: "var(--accent)" }}>{dirtyFiles.length} unsaved file{dirtyFiles.length > 1 ? "s" : ""}</span> in the current project. Unsaved changes will be lost.
            </>
          }
          confirmLabel={switchConfirm.action === "close" ? "Close Anyway" : "Switch Anyway"}
          cancelLabel="Cancel"
          onConfirm={async () => {
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
          onCancel={() => setSwitchConfirm(null)}
        />
      )}

      {rojoSetup && (
        <ConfirmDialog
          title={t("rojoSetupTitle")}
          body={t("rojoSetupBody")}
          confirmLabel={t("rojoSetupConfirm")}
          cancelLabel={t("rojoSetupCancel")}
          width={400}
          onConfirm={async () => {
            const path = rojoSetup
            setRojoSetup(null)
            await switchToProject(path, true)
          }}
          onCancel={async () => {
            const path = rojoSetup
            setRojoSetup(null)
            await switchToProject(path, false)
          }}
        />
      )}
    </div>
  )
}
