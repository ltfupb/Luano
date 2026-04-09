import { useState, useRef, useEffect, useCallback } from "react"
import { DiffView } from "./DiffView"
import { useAIStore } from "../stores/aiStore"

// Platform-aware key label (same logic as EditorPane)
const isMac = typeof navigator !== "undefined" &&
  (navigator.platform.toLowerCase().includes("mac") ||
   navigator.userAgent.toLowerCase().includes("mac os"))
const KB_LABEL = isMac ? "⌘K" : "Ctrl+K"

interface InlineEditOverlayProps {
  filePath: string
  content: string
  onAccept: (newContent: string) => void
  onClose: () => void
}

export function InlineEditOverlay({
  filePath,
  content,
  onAccept,
  onClose
}: InlineEditOverlayProps): JSX.Element {
  const [instruction, setInstruction] = useState("")
  const [loading, setLoading] = useState(false)
  const [modifiedContent, setModifiedContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { globalSummary } = useAIStore()

  useEffect(() => {
    inputRef.current?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  const handleSubmit = useCallback(async () => {
    if (!instruction.trim() || loading) return
    setLoading(true)
    setError(null)

    try {
      const context = { globalSummary, currentFile: filePath }
      const result = await window.api.inlineEdit(filePath, content, instruction, context)
      setModifiedContent(result)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [instruction, loading, filePath, content, globalSummary])

  const fileName = filePath.split(/[/\\]/).pop() ?? filePath

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col"
      style={{ background: "var(--bg-base)", opacity: 0.98 }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-panel)" }}
      >
        <span style={{ fontSize: "11px", color: "var(--accent)", fontWeight: 600 }}>
          {KB_LABEL} Inline Edit
        </span>
        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{fileName}</span>
        <button
          onClick={onClose}
          className="ml-auto px-2 py-1 rounded transition-all duration-100"
          style={{ fontSize: "11px", color: "var(--text-muted)", background: "transparent" }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"
            ;(e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"
            ;(e.currentTarget as HTMLElement).style.background = "transparent"
          }}
        >
          ESC
        </button>
      </div>

      {/* Instruction input */}
      {!modifiedContent && (
        <div
          className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <input
            ref={inputRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="What to change? (e.g. add type annotations, add error handling, optimize performance)"
            className="flex-1 rounded-lg px-3 py-2 focus:outline-none transition-all duration-150"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontSize: "13px"
            }}
            onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
            onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
          />
          <button
            onClick={handleSubmit}
            disabled={!instruction.trim() || loading}
            className="px-4 py-2 rounded-lg font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            style={{ background: "var(--accent)", color: "white", fontSize: "12px" }}
            onMouseEnter={e => {
              if (!(e.currentTarget as HTMLButtonElement).disabled)
                (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"
            }}
            onMouseLeave={e => {
              if (!(e.currentTarget as HTMLButtonElement).disabled)
                (e.currentTarget as HTMLElement).style.background = "var(--accent)"
            }}
          >
            {loading ? (
              <span className="flex items-center gap-1">
                <span className="animate-spin inline-block">⟳</span> Generating…
              </span>
            ) : "Edit"}
          </button>
        </div>
      )}

      {error && (
        <div
          className="px-4 py-2 flex items-center gap-2 flex-shrink-0"
          style={{
            fontSize: "12px",
            color: "#fb7185",
            background: "rgba(225,29,72,0.08)",
            borderBottom: "1px solid var(--border-subtle)"
          }}
        >
          <span>Error: {error}</span>
          <button
            onClick={() => setError(null)}
            style={{ color: "var(--text-muted)", marginLeft: "auto" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
          >
            Close
          </button>
        </div>
      )}

      {/* Diff preview */}
      {modifiedContent && (
        <>
          <div
            className="px-4 py-2 flex items-center gap-2 flex-shrink-0"
            style={{
              fontSize: "11px",
              color: "var(--text-muted)",
              borderBottom: "1px solid var(--border-subtle)",
              background: "var(--bg-panel)"
            }}
          >
            <span>Preview Changes</span>
            <span style={{ color: "var(--text-ghost)" }}>— Left: original / Right: modified</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <DiffView original={content} modified={modifiedContent} />
          </div>
          <div
            className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
            style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--bg-panel)" }}
          >
            <button
              onClick={() => onAccept(modifiedContent)}
              className="px-4 py-1.5 rounded-lg font-medium transition-all duration-150"
              style={{ background: "#10b981", color: "white", fontSize: "12px" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#059669"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#10b981"}
            >
              ✓ Accept
            </button>
            <button
              onClick={() => {
                setModifiedContent(null)
                setInstruction("")
                setTimeout(() => inputRef.current?.focus(), 0)
              }}
              className="px-4 py-1.5 rounded-lg transition-all duration-150"
              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: "12px", border: "1px solid var(--border)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"}
            >
              Retry
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg transition-all duration-150"
              style={{ background: "transparent", color: "var(--text-muted)", fontSize: "12px" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
