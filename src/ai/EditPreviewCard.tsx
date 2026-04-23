import { useEffect, useMemo } from "react"
import { getFileName } from "../lib/utils"

interface EditPreviewCardProps {
  tool: string
  preview: EditPreviewPayload | null
  input: Record<string, unknown>
  onAccept: () => void
  onReject: () => void
}

interface DiffRow {
  kind: "add" | "del" | "ctx"
  content: string
}

// O(m*n) LCS allocates m*n cells. Guard at 2M cells (~8MB with Int32Array).
// Above this the preview falls back to a naïve "removed then added" list so
// the Electron renderer never freezes or OOMs on multi-megabyte edits.
const LCS_MAX_CELLS = 2_000_000

/**
 * LCS-based unified diff. Keeps unchanged context lines so edits read
 * naturally (like git diff --unified=3). For files too large to diff
 * (m*n > LCS_MAX_CELLS) falls back to a simple removed-then-added view.
 */
function buildUnifiedDiff(oldContent: string, newContent: string): DiffRow[] {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")
  const m = oldLines.length
  const n = newLines.length
  if (m * n > LCS_MAX_CELLS) {
    const oldSet = new Set(oldLines)
    const newSet = new Set(newLines)
    const removed = oldLines.filter((l) => !newSet.has(l)).slice(0, 200).map((content) => ({ kind: "del" as const, content }))
    const added = newLines.filter((l) => !oldSet.has(l)).slice(0, 200).map((content) => ({ kind: "add" as const, content }))
    return [
      { kind: "ctx", content: `… file too large for full diff (${m} → ${n} lines), showing changed lines only …` },
      ...removed,
      ...added,
    ]
  }
  // LCS table
  const lcs: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) lcs[i][j] = lcs[i + 1][j + 1] + 1
      else lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) { rows.push({ kind: "ctx", content: oldLines[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { rows.push({ kind: "del", content: oldLines[i] }); i++ }
    else { rows.push({ kind: "add", content: newLines[j] }); j++ }
  }
  while (i < m) { rows.push({ kind: "del", content: oldLines[i] }); i++ }
  while (j < n) { rows.push({ kind: "add", content: newLines[j] }); j++ }
  return trimContextRuns(rows)
}

const CONTEXT_LINES = 3

/** Collapse long runs of unchanged context into "… N lines" markers. */
function trimContextRuns(rows: DiffRow[]): DiffRow[] {
  const out: DiffRow[] = []
  let ctxBuffer: DiffRow[] = []
  const flush = (isEnd: boolean) => {
    if (ctxBuffer.length === 0) return
    const leadCount = out.length === 0 ? 0 : CONTEXT_LINES
    const trailCount = isEnd ? 0 : CONTEXT_LINES
    const keep = leadCount + trailCount
    if (ctxBuffer.length <= keep + 1) {
      out.push(...ctxBuffer)
    } else {
      out.push(...ctxBuffer.slice(0, leadCount))
      const hidden = ctxBuffer.length - leadCount - trailCount
      out.push({ kind: "ctx", content: `… ${hidden} unchanged line${hidden === 1 ? "" : "s"} …` })
      out.push(...ctxBuffer.slice(-trailCount))
    }
    ctxBuffer = []
  }
  for (const row of rows) {
    if (row.kind === "ctx") ctxBuffer.push(row)
    else { flush(false); out.push(row) }
  }
  flush(true)
  return out
}

export function EditPreviewCard({ tool, preview, input, onAccept, onReject }: EditPreviewCardProps): JSX.Element {
  const path = preview?.path ?? String(input.path ?? "")
  const kind = preview?.kind ?? (tool === "CreateFile" ? "create" : tool === "Delete" ? "delete" : "edit")
  const oldContent = preview?.oldContent ?? ""
  const newContent = preview?.newContent ?? ""
  const hasError = Boolean(preview?.error)

  const rows = useMemo(() => {
    if (kind === "delete") return oldContent.split("\n").map((l) => ({ kind: "del" as const, content: l }))
    if (kind === "create") return (newContent || "").split("\n").map((l) => ({ kind: "add" as const, content: l }))
    return buildUnifiedDiff(oldContent, newContent || "")
  }, [kind, oldContent, newContent])

  const stat = useMemo(() => {
    let added = 0, removed = 0
    for (const r of rows) {
      if (r.kind === "add") added++
      else if (r.kind === "del") removed++
    }
    return { added, removed }
  }, [rows])

  // Keyboard shortcuts — mounted lifetime only. Y / N only (no D toggle).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null
      const typing = tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)
      if (typing) return
      if (e.key === "y" || e.key === "Y") { e.preventDefault(); onAccept() }
      else if (e.key === "n" || e.key === "N") { e.preventDefault(); onReject() }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onAccept, onReject])

  const kindLabel = kind === "create" ? "Create" : kind === "delete" ? "Delete" : "Edit"
  const kindColor = kind === "delete" ? "var(--danger)" : kind === "create" ? "var(--success)" : "var(--accent)"

  return (
    <div
      className="mx-2 mb-2 rounded-xl animate-fade-in flex flex-col"
      style={{
        background: "var(--bg-elevated)",
        border: `1px solid ${hasError ? "rgba(239,68,68,0.4)" : "var(--border)"}`,
        overflow: "hidden",
        flexShrink: 0   // parent is flex-col with overflow-y-auto; prevent collapse
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: kindColor }}>{kindLabel}</span>
        <span className="truncate" style={{ fontSize: 11, color: "var(--text-primary)", fontFamily: "'JetBrains Mono', monospace" }}>
          {getFileName(path)}
        </span>
        <span className="ml-auto flex items-center gap-2" style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
          {stat.added > 0 && <span style={{ color: "var(--success)" }}>+{stat.added}</span>}
          {stat.removed > 0 && <span style={{ color: "var(--danger)" }}>-{stat.removed}</span>}
        </span>
      </div>

      {/* Error banner */}
      {hasError && (
        <div className="px-3 py-2" style={{ fontSize: 11, color: "var(--danger)", background: "rgba(239,68,68,0.08)" }}>
          Cannot preview: {preview?.error}
        </div>
      )}

      {/* Unified diff — always visible, scrollable */}
      {!hasError && rows.length > 0 && (
        <div
          className="selectable"
          style={{
            background: "var(--bg-base)",
            maxHeight: 320,
            overflowY: "auto",
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1.5,
          }}
        >
          {rows.map((row, i) => {
            const bg =
              row.kind === "add" ? "rgba(34,197,94,0.08)"
              : row.kind === "del" ? "rgba(239,68,68,0.08)"
              : "transparent"
            const prefix = row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "
            const color =
              row.kind === "add" ? "var(--success)"
              : row.kind === "del" ? "var(--danger)"
              : "var(--text-muted)"
            return (
              <div
                key={i}
                style={{
                  background: bg,
                  color: row.kind === "ctx" ? "var(--text-secondary)" : "var(--text-primary)",
                  padding: "1px 12px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  display: "flex",
                }}
              >
                <span style={{ color, width: 12, flexShrink: 0, userSelect: "none" }}>{prefix}</span>
                <span>{row.content}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Actions — always visible at bottom */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}
      >
        <button
          onClick={onAccept}
          className="no-press-scale rounded-md px-3 py-1 transition-colors duration-100"
          style={{ fontSize: 11, fontWeight: 500, color: "white", background: "var(--accent)", border: "none" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--accent-hover)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--accent)")}
        >
          Accept
        </button>
        <button
          onClick={onReject}
          className="no-press-scale rounded-md px-3 py-1 transition-colors duration-100"
          style={{ fontSize: 11, color: "var(--text-primary)", background: "transparent", border: "1px solid var(--border)" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-hover)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
        >
          Reject
        </button>
        <span className="ml-auto" style={{ fontSize: 10, color: "var(--text-muted)" }}>
          Y / N
        </span>
      </div>
    </div>
  )
}
