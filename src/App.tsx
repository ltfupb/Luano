import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react"
import { useProjectStore } from "./stores/projectStore"
import { useSyncStore } from "./stores/syncStore"
import { useAIStore } from "./stores/aiStore"
import { useSettingsStore } from "./stores/settingsStore"
import { useIpcEvent } from "./hooks/useIpc"
import { Sidebar, SidePanel } from "./components/Sidebar"
import { QuickOpen } from "./components/QuickOpen"
import { FileExplorer } from "./explorer/FileExplorer"
import { StatusBar } from "./components/StatusBar"
import { UpdateBanner } from "./components/UpdateBanner"
import { WelcomeScreen } from "./components/WelcomeScreen"
import { AppTitlebar } from "./components/AppTitlebar"
import { ConfirmDialog } from "./components/ConfirmDialog"
import { CommandPalette, type Command } from "./components/CommandPalette"

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
import { ProOnboardingOverlay, shouldShowProOnboarding, markProOnboardingDone } from "./components/ProOnboardingOverlay"
import { useT } from "./i18n/useT"
import { usePanelResize } from "./hooks/usePanelResize"
import { CrossScriptPanel, DataStorePanel, TopologyPanel } from "./lib/loadPro"
import { initPostHog } from "./analytics"

const TERMINAL_MIN = 80
const TERMINAL_MAX = 600

const SIDEPANEL_MIN = 150
const SIDEPANEL_MAX = 500

interface CommandContext {
  projectPath: string | null
  hasProject: boolean
  openSettings: () => void
  openToolchain: () => void
  openFolder: () => void
  newProject: () => void
  closeProject: () => void
  toggleSidebar: () => void
  toggleChat: () => void
  toggleTerminal: () => void
  openQuickFile: () => void
  openSearchPanel: () => void
}

function buildCommands(ctx: CommandContext): Command[] {
  return [
    // Panels
    { id: "toggle.sidebar", section: "Panels", label: "Toggle Side Panel", shortcut: "Ctrl+B", available: ctx.hasProject, run: ctx.toggleSidebar },
    { id: "toggle.chat", section: "Panels", label: "Toggle AI Chat", shortcut: "Ctrl+J", available: ctx.hasProject, run: ctx.toggleChat },
    { id: "toggle.terminal", section: "Panels", label: "Toggle Terminal", shortcut: "Ctrl+`", available: ctx.hasProject, run: ctx.toggleTerminal },
    { id: "panel.search", section: "Panels", label: "Search in Files", shortcut: "Ctrl+Shift+F", available: ctx.hasProject, run: ctx.openSearchPanel },

    // File
    { id: "file.quickOpen", section: "File", label: "Quick Open File…", shortcut: "Ctrl+P", available: ctx.hasProject, run: ctx.openQuickFile },

    // Project
    { id: "project.new", section: "Project", label: "New Game…", run: ctx.newProject },
    { id: "project.open", section: "Project", label: "Open Folder…", run: ctx.openFolder },
    { id: "project.close", section: "Project", label: "Close Project", available: ctx.hasProject, run: ctx.closeProject },

    // Settings
    { id: "settings.open", section: "Settings", label: "Open Settings", shortcut: "Ctrl+,", run: ctx.openSettings },
    { id: "settings.toolchain", section: "Settings", label: "Open Toolchain", run: ctx.openToolchain }
  ]
}

function IconChat(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export default function App(): JSX.Element {
  const { projectPath, dirtyFiles, setProject, closeProject, setFileTree, openFile, setLspStatus } = useProjectStore()
  const { setStatus, setPort, setToolName, setError } = useSyncStore()
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

  // System theme auto-detect on first launch only. Subsequent launches respect
  // the user's saved choice.
  useEffect(() => {
    const { hasInitialized, setHasInitialized, setTheme } = useSettingsStore.getState()
    if (hasInitialized) return
    const prefersLight = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-color-scheme: light)").matches
    if (prefersLight) setTheme("light")
    setHasInitialized(true)
  }, [])

  // Pro onboarding suppression: if user is already Pro at startup (reinstall,
  // cache clear, cross-device sync), don't replay the onboarding retroactively.
  useEffect(() => {
    window.api.getProStatus().then((s: { isPro: boolean }) => {
      if (s.isPro && shouldShowProOnboarding()) markProOnboardingDone()
    }).catch(() => {})
  }, [])

  // First-run crash-reports prompt. Until the user gives an explicit answer,
  // Sentry stays dormant — without this prompt nobody opts in and the
  // dashboard stays empty (which is exactly what happened in pre-v0.8.4
  // builds where the toggle lived only in Settings).
  const [showCrashPrompt, setShowCrashPrompt] = useState(false)
  useEffect(() => {
    void window.api.crashReportsIsPrompted().then((prompted) => {
      if (!prompted) setShowCrashPrompt(true)
    })
  }, [])

  // Sync thinking effort → main process on boot and whenever user changes it.
  const thinkingEffort = useSettingsStore((s) => s.thinkingEffort)
  useEffect(() => {
    void window.api.aiSetThinkingEffort(thinkingEffort)
  }, [thinkingEffort])

  // Rebuild native OS menu when project-scoped items (Close Project, Quick Open,
  // Toggle *) should toggle between enabled and disabled.
  useEffect(() => {
    void window.api.menuSetProjectState(Boolean(projectPath))
  }, [projectPath])
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
  const [setupTargetPath, setSetupTargetPath] = useState<string | null>(null)
  const pendingProjectRef = useRef<{ path: string; isNew: boolean } | null>(null)
  const _lastSidePanelWidth = useRef<number>(224)
  // Late-bound action refs — menu handlers fire before these closures are
  // defined in render order; refs let us point to the current handler at
  // dispatch time without re-subscribing each render.
  const handleNewProjectRef = useRef<(() => Promise<void>) | null>(null)
  const handleOpenFolderRef = useRef<(() => Promise<void>) | null>(null)
  const handleCloseProjectRef = useRef<(() => Promise<void>) | null>(null)

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
  const [paletteVisible, setPaletteVisible] = useState(false)
  const [showTopology, setShowTopology] = useState(false)
  const [showTutorial, setShowTutorial] = useState(() => shouldShowTutorial())
  const [showProOnboarding, setShowProOnboarding] = useState(false)

  // Sync layout to store on change. Store writes happen in useEffect AFTER
  // render commits. Calling them INSIDE a setState updater (the previous
  // implementation did this) emits a Zustand `set()` during React's render
  // phase, which triggers any subscriber (e.g. AppTitlebar via useT) to
  // re-render mid-render — React warns "Cannot update a component while
  // rendering a different component". The one-frame lag vs. an inline store
  // write is imperceptible on a drag; the warning is not.
  const storeSetTerminalHeight = useSettingsStore((s) => s.setTerminalHeight)
  const storeSetSidePanelWidth = useSettingsStore((s) => s.setSidePanelWidth)
  const storeSetChatPanelWidth = useSettingsStore((s) => s.setChatPanelWidth)

  const setTerminalHeight = _setTerminalHeight
  const setSidePanelWidth = _setSidePanelWidth
  const setChatPanelWidth = _setChatPanelWidth

  // Skip the initial fire — local state is seeded from store.getState(), so
  // the first effect run would write the same value back and needlessly
  // re-render every store subscriber on mount. Only write when the user
  // actually changes a size.
  const didMountLayoutSyncRef = useRef(false)
  useEffect(() => {
    if (!didMountLayoutSyncRef.current) { didMountLayoutSyncRef.current = true; return }
    storeSetTerminalHeight(terminalHeight)
  }, [terminalHeight, storeSetTerminalHeight])
  const didMountSidePanelSyncRef = useRef(false)
  useEffect(() => {
    if (!didMountSidePanelSyncRef.current) { didMountSidePanelSyncRef.current = true; return }
    storeSetSidePanelWidth(sidePanelWidth)
  }, [sidePanelWidth, storeSetSidePanelWidth])
  const didMountChatPanelSyncRef = useRef(false)
  useEffect(() => {
    if (!didMountChatPanelSyncRef.current) { didMountChatPanelSyncRef.current = true; return }
    storeSetChatPanelWidth(chatPanelWidth)
  }, [chatPanelWidth, storeSetChatPanelWidth])

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

  useIpcEvent("sync:status-changed", useCallback((...args: unknown[]) => {
    setStatus(args[0] as "stopped" | "starting" | "running" | "error")
    if (typeof args[1] === "number") setPort(args[1])
    setError(typeof args[2] === "string" ? args[2] : null)
  }, [setStatus, setPort, setError]))
  useIpcEvent("sync:notice", useCallback((...args: unknown[]) => {
    const message = args[0]
    const type = args[1]
    if (typeof message !== "string") return
    toast(message, type === "error" || type === "warn" || type === "info" ? type : "info")
  }, []))
  useIpcEvent("file:added", () => refreshFileTree())
  useIpcEvent("file:deleted", () => refreshFileTree())

  // ── Sidecar error toasts (LSP, StyLua, Selene) ──────────────────────────
  useIpcEvent("sidecar:error", useCallback((data: unknown) => {
    const { tool } = data as { tool: string; message: string }
    const labels: Record<string, string> = { "luau-lsp": "LSP", stylua: "StyLua", selene: "Selene" }
    toast(`${labels[tool] ?? tool} ${t("sidecarFailed")}`, "warn", {
      label: "Open Toolchain",
      onClick: () => setToolchainOpen(true)
    })
  }, [t]))

  // ── Native OS menu → renderer actions ───────────────────────────────────
  useIpcEvent("menu:new-project", useCallback(() => { void handleNewProjectRef.current?.() }, []))
  useIpcEvent("menu:open-folder", useCallback(() => { void handleOpenFolderRef.current?.() }, []))
  useIpcEvent("menu:close-project", useCallback(() => { void handleCloseProjectRef.current?.() }, []))
  useIpcEvent("menu:open-settings", useCallback(() => setSettingsOpen(true), []))
  useIpcEvent("menu:open-toolchain", useCallback(() => setToolchainOpen(true), []))
  useIpcEvent("menu:command-palette", useCallback(() => setPaletteVisible(true), []))
  useIpcEvent("menu:quick-open", useCallback(() => { if (projectPath) setQuickOpenVisible(true) }, [projectPath]))
  useIpcEvent("menu:toggle-sidebar", useCallback(() => {
    const { sidePanelWidth: w, setSidePanelWidth: setW } = useSettingsStore.getState()
    if (w > 0) { _lastSidePanelWidth.current = w; setW(0); _setSidePanelWidth(0) }
    else { const r = _lastSidePanelWidth.current || 224; setW(r); _setSidePanelWidth(r) }
  }, []))
  useIpcEvent("menu:toggle-chat", useCallback(() => {
    const { rightPanelOpen: open, setRightPanelOpen: setOpen } = useSettingsStore.getState()
    setOpen(!open)
  }, []))
  useIpcEvent("menu:toggle-terminal", useCallback(() => {
    setTerminalOpen(!useSettingsStore.getState().terminalOpen)
  }, [setTerminalOpen]))

  // ── LSP boot phase → projectStore ───────────────────────────────────────
  useIpcEvent("sidecar:lsp-status", useCallback((data: unknown) => {
    const payload = data as { status?: string; port?: number | null } | undefined
    const status = payload?.status
    if (status !== "stopped" && status !== "starting" && status !== "running" && status !== "error") return
    setLspStatus(status)
  }, [setLspStatus]))

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
    setSetupTargetPath(null)
    const pending = pendingProjectRef.current
    if (pending) {
      pendingProjectRef.current = null
      // Scaffold the project now (not earlier) so cancelling the setup panel
      // leaves the folder untouched — initProject creates default.project.json,
      // selene.toml, and src/ subdirectories which the user didn't ask for if
      // they backed out.
      if (pending.isNew) await window.api.initProject(pending.path)
      // Persist resolved toolchain to the project so it won't prompt again
      await window.api.toolchainInitProjectConfig(pending.path)
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

  const handleToolchainCancel = useCallback(() => {
    pendingProjectRef.current = null
    setToolchainOpen(false)
    setToolchainSetupMode(false)
    setSetupTargetPath(null)
  }, [])

  // ── Session Restore — reopen last project + files on restart ────────────
  // Ref guard prevents React StrictMode's dev double-mount from spawning the
  // LSP and Argon twice. The actual session-restore work is one-shot and
  // belongs outside the React effect lifecycle.
  const sessionRestoredRef = useRef(false)
  useEffect(() => {
    if (sessionRestoredRef.current) return
    sessionRestoredRef.current = true

    const { projectPath: savedPath, openFiles: savedOpenFiles, activeFile: savedActiveFile } = useProjectStore.getState()
    if (!savedPath) return

    openPath(savedPath).then(async (ok) => {
      if (!ok) {
        closeProject()
        return
      }
      // Reload previously open files. `openFile` sets activeFile on every call,
      // which would leave the LAST file active instead of the one the user had
      // focus on when they closed. Restore the original activeFile afterwards.
      for (const filePath of savedOpenFiles) {
        try {
          const content = await window.api.readFile(filePath)
          openFile(filePath, content ?? "")
        } catch { /* Skip if file was deleted */ }
      }
      if (savedActiveFile && useProjectStore.getState().openFiles.includes(savedActiveFile)) {
        useProjectStore.getState().setActiveFile(savedActiveFile)
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

      // Ctrl+Shift+P — Command palette (works without project)
      if (ctrl && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault()
        setPaletteVisible((v) => !v)
        return
      }

      // Ctrl+, — Open Settings (works without project)
      if (ctrl && e.key === "," && !e.shiftKey) {
        e.preventDefault()
        setSettingsOpen(true)
        return
      }

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

      // Ctrl+B — Toggle sidebar (side panel)
      if (ctrl && (e.key === "b" || e.key === "B") && !e.shiftKey) {
        if (!projectPath) return
        e.preventDefault()
        const { sidePanelWidth: w, setSidePanelWidth: setW } = useSettingsStore.getState()
        // Width of 0 = collapsed. Remember previous width on toggle.
        if (w > 0) {
          _lastSidePanelWidth.current = w
          setW(0)
          _setSidePanelWidth(0)
        } else {
          const restored = _lastSidePanelWidth.current || 224
          setW(restored)
          _setSidePanelWidth(restored)
        }
        return
      }

      // Ctrl+J — Toggle AI chat panel
      if (ctrl && (e.key === "j" || e.key === "J") && !e.shiftKey) {
        if (!projectPath) return
        e.preventDefault()
        const { rightPanelOpen: open, setRightPanelOpen: setOpen } = useSettingsStore.getState()
        setOpen(!open)
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
    // Gate: both luau-lsp must be installed AND this project must have a .luano/toolchain.json.
    // Missing either → show setup panel before closing the current project.
    const [ready, configured] = await Promise.all([
      window.api.toolchainIsMinimumReady(),
      window.api.toolchainHasProjectConfig(path),
    ])
    if (!ready || !configured) {
      // Defer initProject until the user confirms via the setup panel — see
      // handleToolchainClose. Cancelling should leave the folder untouched.
      pendingProjectRef.current = { path, isNew }
      setSetupTargetPath(path)
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

  const handleCloseProject = async () => {
    if (!projectPath) return
    if (dirtyFiles.length > 0) {
      setSwitchConfirm({ action: "close" })
      return
    }
    await window.api.closeProject()
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

  handleNewProjectRef.current = handleNewProject
  handleOpenFolderRef.current = handleOpenFolder
  handleCloseProjectRef.current = handleCloseProject

  // Drag-and-drop: dropping a folder onto the window opens it as a project.
  // Electron extends File with a non-standard `path` property so we don't need
  // to round-trip through FilePath IPC.
  const [dropOver, setDropOver] = useState(false)
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
      setDropOver(true)
    }
  }
  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDropOver(false)
  }
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const path = (file as File & { path?: string }).path
    if (!path) return
    // Authoritative check: main-process lstat verifies the path is a real
    // directory (rejects files, symlinks, missing paths). Previously the
    // renderer-only heuristic (file.type / file.name.includes('.')) rejected
    // legit folders named v1.0 and accepted dotless files like LICENSE.
    const isDir = await window.api.isDirectory(path).catch(() => false)
    if (!isDir) {
      toast(`Drop a project folder (got: ${file.name || path})`, "warn")
      return
    }
    if (projectPath && dirtyFiles.length > 0) {
      setSwitchConfirm({ action: "open", path })
      return
    }
    await checkRojoAndOpen(path)
  }


  return (
    <div
      className="flex flex-col h-screen overflow-hidden relative"
      style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dropOver && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
          style={{
            background: "var(--accent-muted)",
            border: "2px dashed var(--accent)",
            color: "var(--accent)",
            fontSize: "14px",
            fontWeight: 500
          }}
        >
          Drop a folder to open as project
        </div>
      )}
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
                  <WelcomeScreen
                    onOpenFolder={handleOpenFolder}
                    onNewProject={handleNewProject}
                    onOpenRecent={handleOpenRecent}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
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

        {/* AI Chat panel + resize handle — inline flex child, PUSHES the editor area
            (industry standard: VSCode/Cursor/Windsurf). With wordWrap: off in Monaco,
            editor content stays intact and simply reveals a horizontal scrollbar when
            the editor narrows. */}
        {projectPath && rightPanelOpen && (
          <>
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
              className="flex-shrink-0 flex flex-col overflow-hidden animate-slide-in-right"
              style={{ width: `${chatPanelWidth}px`, background: "var(--bg-panel)" }}
            >
              <ErrorBoundary>
                <Suspense fallback={null}>
                  <ChatPanel onClose={() => setRightPanelOpen(false)} />
                </Suspense>
              </ErrorBoundary>
            </div>
          </>
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
          {settingsOpen && (
            <SettingsPanel
              onClose={() => setSettingsOpen(false)}
              onProActivated={() => {
                if (shouldShowProOnboarding()) setShowProOnboarding(true)
              }}
            />
          )}
          {toolchainOpen && <ToolchainPanel onClose={handleToolchainClose} onCancel={handleToolchainCancel} mode={toolchainSetupMode ? "setup" : "normal"} targetProjectPath={toolchainSetupMode ? (setupTargetPath ?? undefined) : undefined} />}
        </Suspense>
      </ErrorBoundary>
      {quickOpenVisible && <QuickOpen onClose={() => setQuickOpenVisible(false)} />}
      <CommandPalette
        open={paletteVisible}
        onClose={() => setPaletteVisible(false)}
        commands={buildCommands({
          projectPath,
          hasProject: Boolean(projectPath),
          openSettings: () => setSettingsOpen(true),
          openToolchain: () => setToolchainOpen(true),
          openFolder: handleOpenFolder,
          newProject: handleNewProject,
          closeProject: handleCloseProject,
          toggleSidebar: () => {
            const { sidePanelWidth: w, setSidePanelWidth: setW } = useSettingsStore.getState()
            if (w > 0) { _lastSidePanelWidth.current = w; setW(0); _setSidePanelWidth(0) }
            else { const r = _lastSidePanelWidth.current || 224; setW(r); _setSidePanelWidth(r) }
          },
          toggleChat: () => {
            const { rightPanelOpen: open, setRightPanelOpen: setOpen } = useSettingsStore.getState()
            setOpen(!open)
          },
          toggleTerminal: () => setTerminalOpen(!useSettingsStore.getState().terminalOpen),
          openQuickFile: () => setQuickOpenVisible(true),
          openSearchPanel: () => setActivePanel("search")
        })}
      />
      <ToastContainer />
      <UpdateBanner />

      {/* Tutorial overlay */}
      {showTutorial && <TutorialOverlay onDone={() => setShowTutorial(false)} />}
      {showProOnboarding && <ProOnboardingOverlay onDone={() => setShowProOnboarding(false)} />}

      {/* First-run crash-reports prompt — must come before TutorialOverlay
          dismissal handlers so it sits visually on top while answering. */}
      {showCrashPrompt && (
        <ConfirmDialog
          title={t("crashReportsPromptTitle")}
          body={t("crashReportsPromptBody")}
          confirmLabel={t("crashReportsPromptAccept")}
          cancelLabel={t("crashReportsPromptDecline")}
          onConfirm={async () => {
            await window.api.crashReportsSetEnabled(true)
            await window.api.crashReportsMarkPrompted()
            await window.api.analyticsUsageSetEnabled(true)
            // initPostHog may have early-returned at startup before consent was set;
            // calling it again here starts PostHog and fires app_opened in this session.
            initPostHog()
            setShowCrashPrompt(false)
          }}
          onCancel={async () => {
            await window.api.crashReportsSetEnabled(false)
            await window.api.crashReportsMarkPrompted()
            await window.api.analyticsUsageSetEnabled(false)
            setShowCrashPrompt(false)
          }}
        />
      )}

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
              await window.api.closeProject()
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
          onDismiss={() => setRojoSetup(null)}
        />
      )}
    </div>
  )
}
