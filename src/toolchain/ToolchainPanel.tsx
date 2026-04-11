/**
 * src/toolchain/ToolchainPanel.tsx — Prism Launcher-style tool catalog
 *
 * Full-screen modal showing all available tools with install/activate controls.
 */

import { useState, useEffect } from "react"
import { useProjectStore } from "../stores/projectStore"
import { useRojoStore } from "../stores/rojoStore"
import { useT } from "../i18n/useT"

import rojoLogo from "../assets/toolchain/rojo.png"
import argonLogo from "../assets/toolchain/argon.png"
import styluaLogo from "../assets/toolchain/stylua.png"
import luauLspLogo from "../assets/toolchain/luau-lsp.png"
import wallyLogo from "../assets/toolchain/wally.svg"
import pesdeLogo from "../assets/toolchain/pesde.svg"
import darkluaLogo from "../assets/toolchain/darklua.png"

interface ToolDef {
  id: string
  name: string
  description: string
  category: string
  recommended: boolean
  version: string
  github: string
}

interface CategoryDef {
  id: string
  label: string
  allowNone: boolean
}

interface ToolchainPanelProps {
  onClose: () => void
  onCancel?: () => void
  mode?: "normal" | "setup"
  /** Override project path (used during setup mode when project isn't open yet) */
  targetProjectPath?: string
}

const TOOL_LOGOS: Record<string, string> = {
  rojo: rojoLogo,
  argon: argonLogo,
  stylua: styluaLogo,
  "luau-lsp": luauLspLogo,
  wally: wallyLogo,
  pesde: pesdeLogo,
  darklua: darkluaLogo
}

function ToolLogo({ id, name, className }: { id: string; name: string; className?: string }): JSX.Element {
  const [failed, setFailed] = useState(false)
  const src = TOOL_LOGOS[id]
  if (!src || failed) {
    return (
      <div
        className={`rounded-md flex items-center justify-center ${className ?? "w-8 h-8"}`}
        style={{ background: "var(--bg-elevated)", color: "var(--text-muted)", fontSize: "14px", fontWeight: 600 }}
      >
        {name[0]}
      </div>
    )
  }
  return <img src={src} alt={name} className={`object-contain ${className ?? "w-8 h-8"}`} onError={() => setFailed(true)} />
}

export function ToolchainPanel({ onClose, onCancel, mode = "normal", targetProjectPath }: ToolchainPanelProps): JSX.Element {
  const isSetup = mode === "setup"
  const storeProjectPath = useProjectStore((s) => s.projectPath)
  const projectPath = targetProjectPath ?? storeProjectPath
  const t = useT()
  const [tools, setTools] = useState<Record<string, ToolDef>>({})
  const [categories, setCategories] = useState<CategoryDef[]>([])
  const [installed, setInstalled] = useState<Record<string, boolean>>({})
  const [selections, setSelections] = useState<Record<string, string | null>>({})
  const [pending, setPending] = useState<Record<string, string | null>>({})
  const [applying, setApplying] = useState(false)
  const [filter, setFilter] = useState("sync")
  const [search, setSearch] = useState("")
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [selectedTool, setSelectedTool] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [updates, setUpdates] = useState<Record<string, { latestVersion: string; downloadUrl: string }>>({})
  const [updating, setUpdating] = useState<Set<string>>(new Set())
  const [metadata, setMetadata] = useState<Record<string, { license: string | null; updatedAt: string | null }>>({})

  const effectiveSelection = (category: string): string | null =>
    category in pending ? pending[category] : (selections[category] ?? null)

  /** A category is locked when it's required AND has exactly one tool available.
   *  The user can't deselect it, and it gets pre-checked automatically. */
  const isLocked = (tool: ToolDef): boolean => {
    const cat = categories.find(c => c.id === tool.category)
    if (!cat || cat.allowNone) return false
    return Object.values(tools).filter(t => t.category === tool.category).length === 1
  }

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    const [registry, config] = await Promise.all([
      window.api.toolchainRegistry(),
      // Normal mode: pass projectOnly=true so selections reflect the actual
      // .luano/toolchain.json contents, not fallback defaults. Setup mode
      // clears selections below anyway, so the flag doesn't matter there.
      window.api.toolchainGetConfig(projectPath ?? undefined, !isSetup)
    ])
    setTools(registry.tools)
    setCategories(registry.categories)
    setInstalled(config.installed)

    if (isSetup) {
      // Setup mode: clean slate. Don't seed from bundled defaults.
      // Auto-check any required category that has exactly one tool (currently only lsp).
      const cleared: Record<string, string | null> = {}
      const autoPending: Record<string, string | null> = {}
      for (const cat of registry.categories) {
        cleared[cat.id] = null
        const toolsInCat = Object.values(registry.tools).filter(t => t.category === cat.id)
        if (!cat.allowNone && toolsInCat.length === 1) {
          autoPending[cat.id] = toolsInCat[0].id
        }
      }
      setSelections(cleared)
      setPending(autoPending)
    } else {
      setSelections(config.selections)
    }

    // Check for updates on installed tools
    const installedIds = Object.entries(config.installed)
      .filter(([, v]) => v)
      .map(([k]) => k)
    if (installedIds.length > 0) {
      window.api.toolchainCheckUpdates(installedIds).then(result => {
        const map: Record<string, { latestVersion: string; downloadUrl: string }> = {}
        for (const u of result) {
          map[u.toolId] = { latestVersion: u.latestVersion, downloadUrl: u.downloadUrl }
        }
        setUpdates(map)
      })
    }

    // Fetch license + last updated from GitHub (cached 24h)
    window.api.toolchainFetchMetadata().then(setMetadata).catch(() => {})
  }

  const handleClose = () => {
    setVisible(false)
    setTimeout(onClose, 180)
  }

  const handleCancel = () => {
    setVisible(false)
    setTimeout(() => (onCancel ?? onClose)(), 180)
  }

  const [installError, setInstallError] = useState<string | null>(null)

  const handleToggleSelect = (tool: ToolDef): void => {
    if (isLocked(tool)) return
    setInstallError(null)
    const current = effectiveSelection(tool.category)
    const category = categories.find(c => c.id === tool.category)

    if (current === tool.id) {
      // Uncheck if the category allows none
      if (category?.allowNone) {
        setPending(prev => ({ ...prev, [tool.category]: null }))
      }
      return
    }

    setPending(prev => ({ ...prev, [tool.category]: tool.id }))
  }

  const handleContinue = async (): Promise<void> => {
    if (applying) return
    setInstallError(null)
    setApplying(true)

    // Tools that need to be on disk after apply: every effective selection across all categories
    const effectiveMap: Record<string, string | null> = {}
    for (const cat of categories) {
      effectiveMap[cat.id] = effectiveSelection(cat.id)
    }

    // Missing binaries that must be downloaded
    const toInstall = Object.values(effectiveMap)
      .filter((id): id is string => !!id && !installed[id])

    if (toInstall.length > 0) {
      setDownloading(prev => { const n = new Set(prev); toInstall.forEach(i => n.add(i)); return n })
      const results = await window.api.toolchainDownloadMultiple(toInstall)
      setDownloading(prev => { const n = new Set(prev); toInstall.forEach(i => n.delete(i)); return n })

      const nextInstalled = { ...installed }
      const errors: string[] = []
      for (const [id, result] of Object.entries(results)) {
        if (result.success) nextInstalled[id] = true
        else errors.push(`${id}: ${result.error}`)
      }
      setInstalled(nextInstalled)

      if (errors.length > 0) {
        setInstallError(errors.join("\n"))
        setApplying(false)
        return
      }
    }

    // Persist per-project selection for every category where pending differs
    for (const [cat, toolId] of Object.entries(pending)) {
      if (toolId === (selections[cat] ?? null)) continue
      try {
        await window.api.toolchainSetTool(cat, toolId, projectPath ?? undefined)
        if (cat === "sync") {
          useRojoStore.getState().setToolName(toolId === "argon" ? "Argon" : "Rojo")
        }
      } catch (err) {
        setInstallError(err instanceof Error ? err.message : "Failed to set tool")
        setApplying(false)
        return
      }
    }

    setSelections(prev => ({ ...prev, ...pending }))
    setPending({})
    setApplying(false)
    handleClose()
  }

  const handleRemove = async (toolId: string) => {
    const result = await window.api.toolchainRemove(toolId)
    if (result.success) {
      setInstalled(prev => ({ ...prev, [toolId]: false }))
      // Clear selection (persisted + pending) if this tool was the project's choice
      const tool = tools[toolId]
      if (!tool) return
      if (selections[tool.category] === toolId) {
        try {
          await window.api.toolchainSetTool(tool.category, null, projectPath ?? undefined)
          setSelections(prev => ({ ...prev, [tool.category]: null }))
        } catch { /* non-fatal */ }
      }
      if (pending[tool.category] === toolId) {
        setPending(prev => ({ ...prev, [tool.category]: null }))
      }
    }
  }

  const handleUpdate = async (toolId: string) => {
    const info = updates[toolId]
    if (!info) return
    setUpdating(prev => new Set(prev).add(toolId))
    const result = await window.api.toolchainUpdateTool(toolId, info.downloadUrl, info.latestVersion)
    setUpdating(prev => { const n = new Set(prev); n.delete(toolId); return n })
    if (result.success) {
      setUpdates(prev => { const n = { ...prev }; delete n[toolId]; return n })
    } else {
      setInstallError(result.error ?? "Update failed")
    }
  }

  const filteredTools = Object.values(tools).filter(tool => {
    if (tool.category !== filter) return false
    if (search && !tool.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const detail = selectedTool ? tools[selectedTool] : null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{
        background: `rgba(5,8,15,${visible ? "0.15" : "0"})`,
        backdropFilter: visible ? "blur(12px)" : "none",
        transition: "all 0.18s ease"
      }}
      onClick={(e) => { if (e.target === e.currentTarget) (isSetup ? handleCancel : handleClose)() }}
    >
      <div
        className="w-[720px] h-[520px] rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.8)",
          transform: visible ? "translateY(0) scale(1)" : "translateY(10px) scale(0.98)",
          opacity: visible ? 1 : 0,
          transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
              {isSetup ? t("toolchainSetup") : t("toolchainTitle")}
            </span>
          </div>
          <button
            onClick={isSetup ? handleCancel : handleClose}
            title={isSetup ? "Cancel" : "Close"}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-100"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
        {/* Sidebar — Required categories sit on top with a thin accent rail,
            a breathing gap, then Optional categories */}
        <div
          className="w-[160px] flex-shrink-0 flex flex-col py-3"
          style={{ borderRight: "1px solid var(--border-subtle)", background: "var(--bg-base)" }}
        >
          {(["required", "optional"] as const).map((group, groupIdx) => {
            const groupCats = categories.filter(c => (group === "required" ? !c.allowNone : c.allowNone))
            if (groupCats.length === 0) return null
            return (
              <div key={group} className={`flex flex-col ${groupIdx > 0 ? "mt-3" : ""}`}>
                {groupCats.map(cat => {
                  const isRequired = !cat.allowNone
                  const hasSelection = !!effectiveSelection(cat.id)
                  const unmet = isRequired && !hasSelection
                  const isActive = filter === cat.id
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setFilter(cat.id)}
                      className="relative py-1.5 pr-3 text-left text-xs transition-all duration-100"
                      style={{
                        paddingLeft: "14px",
                        background: isActive ? "var(--bg-elevated)" : "transparent",
                        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                        fontWeight: isActive ? 500 : isRequired ? 500 : 400
                      }}
                      title={isRequired ? t("toolchainRequired") : undefined}
                    >
                      {isRequired && (
                        <span
                          aria-hidden
                          className="absolute rounded-full"
                          style={{
                            left: "6px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            width: "2px",
                            height: "13px",
                            background: unmet ? "#f87171" : "var(--accent)",
                            opacity: unmet ? 1 : isActive ? 1 : 0.55,
                            transition: "opacity 0.15s ease, background 0.15s ease"
                          }}
                        />
                      )}
                      {cat.label}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Search */}
          <div
            className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("toolchainSearch")}
              className="flex-1 rounded-lg px-3 py-1.5 text-xs focus:outline-none"
              style={{
                background: "var(--bg-base)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)"
              }}
            />
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* Tool List */}
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {filteredTools.map(tool => {
                const isSelected = effectiveSelection(tool.category) === tool.id
                const isDownloading = downloading.has(tool.id)
                const isUpdating = updating.has(tool.id)
                const isBusy = isDownloading || isUpdating
                const locked = isLocked(tool)

                return (
                  <div
                    key={tool.id}
                    onClick={() => setSelectedTool(tool.id)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-100"
                    style={{
                      background: selectedTool === tool.id ? "var(--bg-elevated)" : "transparent",
                      border: `1px solid ${selectedTool === tool.id ? "var(--border)" : "transparent"}`
                    }}
                    onMouseEnter={e => {
                      if (selectedTool !== tool.id) (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"
                    }}
                    onMouseLeave={e => {
                      if (selectedTool !== tool.id) (e.currentTarget as HTMLElement).style.background = "transparent"
                    }}
                  >
                    {/* Logo */}
                    <ToolLogo id={tool.id} name={tool.name} className="w-8 h-8 flex-shrink-0" />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-primary)" }}>
                          {tool.name}
                        </span>
                        {tool.recommended && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                            style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}
                          >
                            Recommended
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--text-primary)", lineHeight: "1.4", minHeight: "28px" }}>
                        {tool.description}
                      </div>
                    </div>

                    {/* Action — per-project select (auto-downloads on first use) */}
                    <div className="flex-shrink-0 self-center flex items-center">
                      {isBusy ? (
                        <span
                          className="px-2.5 py-1 rounded-md text-[10px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {t("toolchainDownloading")}
                        </span>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleSelect(tool) }}
                          disabled={locked}
                          aria-label={locked ? t("toolchainRequired") : (isSelected ? "Deselect" : "Select")}
                          title={locked ? t("toolchainRequired") : undefined}
                          className="w-[18px] h-[18px] rounded flex items-center justify-center transition-all duration-100"
                          style={{
                            background: isSelected ? "var(--accent)" : "transparent",
                            border: `1.5px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                            cursor: locked ? "default" : "pointer"
                          }}
                        >
                          {isSelected && (
                            locked ? (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="5" y="11" width="14" height="10" rx="1.5" />
                                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                              </svg>
                            ) : (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}

              {filteredTools.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>No tools found</span>
                </div>
              )}
            </div>

            {/* Detail Panel (always visible) */}
            <div
              className="w-[220px] flex-shrink-0 p-4 flex flex-col gap-3 overflow-y-auto"
              style={{ borderLeft: "1px solid var(--border-subtle)", background: "var(--bg-base)" }}
            >
              {detail ? (
                <>
                  <div className="flex items-center gap-2">
                    <ToolLogo id={detail.id} name={detail.name} />
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                      {detail.name}
                    </span>
                  </div>

                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {detail.description}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Version</span>
                      <span style={{ fontSize: "10px", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                        {detail.version}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Author</span>
                      <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>
                        {detail.github.split("/")[0]}
                      </span>
                    </div>
                    {metadata[detail.id]?.license && (
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>License</span>
                        <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>
                          {metadata[detail.id].license}
                        </span>
                      </div>
                    )}
                    {metadata[detail.id]?.updatedAt && (
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Updated</span>
                        <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>
                          {new Date(metadata[detail.id].updatedAt as string).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>

                  <a
                    href={`https://github.com/${detail.github}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs flex items-center gap-1.5 transition-all duration-100"
                    style={{ color: "var(--accent)" }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    {detail.github}
                  </a>

                  <div className="flex flex-col gap-1.5 mt-1">
                    {updates[detail.id] && installed[detail.id] && (
                      <button
                        onClick={() => handleUpdate(detail.id)}
                        disabled={updating.has(detail.id)}
                        className="w-full py-1.5 rounded-md text-xs font-medium transition-all duration-100 disabled:opacity-50"
                        style={{ background: "#3b82f6", color: "white" }}
                      >
                        {updating.has(detail.id) ? t("toolchainDownloading") : `Update to ${updates[detail.id].latestVersion}`}
                      </button>
                    )}
                    {installed[detail.id] && !isLocked(detail) && (
                      <button
                        onClick={() => handleRemove(detail.id)}
                        className="w-full py-1.5 rounded-md text-xs transition-all duration-100"
                        style={{ background: "transparent", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}
                      >
                        {t("toolchainRemove")}
                      </button>
                    )}
                    {installError && (
                      <div
                        className="px-2.5 py-2 rounded-md text-[10px] leading-relaxed"
                        style={{ background: "rgba(248,113,113,0.1)", color: "#f87171", border: "1px solid rgba(248,113,113,0.2)" }}
                      >
                        {installError}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
        </div>

        {/* Bottom action bar — Continue applies pending selections (downloads missing tools) */}
        <div
          className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--bg-base)" }}
        >
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            {t("toolchainSelectHint")}
          </span>
          <button
            onClick={handleContinue}
            disabled={applying || categories.some(c => !c.allowNone && !effectiveSelection(c.id))}
            className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--accent)", color: "white" }}
          >
            {applying ? t("toolchainDownloading") : t("toolchainContinue")}
          </button>
        </div>
      </div>
    </div>
  )
}
