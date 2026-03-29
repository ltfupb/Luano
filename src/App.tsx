import { useState, useEffect, useRef, useCallback } from "react"
import { useProjectStore } from "./stores/projectStore"
import { useRojoStore } from "./stores/rojoStore"
import { useAIStore } from "./stores/aiStore"
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
import { CrossScriptPanel } from "./analysis/CrossScriptPanel"
import { DataStorePanel } from "./datastore/DataStorePanel"
import { useT } from "./i18n/useT"

const TERMINAL_MIN = 80
const TERMINAL_MAX = 600
const TERMINAL_DEFAULT = 220

function IconSettings(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

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
        <div className="w-16 h-16 rounded-2xl bg-[#0c1423] border border-[#1a2d45] flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-[#e2e8f4]">{t("noProject")}</p>
          <p className="text-xs text-[#3a5272] mt-1">{t("noProjectHint")}</p>
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
          className="px-5 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-medium rounded-lg transition-all duration-150"
        >
          {t("openFolder")}
        </button>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const { projectPath, openFiles, setProject, setFileTree, openFile } = useProjectStore()
  const { setStatus, addLog } = useRojoStore()
  const { setGlobalSummary } = useAIStore()
  const t = useT()
  const [activePanel, setActivePanel] = useState<SidePanel>("explorer")
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(TERMINAL_DEFAULT)
  const [quickOpenVisible, setQuickOpenVisible] = useState(false)

  // Terminal resize drag state
  const isDraggingRef = useRef(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)

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

  const handleOpenFolder = async () => {
    const path = await window.api.openFolder()
    if (!path) return
    await openPath(path)
  }

  const handleNewProject = async () => {
    const path = await window.api.openFolder()
    if (!path) return
    await window.api.initProject(path)
    await openPath(path)
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

  const projectName = projectPath?.split(/[/\\]/).pop() ?? ""

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      {/* Titlebar */}
      <div
        className="h-9 flex items-center px-4 flex-shrink-0 drag-region"
        style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-[#2563eb] flex items-center justify-center flex-shrink-0" style={{ boxShadow: "0 0 8px rgba(37,99,235,0.5)" }}>
            <span className="text-white font-bold" style={{ fontSize: "9px", letterSpacing: "-0.5px" }}>LU</span>
          </div>
          <span className="text-xs font-semibold" style={{ color: "var(--text-primary)", letterSpacing: "0.3px" }}>
            Luano
          </span>
          {projectName && (
            <>
              <span style={{ color: "var(--border-strong)", fontSize: "12px" }}>/</span>
              <span className="text-xs truncate max-w-[180px]" style={{ color: "var(--text-secondary)" }}>
                {projectName}
              </span>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {!projectPath && (
            <button
              onClick={handleOpenFolder}
              className="px-3 py-1 text-xs rounded-md transition-all duration-150"
              style={{ color: "var(--text-secondary)", background: "transparent" }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = "var(--bg-elevated)"; (e.target as HTMLElement).style.color = "var(--text-primary)" }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = "transparent"; (e.target as HTMLElement).style.color = "var(--text-secondary)" }}
            >
              Open Folder
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => { (e.currentTarget).style.background = "var(--bg-elevated)"; (e.currentTarget).style.color = "var(--text-secondary)" }}
            onMouseLeave={e => { (e.currentTarget).style.background = "transparent"; (e.currentTarget).style.color = "var(--text-muted)" }}
          >
            <IconSettings />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar */}
        {projectPath && (
          <Sidebar
            activePanel={activePanel}
            onSelect={setActivePanel}
            terminalOpen={terminalOpen}
            onTerminalToggle={() => setTerminalOpen((v) => !v)}
          />
        )}

        {/* Left panel */}
        {projectPath && activePanel !== "topology" && (
          <div
            className="w-56 flex-shrink-0 flex flex-col overflow-hidden animate-slide-in-right"
            style={{ background: "var(--bg-panel)", borderRight: "1px solid var(--border-subtle)" }}
          >
            {activePanel === "explorer" && <FileExplorer />}
            {activePanel === "search" && <SearchPanel />}
            {activePanel === "rojo" && <RojoPanel />}
            {activePanel === "studio" && <StudioPanel />}
            {activePanel === "analysis" && <CrossScriptPanel />}
            {activePanel === "datastore" && <DataStorePanel />}
          </div>
        )}

        {/* Editor area (with optional terminal at bottom) */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
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
    </div>
  )
}
