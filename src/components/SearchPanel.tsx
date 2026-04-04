// src/components/SearchPanel.tsx
// Project-wide text search (Ctrl+Shift+F)

import { useState, useRef, useCallback } from "react"
import { useProjectStore } from "../stores/projectStore"
import { getFileName } from "../lib/utils"

interface SearchResult {
  file: string
  line: number
  text: string
}

function groupByFile(results: SearchResult[]): Map<string, SearchResult[]> {
  const map = new Map<string, SearchResult[]>()
  for (const r of results) {
    const arr = map.get(r.file) ?? []
    arr.push(r)
    map.set(r.file, arr)
  }
  return map
}

export function SearchPanel(): JSX.Element {
  const { projectPath, openFile } = useProjectStore()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef(false)

  const runSearch = useCallback(async (q: string) => {
    if (!projectPath || !q.trim()) return
    abortRef.current = false
    setLoading(true)
    setSearched(false)
    try {
      const res = await window.api.searchFiles(projectPath, q.trim())
      if (!abortRef.current) {
        setResults(res)
        setSearched(true)
      }
    } catch (err) {
      console.error("[SearchPanel]", err)
    } finally {
      if (!abortRef.current) setLoading(false)
    }
  }, [projectPath])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      abortRef.current = true
      runSearch(query)
    }
  }

  const openResult = async (result: SearchResult) => {
    try {
      const content = await window.api.readFile(result.file)
      openFile(result.file, content ?? "")
    } catch (err) {
      console.error("[SearchPanel] openResult:", err)
    }
  }

  const grouped = groupByFile(results)
  const totalMatches = results.length
  const totalFiles = grouped.size

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="px-3 py-2 flex-shrink-0"
        style={{
          fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--text-secondary)",
          borderBottom: "1px solid var(--border-subtle)"
        }}
      >
        Search
      </div>

      {/* Search input */}
      <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div
          className="flex items-center gap-2 rounded-lg overflow-hidden transition-all duration-150"
          style={{ border: "1px solid var(--border)", background: "var(--bg-base)" }}
          onFocusCapture={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
          onBlurCapture={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search and press Enter..."
            disabled={!projectPath}
            className="flex-1 bg-transparent px-3 py-1.5 focus:outline-none"
            style={{ fontSize: "12px", color: "var(--text-primary)" }}
          />
          {loading && (
            <span className="pr-2" style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              ⟳
            </span>
          )}
        </div>
        {searched && (
          <div className="mt-1.5" style={{ fontSize: "10px", color: "var(--text-muted)" }}>
            {totalMatches === 0
              ? "No matches"
              : `${totalMatches} results — ${totalFiles} files`}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!projectPath ? (
          <div className="px-3 py-4" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            Open a project first
          </div>
        ) : results.length === 0 && searched ? (
          <div className="px-3 py-4" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            No results
          </div>
        ) : (
          Array.from(grouped.entries()).map(([filePath, matches]) => {
            // Shorten path for display
            const displayPath = filePath.replace(/\\/g, "/")
            const srcIdx = displayPath.lastIndexOf("src/")
            const shortPath = srcIdx !== -1 ? displayPath.slice(srcIdx) : displayPath
            const fileName = getFileName(filePath)

            return (
              <div key={filePath} className="mb-1">
                {/* File header */}
                <div
                  className="flex items-center gap-2 px-3 py-1 sticky top-0"
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    background: "var(--bg-panel)",
                    borderBottom: "1px solid var(--border-subtle)"
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#6ba3f5" strokeWidth="2">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                    <polyline points="13 2 13 9 20 9" />
                  </svg>
                  <span className="truncate" title={shortPath}>{fileName}</span>
                  <span
                    className="ml-auto flex-shrink-0 px-1.5 rounded"
                    style={{
                      fontSize: "10px",
                      background: "var(--bg-elevated)",
                      color: "var(--text-muted)"
                    }}
                  >
                    {matches.length}
                  </span>
                </div>

                {/* Match lines */}
                {matches.map((m) => (
                  <div
                    key={`${m.file}:${m.line}`}
                    className="flex items-start gap-2 px-3 py-1 cursor-pointer transition-colors duration-75"
                    style={{ fontSize: "11px" }}
                    onClick={() => openResult(m)}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                  >
                    <span
                      className="flex-shrink-0 text-right"
                      style={{ width: "28px", color: "var(--text-ghost)", fontFamily: "monospace" }}
                    >
                      {m.line}
                    </span>
                    <span
                      className="truncate font-mono"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {m.text}
                    </span>
                  </div>
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
