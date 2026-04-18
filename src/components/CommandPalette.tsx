import { useState, useEffect, useMemo, useRef, type KeyboardEvent } from "react"

export interface Command {
  id: string
  label: string
  hint?: string
  shortcut?: string
  section: "Panels" | "Settings" | "File" | "AI" | "Project"
  run: () => void
  /** If false, command is hidden (e.g. requires project open). Defaults to true. */
  available?: boolean
}

interface Props {
  open: boolean
  commands: Command[]
  onClose: () => void
}

/**
 * Fuzzy command palette (Ctrl+Shift+P). Matches tokens against label+hint+section.
 * Flat list, arrow-key navigation, Enter to run, Esc to close.
 */
export function CommandPalette({ open, commands, onClose }: Props): JSX.Element | null {
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) {
      setQuery("")
      setIndex(0)
      // Defer so the element is mounted.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const items = useMemo(() => {
    const enabled = commands.filter((c) => c.available !== false)
    if (!query.trim()) return enabled
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    return enabled.filter((c) => {
      const haystack = `${c.section} ${c.label} ${c.hint ?? ""}`.toLowerCase()
      return tokens.every((t) => haystack.includes(t))
    })
  }, [commands, query])

  useEffect(() => {
    if (index >= items.length) setIndex(Math.max(0, items.length - 1))
  }, [items.length, index])

  // Keep selected item scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [index])

  if (!open) return null

  const run = (i: number): void => {
    const cmd = items[i]
    if (!cmd) return
    onClose()
    // Defer run so the close animation/state flush completes first.
    queueMicrotask(() => cmd.run())
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return }
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); return }
    if (e.key === "ArrowUp")   { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); return }
    if (e.key === "Enter")     { e.preventDefault(); run(index); return }
  }

  // Group by section, preserve filtered order within each section.
  const grouped: Array<{ section: string; cmds: Array<{ cmd: Command; gi: number }> }> = []
  items.forEach((cmd, gi) => {
    const last = grouped[grouped.length - 1]
    if (last && last.section === cmd.section) last.cmds.push({ cmd, gi })
    else grouped.push({ section: cmd.section, cmds: [{ cmd, gi }] })
  })

  const activeId = items[index] ? `cmd-${items[index].id}` : undefined

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] animate-fade-in"
      style={{ background: "rgba(5,8,15,0.88)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-[520px] rounded-lg overflow-hidden flex flex-col"
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIndex(0) }}
          onKeyDown={handleKey}
          placeholder="Type a command or search…"
          aria-label="Command palette search"
          aria-autocomplete="list"
          aria-controls="cmd-palette-list"
          aria-activedescendant={activeId}
          className="px-3 py-2.5 outline-none"
          style={{
            background: "transparent",
            color: "var(--text-primary)",
            fontSize: "13px",
            borderBottom: "1px solid var(--border-subtle)"
          }}
        />
        <div
          ref={listRef}
          id="cmd-palette-list"
          role="listbox"
          className="max-h-[50vh] overflow-y-auto"
          style={{ padding: "4px 0" }}
        >
          {items.length === 0 ? (
            <div className="px-3 py-4 text-center" style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              No commands match “{query}”.
            </div>
          ) : (
            grouped.map(({ section, cmds }) => (
              <div key={section} role="group" aria-label={section}>
                <div
                  className="px-3 pt-2 pb-0.5 select-none"
                  style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)" }}
                >
                  {section}
                </div>
                {cmds.map(({ cmd, gi }) => {
                  const active = gi === index
                  return (
                    <div
                      key={cmd.id}
                      id={`cmd-${cmd.id}`}
                      data-idx={gi}
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setIndex(gi)}
                      onMouseDown={(e) => { e.preventDefault(); run(gi) }}
                      className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
                      style={{
                        background: active ? "var(--bg-elevated)" : "transparent",
                        color: "var(--text-primary)",
                        fontSize: "12px",
                        borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent"
                      }}
                    >
                      <span className="flex-1 truncate">{cmd.label}</span>
                      {cmd.hint && (
                        <span className="truncate" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          {cmd.hint}
                        </span>
                      )}
                      {cmd.shortcut && (
                        <kbd
                          className="px-1.5 py-0.5 rounded font-mono"
                          style={{ fontSize: "10px", color: "var(--text-muted)", border: "1px solid var(--border-subtle)" }}
                        >
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
