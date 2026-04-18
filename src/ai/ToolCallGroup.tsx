import { useState, useEffect } from "react"
import { ChatMessage } from "../stores/aiStore"
import { getFileName } from "../lib/utils"

const TOOL_META: Record<string, { label: string; icon: string; bridge?: boolean }> = {
  read_file:            { label: "Read",               icon: "eye" },
  edit_file:            { label: "Edit",               icon: "pencil" },
  create_file:          { label: "Create",             icon: "plus" },
  delete_file:          { label: "Delete",             icon: "trash" },
  list_files:           { label: "List",               icon: "folder" },
  grep:                 { label: "Search",             icon: "search" },
  grep_files:           { label: "Search",             icon: "search" },
  search_docs:          { label: "Docs",               icon: "book" },
  lint_file:            { label: "Lint",               icon: "check" },
  type_check:           { label: "Type check",         icon: "check" },
  format_file:          { label: "Format",             icon: "check" },
  multi_edit:           { label: "Multi-edit",         icon: "pencil" },
  patch_file:           { label: "Patch",              icon: "pencil" },
  todo_write:           { label: "Todo",               icon: "check" },
  wag_read:             { label: "WAG read",           icon: "book" },
  wag_search:           { label: "WAG search",         icon: "search" },
  wag_update:           { label: "WAG update",         icon: "check" },
  ask_user:             { label: "Ask user",           icon: "chat" },
  read_instance_tree:   { label: "Studio tree",        icon: "tree",   bridge: true },
  get_runtime_logs:     { label: "Studio logs",        icon: "log",    bridge: true },
  run_studio_script:    { label: "Run in Studio",      icon: "play",   bridge: true },
  set_property:         { label: "Studio set",         icon: "gear",   bridge: true },
  insert_model:         { label: "Insert model",       icon: "plus",   bridge: true }
}

function ToolIcon({ type, size = 12 }: { type: string; size?: number }): JSX.Element {
  const s = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  switch (type) {
    case "eye":    return <svg {...s}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
    case "pencil": return <svg {...s}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
    case "plus":   return <svg {...s}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
    case "trash":  return <svg {...s}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
    case "folder": return <svg {...s}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
    case "search": return <svg {...s}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
    case "book":   return <svg {...s}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
    case "check":  return <svg {...s}><polyline points="20 6 9 17 4 12" /></svg>
    case "chat":   return <svg {...s}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
    case "tree":   return <svg {...s}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
    case "log":    return <svg {...s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
    case "play":   return <svg {...s}><polygon points="5 3 19 12 5 21 5 3" /></svg>
    case "gear":   return <svg {...s}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
    default:       return <svg {...s}><circle cx="12" cy="12" r="10" /></svg>
  }
}

const FILE_TOOLS = new Set(["read_file", "edit_file", "create_file", "delete_file", "list_files", "grep", "grep_files", "lint_file", "type_check", "format_file", "multi_edit", "patch_file"])

function getToolTarget(event: ChatMessage): string {
  if (!FILE_TOOLS.has(event.toolName ?? "")) return ""
  const pathMatch = event.content?.match(/(?:^|\s)([\w.\\/:-]+\.\w+)/)
  return pathMatch ? getFileName(pathMatch[1]) : ""
}

/**
 * Flat list of consecutive tool-call events — one row per invocation, like
 * Claude Code's CLI output. Failed tools auto-expand their output so errors
 * jump out. Normal tools stay collapsed; click the row to peek at raw output.
 * A subtle left border groups the rows visually without being a container.
 */
export function ToolCallGroup({ events }: { events: ChatMessage[] }): JSX.Element {
  const failedIds = events.filter((e) => e.toolSuccess === false).map((e) => e.id)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(failedIds))

  // Auto-expand any new failures as streaming adds them
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of failedIds) next.add(id)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedIds.join(",")])

  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div
      className="animate-fade-in"
      style={{
        borderLeft: "1px solid var(--border-subtle)",
        paddingLeft: 8,
        margin: "4px 0",
        display: "flex",
        flexDirection: "column",
        gap: 1
      }}
    >
      {events.map((event) => {
        const toolName = event.toolName ?? "unknown"
        const meta = TOOL_META[toolName] ?? { label: toolName, icon: "default" }
        const isBridge = meta.bridge === true
        const failed = event.toolSuccess === false
        const target = getToolTarget(event)
        const isOpen = expanded.has(event.id)

        const tone = failed ? "var(--danger)" : isBridge ? "var(--accent)" : "var(--text-muted)"

        return (
          <div key={event.id}>
            <button
              onClick={() => toggle(event.id)}
              className="flex items-center gap-2 w-full rounded transition-colors duration-100"
              style={{ textAlign: "left", padding: "2px 4px", minHeight: 22 }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
            >
              <span className="flex-shrink-0" style={{ color: tone, opacity: failed ? 1 : 0.75 }}>
                {failed ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                ) : (
                  <ToolIcon type={meta.icon} size={12} />
                )}
              </span>
              <span
                className="truncate"
                style={{
                  fontSize: "12px",
                  color: tone,
                  fontWeight: failed ? 500 : 400
                }}
              >
                {meta.label}
                {target && (
                  <span style={{ color: "var(--text-primary)", marginLeft: 6, opacity: 0.85 }}>
                    {target}
                  </span>
                )}
              </span>
            </button>
            {isOpen && (
              <div
                className="ml-5 mb-1 rounded selectable animate-fade-in"
                style={{
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: "1.6",
                  wordBreak: "break-all",
                  whiteSpace: "pre-wrap",
                  padding: "4px 8px",
                  background: "var(--bg-base)",
                  border: "1px solid var(--border-subtle)",
                  maxHeight: 180,
                  overflowY: "auto"
                }}
              >
                {event.content || <span style={{ fontStyle: "italic", opacity: 0.5 }}>No output</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
