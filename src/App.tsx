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
import { RojoPanel } from "./rojo/RojoPanel"
import { StudioPanel } from "./studio/StudioPanel"
import { TopologyPanel } from "./topology/TopologyPanel"
import { TerminalPane } from "./terminal/TerminalPane"
import { StatusBar } from "./components/StatusBar"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { ToastContainer, toast } from "./components/Toast"
import { TutorialOverlay, shouldShowTutorial } from "./components/TutorialOverlay"
import { CrossScriptPanel } from "./analysis/CrossScriptPanel"
import { DataStorePanel } from "./datastore/DataStorePanel"
import { useT } from "./i18n/useT"

const TERMINAL_MIN = 80
const TERMINAL_MAX = 600
const TERMINAL_DEFAULT = 220

const SIDEPANEL_MIN = 150
const SIDEPANEL_MAX = 500
const SIDEPANEL_DEFAULT = 224

function IconChat(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function EmptyEditor({
  onOpenFolder,
  onNewProject
}: {
  onOpenFolder: () => void
  onNewProject: () => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 animate-fade-in">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t("noProject")}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{t("noProjectHint")}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onNewProject}
          className="px-5 py-2 text-xs font-medium rounded-lg transition-all duration-150"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)" }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)" }}
        >
          {t("newProject")}
        </button>
        <button
          onClick={onOpenFolder}
          className="px-5 py-2 text-xs font-medium rounded-lg transition-all duration-150"
          style={{ background: "var(--accent)", color: "#1a1b26" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
        >
          {t("openFolder")}
        </button>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const { projectPath, openFiles, dirtyFiles, setProject, closeProject, setFileTree, openFile } = useProjectStore()
  const { setStatus, addLog } = useRojoStore()
  const { setGlobalSummary, clearMessages } = useAIStore()
  const theme = useSettingsStore((s) => s.theme)
  const t = useT()

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
  }, [theme])
  const [activePanel, setActivePanel] = useState<SidePanel>("explorer")
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(TERMINAL_DEFAULT)
  const [sidePanelWidth, setSidePanelWidth] = useState(SIDEPANEL_DEFAULT)
  const [quickOpenVisible, setQuickOpenVisible] = useState(false)
  const [showTutorial, setShowTutorial] = useState(() => shouldShowTutorial())

  // Terminal resize drag state
  const isDraggingRef = useRef(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)

  // Side panel resize drag state
  const isSideDraggingRef = useRef(false)
  const sideDragStartX = useRef(0)
  const sideDragStartW = useRef(0)

  useIpcEvent("rojo:status-changed", (status) => setStatus(status as never))
  useIpcEvent("rojo:log", (log) => addLog(log as string))
  useIpcEvent("file:added", () => refreshFileTree())
  useIpcEvent("file:removed", () => refreshFileTree())

  const refreshFileTree = async () => {
    if (!projectPath) return
    const tree = await window.api.readDir(projectPath)
    setFileTree(tree as never)
  }

  const openPath = useCallback(async (path: string) => {
    try {
      const { success, lspPort } = await window.api.openProject(path)
      if (!success) return
      const [tree, { globalSummary }] = await Promise.all([
        window.api.readDir(path),
        window.api.buildContext(path)
      ])
      setProject(path, tree as never, lspPort)
      setGlobalSummary(globalSummary)
      return true
    } catch (err) {
      console.error("[App] openProject failed:", err)
      return false
    }
  }, [setProject, setGlobalSummary])

  // ── 세션 복원 — 앱 재시작 시 마지막 프로젝트 + 열린 파일 복원 ────────────
  useEffect(() => {
    const { projectPath: savedPath, openFiles: savedOpenFiles } = useProjectStore.getState()
    if (!savedPath) return

    openPath(savedPath).then(async (ok) => {
      if (!ok) return
      // 이전에 열려 있던 파일들 내용 재로딩
      for (const filePath of savedOpenFiles) {
        try {
          const content = await window.api.readFile(filePath)
          openFile(filePath, content ?? "")
        } catch { /* 파일이 삭제된 경우 skip */ }
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 오프라인 감지 ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onOffline = () => toast(t("offlineWarning"), "warn")
    const onOnline = () => toast(t("onlineRestored"), "info")
    window.addEventListener("offline", onOffline)
    window.addEventListener("online", onOnline)
    return () => {
      window.removeEventListener("offline", onOffline)
      window.removeEventListener("online", onOnline)
    }
  }, [])

  // ── 전역 단축키 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+P — 빠른 파일 열기
      if (ctrl && e.key === "p" && !e.shiftKey) {
        if (!projectPath) return
        e.preventDefault()
        setQuickOpenVisible((v) => !v)
        return
      }

      // Ctrl+Shift+F — 파일 내 검색
      if (ctrl && e.shiftKey && e.key === "F") {
        if (!projectPath) return
        e.preventDefault()
        setActivePanel("search")
        return
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [projectPath])

  const [switchConfirm, setSwitchConfirm] = useState<{ action: "open" | "new"; path?: string } | null>(null)

  const switchToProject = useCallback(async (path: string, isNew: boolean) => {
    closeProject()
    clearMessages()
    setGlobalSummary("")
    if (isNew) await window.api.initProject(path)
    await openPath(path)
  }, [closeProject, clearMessages, setGlobalSummary, openPath])

  const handleOpenFolder = async () => {
    const path = await window.api.openFolder()
    if (!path) return
    if (projectPath && dirtyFiles.length > 0) {
      setSwitchConfirm({ action: "open", path })
      return
    }
    await switchToProject(path, false)
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

  // ── 터미널 리사이즈 드래그 ───────────────────────────────────────────────────
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    dragStartY.current = e.clientY
    dragStartH.current = terminalHeight

    const onMove = (mv: MouseEvent) => {
      if (!isDraggingRef.current) return
      const delta = dragStartY.current - mv.clientY
      setTerminalHeight(Math.max(TERMINAL_MIN, Math.min(TERMINAL_MAX, dragStartH.current + delta)))
    }
    const onUp = () => {
      isDraggingRef.current = false
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  // ── 사이드패널 리사이즈 드래그 ────────────────────────────────────────────────
  const handleSideResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isSideDraggingRef.current = true
    sideDragStartX.current = e.clientX
    sideDragStartW.current = sidePanelWidth

    const onMove = (mv: MouseEvent) => {
      if (!isSideDraggingRef.current) return
      const delta = mv.clientX - sideDragStartX.current
      setSidePanelWidth(Math.max(SIDEPANEL_MIN, Math.min(SIDEPANEL_MAX, sideDragStartW.current + delta)))
    }
    const onUp = () => {
      isSideDraggingRef.current = false
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      {/* Titlebar */}
      <div
        className="h-9 flex items-center px-2 flex-shrink-0 drag-region"
        style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-0.5">
          <button
            data-tour="file-btn"
            onClick={handleOpenFolder}
            className="px-2.5 h-7 flex items-center rounded-md text-xs transition-all duration-150"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-primary)" }}
            onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-secondary)" }}
          >
            File
          </button>
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
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar */}
        {projectPath && (
          <div data-tour="sidebar">
            <Sidebar
              activePanel={activePanel}
              onSelect={setActivePanel}
              terminalOpen={terminalOpen}
              onTerminalToggle={() => setTerminalOpen((v) => !v)}
            />
          </div>
        )}

        {/* Left panel + resize handle */}
        {projectPath && activePanel !== "topology" && (
          <>
            <div
              className="flex-shrink-0 flex flex-col overflow-hidden animate-slide-in-right"
              style={{ width: `${sidePanelWidth}px`, background: "var(--bg-panel)" }}
            >
              {activePanel === "explorer" && <FileExplorer />}
              {activePanel === "search" && <SearchPanel />}
              {activePanel === "rojo" && <RojoPanel />}
              {activePanel === "studio" && <StudioPanel />}
              {activePanel === "analysis" && <CrossScriptPanel />}
              {activePanel === "datastore" && <DataStorePanel />}
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
              {projectPath && activePanel === "topology" ? (
                <TopologyPanel />
              ) : projectPath ? (
                <EditorPane />
              ) : (
                <EmptyEditor onOpenFolder={handleOpenFolder} onNewProject={handleNewProject} />
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

        {/* AI Chat panel */}
        {projectPath && rightPanelOpen && (
          <div
            data-tour="chat-panel"
            className="w-80 flex-shrink-0 flex flex-col overflow-hidden animate-slide-in-right"
            style={{ borderLeft: "1px solid var(--border-subtle)" }}
          >
            <ErrorBoundary>
              <ChatPanel onClose={() => setRightPanelOpen(false)} />
            </ErrorBoundary>
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
                Switch Project
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
                  if (path) await switchToProject(path, action === "new")
                }}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
                style={{ background: "var(--accent)", color: "white" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
              >
                Switch Anyway
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
    </div>
  )
}
