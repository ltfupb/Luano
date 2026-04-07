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
  bundled: boolean
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

export function ToolchainPanel({ onClose }: ToolchainPanelProps): JSX.Element {
  const { projectPath } = useProjectStore()
  const t = useT()
  const [tools, setTools] = useState<Record<string, ToolDef>>({})
  const [categories, setCategories] = useState<CategoryDef[]>([])
  const [installed, setInstalled] = useState<Record<string, boolean>>({})
  const [selections, setSelections] = useState<Record<string, string | null>>({})
  const [filter, setFilter] = useState("sync")
  const [search, setSearch] = useState("")
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [selectedTool, setSelectedTool] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [updates, setUpdates] = useState<Record<string, { latestVersion: string; downloadUrl: string }>>({})
  const [updating, setUpdating] = useState<Set<string>>(new Set())

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    const [registry, config] = await Promise.all([
      window.api.toolchainRegistry(),
      window.api.toolchainGetConfig(projectPath ?? undefined)
    ])
    setTools(registry.tools)
    setCategories(registry.categories)
    setInstalled(config.installed)
    setSelections(config.selections)

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
  }

  const handleClose = () => {
    setVisible(false)
    setTimeout(onClose, 180)
  }

  const [installError, setInstallError] = useState<string | null>(null)

  const handleInstall = async (toolId: string) => {
    setInstallError(null)
    setDownloading(prev => new Set(prev).add(toolId))
    const result = await window.api.toolchainDownload(toolId)
    setDownloading(prev => { const n = new Set(prev); n.delete(toolId); return n })
    if (result.success) {
      setInstalled(prev => ({ ...prev, [toolId]: true }))
    } else {
      setInstallError(result.error ?? "Install failed")
    }
  }

  const handleRemove = async (toolId: string) => {
    const result = await window.api.toolchainRemove(toolId)
    if (result.success) {
      setInstalled(prev => ({ ...prev, [toolId]: false }))
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

  const handleActivate = async (toolId: string, category: string) => {
    try {
      await window.api.toolchainSetTool(category, toolId, projectPath ?? undefined)
      setSelections(prev => ({ ...prev, [category]: toolId }))
      if (category === "sync") {
        useRojoStore.getState().setToolName(toolId === "argon" ? "Argon" : "Rojo")
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Failed to activate tool")
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
      onClick={(e) => e.target === e.currentTarget && handleClose()}
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
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
            {t("toolchainTitle")}
          </span>
          <button
            onClick={handleClose}
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
        {/* Sidebar — Category Filter */}
        <div
          className="w-[160px] flex-shrink-0 flex flex-col py-3"
          style={{ borderRight: "1px solid var(--border-subtle)", background: "var(--bg-base)" }}
        >
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setFilter(cat.id)}
              className="px-3 py-1.5 text-left text-xs transition-all duration-100"
              style={{
                background: filter === cat.id ? "var(--bg-elevated)" : "transparent",
                color: filter === cat.id ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: filter === cat.id ? 500 : 400
              }}
            >
              {cat.label}
            </button>
          ))}
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
                const isInstalled = installed[tool.id]
                const isActive = selections[tool.category] === tool.id
                const isDownloading = downloading.has(tool.id)
                const hasUpdate = !!updates[tool.id]
                const isUpdating = updating.has(tool.id)

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
                        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>v{tool.version}</span>
                        {hasUpdate && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                            style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}
                          >
                            {updates[tool.id].latestVersion}
                          </span>
                        )}
                        {tool.bundled && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                            style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}
                          >
                            Bundled
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--text-primary)", lineHeight: "1.4", minHeight: "28px" }}>
                        {tool.description}
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="flex-shrink-0 self-center">
                      {isDownloading || isUpdating ? (
                        <span
                          className="px-2.5 py-1 rounded-md text-[10px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {t("toolchainDownloading")}
                        </span>
                      ) : !isInstalled ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleInstall(tool.id) }}
                          className="px-2.5 py-1 rounded-md text-[10px] font-medium transition-all duration-100"
                          style={{ background: "var(--accent)", color: "white" }}
                        >
                          {t("toolchainInstall")}
                        </button>
                      ) : isActive ? (
                        <span
                          className="px-2.5 py-1 rounded-md text-[10px]"
                          style={{ color: "#10b981" }}
                        >
                          {t("toolchainActive")}
                        </span>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleActivate(tool.id, tool.category) }}
                          className="px-2.5 py-1 rounded-md text-[10px] transition-all duration-100"
                          style={{ background: "var(--accent)", color: "white" }}
                        >
                          {t("toolchainActivate")}
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
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Category</span>
                      <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>
                        {categories.find(c => c.id === detail.category)?.label ?? detail.category}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Status</span>
                      <span style={{
                        fontSize: "10px",
                        color: installed[detail.id] ? "#10b981" : "var(--text-muted)"
                      }}>
                        {installed[detail.id] ? (detail.bundled ? "Bundled" : "Installed") : "Not installed"}
                      </span>
                    </div>
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
                    {!installed[detail.id] && (
                      <button
                        onClick={() => handleInstall(detail.id)}
                        disabled={downloading.has(detail.id)}
                        className="w-full py-1.5 rounded-md text-xs font-medium transition-all duration-100 disabled:opacity-50"
                        style={{ background: "var(--accent)", color: "white" }}
                      >
                        {downloading.has(detail.id) ? t("toolchainDownloading") : t("toolchainInstall")}
                      </button>
                    )}
                    {installed[detail.id] && selections[detail.category] !== detail.id && (
                      <button
                        onClick={() => handleActivate(detail.id, detail.category)}
                        className="w-full py-1.5 rounded-md text-xs font-medium transition-all duration-100"
                        style={{ background: "var(--accent)", color: "white" }}
                      >
                        {t("toolchainActivate")}
                      </button>
                    )}
                    {installed[detail.id] && !detail.bundled && (
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
      </div>
    </div>
  )
}
