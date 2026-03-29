import { useState, useRef, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import { useProjectStore, FileEntry } from "../stores/projectStore"
import { useT } from "../i18n/useT"

// ── Color map ────────────────────────────────────────────────────────────────
const fileColors: Record<string, string> = {
  lua:  "#6ba3f5",
  luau: "#6ba3f5",
  json: "#f59e0b",
  md:   "#60b8ff",
  toml: "#fb923c",
  txt:  "#5a82a0"
}

// ── Icons ────────────────────────────────────────────────────────────────────
function ChevronIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transition: "transform 0.15s ease", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function FileIcon({ ext }: { ext?: string }): JSX.Element {
  const color = fileColors[ext ?? ""] ?? "#5a82a0"
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" style={{ flexShrink: 0 }}>
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  )
}

function FolderIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24"
      fill={open ? "rgba(37,99,235,0.2)" : "none"}
      stroke={open ? "#4d90f8" : "#5a82a0"}
      strokeWidth="1.8" style={{ flexShrink: 0, transition: "all 0.15s ease" }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

// ── Context menu ─────────────────────────────────────────────────────────────
interface ContextMenuState {
  x: number
  y: number
  entry: FileEntry | null  // null = empty area (root)
  parentPath: string
}

interface ContextMenuProps {
  menu: ContextMenuState
  onClose: () => void
  onRefresh: () => Promise<void>
}

function ContextMenu({ menu, onClose, onRefresh }: ContextMenuProps): JSX.Element {
  const { closeFile } = useProjectStore()
  const [renaming, setRenaming] = useState(false)
  const [creating, setCreating] = useState<"file" | "folder" | null>(null)
  const [inputVal, setInputVal] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const isDir = menu.entry?.type === "directory"

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  useEffect(() => {
    if ((renaming || creating) && inputRef.current) {
      inputRef.current.focus()
      if (renaming) inputRef.current.select()
    }
  }, [renaming, creating])

  const handleRename = async () => {
    if (!menu.entry || !inputVal.trim()) return
    await window.api.renameEntry(menu.entry.path, inputVal.trim())
    await onRefresh()
    onClose()
  }

  const handleCreate = async (type: "file" | "folder") => {
    if (!inputVal.trim()) return
    const dir = menu.entry?.type === "directory" ? menu.entry.path : menu.parentPath
    if (type === "file") {
      await window.api.createFile(dir, inputVal.trim())
    } else {
      await window.api.createFolder(dir, inputVal.trim())
    }
    await onRefresh()
    onClose()
  }

  const handleDelete = async () => {
    if (!menu.entry) return
    if (menu.entry.type === "file") closeFile(menu.entry.path)
    await window.api.deleteEntry(menu.entry.path)
    await onRefresh()
    onClose()
  }

  const handleMove = async () => {
    if (!menu.entry) return
    const result = await window.api.moveEntry(menu.entry.path)
    if (result.success) {
      if (menu.entry.type === "file") closeFile(menu.entry.path)
      await onRefresh()
    }
    onClose()
  }

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-base)",
    border: "1px solid var(--accent)",
    borderRadius: "4px",
    color: "var(--text-primary)",
    fontSize: "12px",
    padding: "3px 6px",
    outline: "none",
    width: "100%"
  }

  const itemStyle: React.CSSProperties = {
    fontSize: "12px",
    color: "var(--text-primary)",
    padding: "5px 12px",
    cursor: "pointer",
    borderRadius: "4px",
    transition: "background 0.1s"
  }

  const dangerStyle: React.CSSProperties = {
    ...itemStyle,
    color: "#fb7185"
  }

  const popupStyle: React.CSSProperties = {
    position: "fixed", left: menu.x, top: menu.y, zIndex: 9999,
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    borderRadius: "8px", padding: "8px", width: "180px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.6)"
  }

  if (renaming && menu.entry) {
    return createPortal(
      <div ref={menuRef} className="animate-fade-in" style={popupStyle}>
        <input
          ref={inputRef}
          style={inputStyle}
          defaultValue={menu.entry.name}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") onClose() }}
          placeholder="New name…"
        />
        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>Enter · Esc to cancel</div>
      </div>,
      document.body
    )
  }

  if (creating) {
    return createPortal(
      <div ref={menuRef} className="animate-fade-in" style={popupStyle}>
        <input
          ref={inputRef}
          style={inputStyle}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleCreate(creating); if (e.key === "Escape") onClose() }}
          placeholder={creating === "file" ? "filename.lua" : "folder name"}
        />
        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>Enter · Esc to cancel</div>
      </div>,
      document.body
    )
  }

  return createPortal(
    <div ref={menuRef} className="animate-fade-in" style={{
      position: "fixed", left: menu.x, top: menu.y, zIndex: 9999,
      background: "var(--bg-elevated)", border: "1px solid var(--border)",
      borderRadius: "8px", padding: "4px", minWidth: "160px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.6)"
    }}>
      {(isDir || !menu.entry) && (
        <>
          <div style={itemStyle}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
            onClick={() => { setCreating("file"); setInputVal("") }}>
            New File
          </div>
          <div style={itemStyle}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
            onClick={() => { setCreating("folder"); setInputVal("") }}>
            New Folder
          </div>
          {menu.entry && <div style={{ height: "1px", background: "var(--border-subtle)", margin: "3px 0" }} />}
        </>
      )}
      {menu.entry && (
        <>
          <div style={itemStyle}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
            onClick={() => { setRenaming(true); setInputVal(menu.entry!.name) }}>
            Rename
          </div>
          <div style={itemStyle}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
            onClick={handleMove}>
            Move to…
          </div>
          <div style={{ height: "1px", background: "var(--border-subtle)", margin: "3px 0" }} />
          <div style={dangerStyle}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(225,29,72,0.1)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
            onClick={handleDelete}>
            Delete
          </div>
        </>
      )}
    </div>,
    document.body
  )
}

// ── File node ────────────────────────────────────────────────────────────────
interface FileNodeProps {
  entry: FileEntry
  depth?: number
  parentPath: string
  onContextMenu: (e: React.MouseEvent, entry: FileEntry, parentPath: string) => void
  onRefresh: () => Promise<void>
}

function FileNode({ entry, depth = 0, parentPath, onContextMenu, onRefresh }: FileNodeProps): JSX.Element {
  const { openFile, activeFile } = useProjectStore()
  const [expanded, setExpanded] = useState(depth === 0)

  const handleClick = async () => {
    if (entry.type === "directory") { setExpanded(v => !v); return }
    try {
      const content = await window.api.readFile(entry.path)
      openFile(entry.path, content ?? "")
    } catch (err) {
      console.error("[FileExplorer]", err)
    }
  }

  const isActive = activeFile === entry.path
  const isDir = entry.type === "directory"

  return (
    <div>
      <div
        onClick={handleClick}
        onContextMenu={e => { e.preventDefault(); onContextMenu(e, entry, parentPath) }}
        className="flex items-center gap-1.5 py-[3px] cursor-pointer rounded select-none transition-colors duration-100"
        style={{
          paddingLeft: `${8 + depth * 12}px`,
          paddingRight: "8px",
          fontSize: "12px",
          color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
          background: isActive ? "rgba(37,99,235,0.15)" : "transparent"
        }}
        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)" }}
        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent" }}
      >
        {isDir ? (
          <>
            <ChevronIcon open={expanded} />
            <FolderIcon open={expanded} />
          </>
        ) : (
          <>
            <span style={{ width: "9px", flexShrink: 0 }} />
            <FileIcon ext={entry.ext} />
          </>
        )}
        <span className="truncate" style={{ color: isActive ? "var(--text-primary)" : isDir ? "var(--text-primary)" : "var(--text-secondary)" }}>
          {entry.name}
        </span>
      </div>

      {isDir && expanded && entry.children && (
        <div className="animate-fade-in">
          {entry.children.map(child => (
            <FileNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              parentPath={entry.path}
              onContextMenu={onContextMenu}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── File explorer ────────────────────────────────────────────────────────────
export function FileExplorer(): JSX.Element {
  const { fileTree, projectPath, setFileTree } = useProjectStore()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const t = useT()

  const refresh = useCallback(async () => {
    if (!projectPath) return
    const tree = await window.api.readDir(projectPath)
    setFileTree(tree as never)
  }, [projectPath, setFileTree])

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry | null, parentPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    // Clamp to viewport
    const x = Math.min(e.clientX, window.innerWidth - 180)
    const y = Math.min(e.clientY, window.innerHeight - 180)
    setContextMenu({ x, y, entry, parentPath })
  }, [])

  const handleEmptyAreaContext = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleContextMenu(e, null, projectPath ?? "")
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="px-3 py-2 flex-shrink-0"
        style={{
          fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--text-muted)",
          borderBottom: "1px solid var(--border-subtle)"
        }}
      >
        {t("explorer")}
      </div>

      <div
        className="flex-1 overflow-y-auto py-1"
        onContextMenu={handleEmptyAreaContext}
      >
        {fileTree.length === 0 ? (
          <div className="px-3 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
            {t("noFiles")}
          </div>
        ) : (
          fileTree.map(entry => (
            <FileNode
              key={entry.path}
              entry={entry}
              parentPath={projectPath ?? ""}
              onContextMenu={handleContextMenu}
              onRefresh={refresh}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onRefresh={refresh}
        />
      )}
    </div>
  )
}
