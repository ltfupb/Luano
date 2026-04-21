import { useEffect, useMemo, useState } from "react"
import { DiffView } from "./DiffView"
import { getFileName } from "../lib/utils"

interface EditPreviewCardProps {
  tool: string
  preview: EditPreviewPayload | null
  input: Record<string, unknown>
  onAccept: () => void
  onReject: () => void
}

function countDiffLines(oldContent: string, newContent: string): { added: number; removed: number } {
  // Cheap line-count diff — good enough for the header stat.
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  let added = 0, removed = 0
  for (const l of newLines) if (!oldSet.has(l)) added++
  for (const l of oldLines) if (!newSet.has(l)) removed++
  return { added, removed }
}

const MINI_DIFF_MAX_LINES = 12

function buildMiniDiff(oldContent: string, newContent: string): string[] {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  const out: string[] = []
  let removed = 0, added = 0
  for (const l of oldLines) if (!newSet.has(l)) { out.push(`- ${l}`); removed++; if (out.length >= MINI_DIFF_MAX_LINES) break }
  if (out.length < MINI_DIFF_MAX_LINES) {
    for (const l of newLines) if (!oldSet.has(l)) { out.push(`+ ${l}`); added++; if (out.length >= MINI_DIFF_MAX_LINES) break }
  }
  if (removed + added === 0) out.push("(no textual changes)")
  return out
}

export function EditPreviewCard({ tool, preview, input, onAccept, onReject }: EditPreviewCardProps): JSX.Element {
  const [showFull, setShowFull] = useState(false)

  const path = preview?.path ?? String(input.path ?? "")
  const kind = preview?.kind ?? (tool === "Write" ? "create" : tool === "Delete" ? "delete" : "edit")
  const oldContent = preview?.oldContent ?? ""
  const newContent = preview?.newContent ?? ""
  const hasError = Boolean(preview?.error)

  const stat = useMemo(() => {
    if (kind === "delete") return { added: 0, removed: oldContent.split("\n").length }
    if (kind === "create") return { added: (newContent || "").split("\n").length, removed: 0 }
    return countDiffLines(oldContent, newContent || "")
  }, [kind, oldContent, newContent])

  const miniDiff = useMemo(() => {
    if (kind === "delete") return ["(file will be deleted)"]
    if (kind === "create") {
      return (newContent || "").split("\n").slice(0, MINI_DIFF_MAX_LINES).map((l) => `+ ${l}`)
    }
    return buildMiniDiff(oldContent, newContent || "")
  }, [kind, oldContent, newContent])

  // Keyboard shortcuts — active while this card is mounted
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input
      const tgt = e.target as HTMLElement | null
      const typing = tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)
      if (typing) return
      if (e.key === "y" || e.key === "Y") { e.preventDefault(); onAccept() }
      else if (e.key === "n" || e.key === "N") { e.preventDefault(); onReject() }
      else if (e.key === "d" || e.key === "D") { e.preventDefault(); setShowFull((v) => !v) }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onAccept, onReject])

  const kindLabel = kind === "create" ? "New file" : kind === "delete" ? "Delete file" : "Edit file"
  const kindColor = kind === "delete" ? "var(--danger)" : kind === "create" ? "var(--success)" : "var(--accent)"

  return (
    <div
      className="mx-2 mb-2 rounded-xl animate-fade-in"
      style={{ background: "var(--bg-elevated)", border: `1px solid ${hasError ? "rgba(239,68,68,0.4)" : "var(--border)"}`, overflow: "hidden" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: kindColor }}>{kindLabel}</span>
        <span className="truncate" style={{ fontSize: 11, color: "var(--text-primary)" }}>{getFileName(path)}</span>
        <span className="ml-auto flex items-center gap-2" style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
          {stat.added > 0 && <span style={{ color: "var(--success)" }}>+{stat.added}</span>}
          {stat.removed > 0 && <span style={{ color: "var(--danger)" }}>-{stat.removed}</span>}
        </span>
      </div>

      {/* Error banner (preview couldn't simulate) */}
      {hasError && (
        <div className="px-3 py-2" style={{ fontSize: 11, color: "var(--danger)", background: "rgba(239,68,68,0.08)" }}>
          Cannot preview: {preview?.error}
        </div>
      )}

      {/* Mini diff OR full diff */}
      {!showFull && !hasError && (
        <pre
          className="selectable"
          style={{
            margin: 0, padding: "8px 12px",
            fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            color: "var(--text-primary)", background: "var(--bg-base)",
            maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word"
          }}
        >
          {miniDiff.map((line, i) => (
            <div key={i} style={{
              color: line.startsWith("+") ? "var(--success)" : line.startsWith("-") ? "var(--danger)" : "var(--text-muted)"
            }}>{line}</div>
          ))}
        </pre>
      )}

      {showFull && kind !== "delete" && !hasError && (
        <div style={{ height: 360, background: "var(--bg-base)" }}>
          <DiffView original={oldContent} modified={newContent || ""} />
        </div>
      )}

      {/* Footer — actions */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <button
          onClick={onAccept}
          className="no-press-scale rounded px-3 py-1 transition-colors duration-100"
          style={{ fontSize: 11, fontWeight: 500, color: "white", background: "var(--accent)", border: "none" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--accent-hover)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--accent)")}
        >
          Accept <span style={{ opacity: 0.7, marginLeft: 4 }}>Y</span>
        </button>
        <button
          onClick={onReject}
          className="no-press-scale rounded px-3 py-1 transition-colors duration-100"
          style={{ fontSize: 11, color: "var(--text-primary)", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-hover)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-surface)")}
        >
          Reject <span style={{ opacity: 0.6, marginLeft: 4 }}>N</span>
        </button>
        {kind !== "delete" && !hasError && (
          <button
            onClick={() => setShowFull((v) => !v)}
            className="no-press-scale ml-auto rounded px-2 py-1 transition-colors duration-100"
            style={{ fontSize: 11, color: "var(--text-muted)", background: "transparent", border: "none" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-primary)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}
          >
            {showFull ? "Hide diff" : "Show diff"} <span style={{ opacity: 0.6, marginLeft: 4 }}>D</span>
          </button>
        )}
      </div>
    </div>
  )
}
