import { useState } from "react"
import { ChatMessage } from "../stores/aiStore"
import { getFileName } from "../lib/utils"

const TOOL_META: Record<string, { label: string; icon: string; bridge?: boolean }> = {
  Read:             { label: "Read",               icon: "eye" },
  Edit:             { label: "Edit",               icon: "pencil" },
  Write:            { label: "Create",             icon: "plus" },
  Delete:           { label: "Delete",             icon: "trash" },
  Glob:             { label: "List",               icon: "folder" },
  Grep:             { label: "Search",             icon: "search" },
  SearchDocs:       { label: "Docs",               icon: "book" },
  Lint:             { label: "Lint",               icon: "check" },
  TypeCheck:        { label: "Type check",         icon: "check" },
  Format:           { label: "Format",             icon: "check" },
  MultiEdit:        { label: "Multi edit",         icon: "pencil" },
  Patch:            { label: "Patch",              icon: "pencil" },
  TodoWrite:        { label: "Todo",               icon: "check" },
  WagRead:          { label: "WAG read",           icon: "book" },
  WagSearch:        { label: "WAG search",         icon: "search" },
  WagUpdate:        { label: "WAG update",         icon: "check" },
  AskUser:          { label: "Ask user",           icon: "chat" },
  ReadInstanceTree: { label: "Studio tree",        icon: "tree",   bridge: true },
  RuntimeLogs:      { label: "Studio logs",        icon: "log",    bridge: true },
  RunScript:        { label: "Run in Studio",      icon: "play",   bridge: true },
  SetProperty:      { label: "Studio set",         icon: "gear",   bridge: true },
  InsertModel:      { label: "Insert model",       icon: "plus",   bridge: true }
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

const FILE_TOOLS = new Set(["Read", "Edit", "Write", "Delete", "Glob", "Grep", "Lint", "TypeCheck", "Format", "MultiEdit", "Patch"])

function getToolTarget(event: ChatMessage): string {
  if (!FILE_TOOLS.has(event.toolName ?? "")) return ""
  // Prefer the input path captured at tool-call time. Fallback regex over
  // output text is for old persisted sessions that predate toolPath —
  // don't remove it or their tool rows lose the filename label.
  if (event.toolPath) return getFileName(event.toolPath)
  const pathMatch = event.content?.match(/(?:^|\s)([\w.\\/:-]+\.\w+)/)
  return pathMatch ? getFileName(pathMatch[1]) : ""
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: "transform 120ms ease", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

/**
 * Tool-call group — phone-app style accordion.
 *
 * - 1 tool: renders as a single row (no wrapping header).
 * - 2+ tools: collapsed header showing "N tools" + a preview of the tool labels.
 *   Click to expand. Expanded view shows each tool row with a vertical guide line
 *   on the left. Each row is independently clickable to reveal its raw output.
 */
export function ToolCallGroup({ events }: { events: ChatMessage[] }): JSX.Element {
  const multi = events.length > 1
  // Multi-tool groups collapse behind a summary header by default.
  // Single tool: always "open" — there's nothing to collapse.
  const [groupOpen, setGroupOpen] = useState(!multi)
  const [rowsOpen, setRowsOpen] = useState<Set<string>>(() => new Set())

  const toggleRow = (id: string): void =>
    setRowsOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const failedCount = events.filter((e) => e.toolSuccess === false).length

  return (
    <div
      className="animate-fade-in rounded-md"
      style={{ overflow: "hidden" }}
    >
      {/* Collapsed summary header — only shown for multi-tool groups */}
      {multi && (
        <button
          onClick={() => setGroupOpen((v) => !v)}
          className="flex items-center gap-2 w-full transition-colors duration-100 no-press-scale"
          style={{
            textAlign: "left",
            padding: "6px 10px",
            background: "transparent",
            borderBottom: groupOpen ? "1px solid var(--border-subtle)" : "none"
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-surface)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
        >
          <span style={{ color: "var(--text-muted)" }}>
            <Chevron open={groupOpen} />
          </span>
          <span style={{ fontSize: 12, color: "var(--text-primary)" }}>
            {events.length} tools used
          </span>
          {failedCount > 0 && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                color: "var(--danger)",
                fontWeight: 500,
                background: "rgba(239,68,68,0.12)",
                padding: "1px 6px",
                borderRadius: 4
              }}
            >
              {failedCount} failed
            </span>
          )}
        </button>
      )}

      {/* Expanded rows — short vertical tick segments BETWEEN icons connect them
          visually without a full-height guide line. Aligned with the icon center
          so each row reads like a bullet on a ticked list. */}
      {groupOpen && (
        <div
          style={{
            padding: multi ? "4px 4px 4px 6px" : "2px 4px",
            display: "flex",
            flexDirection: "column",
            gap: 0
          }}
        >
          {events.map((event, i) => {
            const toolName = event.toolName ?? "unknown"
            const meta = TOOL_META[toolName] ?? { label: toolName, icon: "default" }
            const isBridge = meta.bridge === true
            const failed = event.toolSuccess === false
            const target = getToolTarget(event)
            const isOpen = rowsOpen.has(event.id)
            const tone = failed ? "var(--danger)" : isBridge ? "var(--accent)" : "var(--text-muted)"
            const isLast = i === events.length - 1

            return (
              <div key={event.id}>
                <button
                  onClick={() => toggleRow(event.id)}
                  className="flex items-center gap-2 w-full rounded transition-colors duration-100 no-press-scale"
                  style={{ textAlign: "left", padding: "2px 6px", minHeight: 22 }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-surface)")}
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
                    className="rounded selectable"
                    style={{
                      marginLeft: 20,
                      marginRight: 4,
                      marginBottom: 4,
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
                {/* Tick segment between this row and the next — aligned with the
                    icon center so the rows look connected without a full rail. */}
                {multi && !isLast && (
                  <div
                    aria-hidden
                    style={{
                      height: 10,
                      marginLeft: 12,     // button padding-left (6) + icon half (6)
                      width: 1,
                      background: "var(--border)"
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
