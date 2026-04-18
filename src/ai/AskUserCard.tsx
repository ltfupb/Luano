import React, { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Interactive question card shown when AI invokes the `ask_user` tool.
 *
 * - Single-select (default): radio-style. Click to select.
 * - multiSelect: checkbox-style. Click to toggle. Selections joined with ", ".
 * - Optional preview panel for options with markdown-rich previews (single-select only).
 *
 * Submit is disabled until every question has at least one answer selected.
 * Answers keyed by question index (string) — avoids collisions when AI sends
 * identical question text twice.
 */
export function AskUserCard({ request, onSubmit }: {
  request: { id: string; questions: AskUserQuestion[] }
  onSubmit: (id: string, answers: Record<string, string>) => void
}): JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [focusedPreviews, setFocusedPreviews] = useState<Record<number, number>>({})

  const allAnswered = request.questions.every((_, i) => (answers[String(i)] ?? "").length > 0)

  const select = (qIdx: number, label: string, multi: boolean) => {
    if (!multi) {
      setAnswers(prev => ({ ...prev, [String(qIdx)]: label }))
      setFocusedPreviews(prev => ({ ...prev, [qIdx]: -1 }))
      return
    }
    setAnswers(prev => {
      const current = prev[String(qIdx)] ? prev[String(qIdx)].split(", ") : []
      const idx = current.indexOf(label)
      const next = idx >= 0 ? current.filter((l) => l !== label) : [...current, label]
      return { ...prev, [String(qIdx)]: next.join(", ") }
    })
  }

  return (
    <div className="mx-2 mb-2 rounded-xl animate-fade-in" style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
      {request.questions.map((q, qIdx) => {
        const focusedOpt = focusedPreviews[qIdx] ?? -1
        const selectedRaw = answers[String(qIdx)] ?? ""
        const selectedLabels = q.multiSelect ? selectedRaw.split(", ").filter(Boolean) : [selectedRaw]
        const previewOpt = focusedOpt >= 0 ? q.options[focusedOpt] : q.options.find(o => o.label === selectedLabels[0])
        const hasPreview = !q.multiSelect && q.options.some(o => o.preview)

        return (
          <div key={qIdx} style={{ borderBottom: qIdx < request.questions.length - 1 ? "1px solid var(--border-subtle)" : undefined }}>
            <div className="px-3 pt-3 pb-2 flex items-start gap-2">
              <span className="px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0" style={{ background: "var(--accent-muted)", color: "var(--accent)", fontSize: "11px" }}>
                {q.header.slice(0, 12)}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-primary)", lineHeight: 1.5 }}>{q.question}</span>
              {q.multiSelect && <span style={{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "auto", flexShrink: 0 }}>multi</span>}
            </div>

            <div className={`flex ${hasPreview ? "gap-0" : ""}`}>
              <div className={`${hasPreview ? "w-48 flex-shrink-0" : "flex-1"} px-2 pb-2`}>
                {q.options.map((opt, oIdx) => {
                  const isSelected = selectedLabels.includes(opt.label)
                  return (
                    <button
                      key={oIdx}
                      className="w-full text-left px-2 py-1.5 rounded-md mb-0.5 transition-colors duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                      style={{
                        fontSize: "12px",
                        background: isSelected ? "var(--accent-muted)" : focusedOpt === oIdx ? "var(--bg-tertiary, var(--bg-secondary))" : "transparent",
                        color: isSelected ? "var(--accent)" : "var(--text-primary)",
                        border: isSelected ? "1px solid var(--accent-border, rgba(37,99,235,0.3))" : "1px solid transparent",
                        outlineColor: "var(--accent)"
                      }}
                      onMouseEnter={() => setFocusedPreviews(prev => ({ ...prev, [qIdx]: oIdx }))}
                      onMouseLeave={() => setFocusedPreviews(prev => ({ ...prev, [qIdx]: -1 }))}
                      onClick={() => select(qIdx, opt.label, !!q.multiSelect)}
                    >
                      <div className="font-medium">{opt.label}{isSelected && " ✓"}</div>
                      {opt.description && (
                        <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "1px" }}>{opt.description}</div>
                      )}
                    </button>
                  )
                })}
              </div>

              {hasPreview && previewOpt?.preview && (
                <div className="flex-1 px-3 py-2 border-l overflow-auto" style={{ borderColor: "var(--border-subtle)", maxHeight: "160px" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code({ children }: { children?: React.ReactNode }) { return <code style={{ fontSize: "11px", background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: "3px" }}>{children}</code> } }}>
                    {previewOpt.preview}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )
      })}

      <div className="px-3 py-2 flex justify-end" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <button
          disabled={!allAnswered}
          onClick={() => { if (allAnswered) onSubmit(request.id, answers) }}
          className="px-3 py-1 rounded-md font-medium transition-colors duration-150"
          style={{
            fontSize: "12px",
            background: allAnswered ? "var(--accent)" : "var(--bg-secondary)",
            color: allAnswered ? "var(--text-on-accent, white)" : "var(--text-muted)",
            cursor: allAnswered ? "pointer" : "not-allowed"
          }}
        >
          Submit
        </button>
      </div>
    </div>
  )
}
