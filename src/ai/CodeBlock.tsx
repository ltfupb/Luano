import { useState } from "react"
import { DiffView } from "./DiffView"
import { useProjectStore } from "../stores/projectStore"
import { useAIStore } from "../stores/aiStore"
import { useT } from "../i18n/useT"

interface CodeBlockProps {
  code: string
  lang: string
}

function IconCopy(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function CodeBlock({ code, lang }: CodeBlockProps): JSX.Element {
  const [showDiff, setShowDiff] = useState(false)
  const [applied, setApplied] = useState(false)
  const [copied, setCopied] = useState(false)
  const { activeFile, fileContents, updateFileContent } = useProjectStore()
  const { autoAccept } = useAIStore()
  const canApply = !!activeFile
  const currentContent = activeFile ? (fileContents[activeFile] ?? "") : ""
  const t = useT()

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const applyDirect = async () => {
    if (!activeFile) return
    updateFileContent(activeFile, code)
    await window.api.writeFile(activeFile, code)
    setApplied(true)
  }

  const handleApply = () => {
    if (!activeFile) return
    if (autoAccept) {
      applyDirect()
    } else {
      setShowDiff(true)
    }
  }

  const handleAccept = async () => {
    await applyDirect()
    setShowDiff(false)
  }

  return (
    <>
      <div
        className="rounded-xl overflow-hidden my-1"
        style={{ border: "1px solid var(--border)", background: "var(--bg-base)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-1.5"
          style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-panel)" }}
        >
          <span
            className="font-mono"
            style={{ fontSize: "10px", color: "var(--text-muted)", letterSpacing: "0.04em" }}
          >
            {lang || "lua"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-150"
              style={{
                fontSize: "10px",
                color: copied ? "#10b981" : "var(--text-muted)"
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = copied ? "#10b981" : "var(--text-muted)"}
            >
              <IconCopy />
              {copied ? "Copied!" : t("copy")}
            </button>
            {canApply && (
              <button
                onClick={handleApply}
                disabled={applied}
                className="px-2 py-0.5 rounded transition-all duration-150"
                style={{
                  fontSize: "10px",
                  color: applied ? "#10b981" : "#60a5fa",
                  background: applied ? "rgba(16,185,129,0.1)" : "rgba(37,99,235,0.12)",
                  border: `1px solid ${applied ? "rgba(16,185,129,0.25)" : "rgba(37,99,235,0.3)"}`,
                  cursor: applied ? "default" : "pointer"
                }}
              >
                {applied ? t("applied") : t("apply")}
              </button>
            )}
          </div>
        </div>

        {/* Code content */}
        <pre
          className="p-3 overflow-x-auto selectable"
          style={{
            fontSize: "12px",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            color: "#d4e2f4",
            lineHeight: "1.6",
            whiteSpace: "pre",
            background: "var(--bg-base)"
          }}
        >
          {code}
        </pre>
      </div>

      {/* Diff preview modal */}
      {showDiff && (
        <div
          className="fixed inset-0 z-50 flex flex-col animate-fade-in"
          style={{ background: "rgba(5,8,15,0.92)", backdropFilter: "blur(12px)" }}
        >
          <div
            className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
            style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}
          >
            <span
              className="font-semibold"
              style={{ fontSize: "12px", color: "#60a5fa" }}
            >
              {t("diffPreview")}
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              {activeFile?.split(/[/\\]/).pop()}
            </span>
            <span
              className="ml-auto"
              style={{ fontSize: "11px", color: "var(--text-muted)" }}
            >
              {t("diffHint")}
            </span>
          </div>

          <div className="flex-1 overflow-hidden min-h-0">
            <DiffView original={currentContent} modified={code} />
          </div>

          <div
            className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
            style={{ borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}
          >
            <button
              onClick={handleAccept}
              className="px-4 py-1.5 rounded-lg font-medium transition-all duration-150"
              style={{
                background: "#10b981",
                color: "white",
                fontSize: "12px"
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#059669"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#10b981"}
            >
              {t("accept")}
            </button>
            <button
              onClick={() => setShowDiff(false)}
              className="px-4 py-1.5 rounded-lg transition-all duration-150"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
                fontSize: "12px",
                border: "1px solid var(--border)"
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
