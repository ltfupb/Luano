// src/components/QuickOpen.tsx
// Ctrl+P 빠른 파일 열기 — 프로젝트 내 모든 파일 퍼지 검색

import { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { useProjectStore, FileEntry } from "../stores/projectStore"

// ── 파일 트리 평탄화 ────────────────────────────────────────────────────────

function flattenTree(entries: FileEntry[], result: FileEntry[] = []): FileEntry[] {
  for (const e of entries) {
    if (e.type === "file") {
      result.push(e)
    } else if (e.children) {
      flattenTree(e.children, result)
    }
  }
  return result
}

// ── 퍼지 점수 — 낮을수록 좋음 ───────────────────────────────────────────────

function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  if (t.includes(q)) return 0
  let score = 0
  let ti = 0
  for (const ch of q) {
    const idx = t.indexOf(ch, ti)
    if (idx === -1) return Infinity
    score += idx - ti
    ti = idx + 1
  }
  return score
}

function filterFiles(files: FileEntry[], query: string): FileEntry[] {
  if (!query) return files.slice(0, 50)
  return files
    .map((f) => ({ f, score: fuzzyScore(f.name, query) }))
    .filter(({ score }) => score < Infinity)
    .sort((a, b) => a.score - b.score)
    .slice(0, 50)
    .map(({ f }) => f)
}

// ── Component ────────────────────────────────────────────────────────────────

interface QuickOpenProps {
  onClose: () => void
}

export function QuickOpen({ onClose }: QuickOpenProps): JSX.Element {
  const { fileTree, openFile } = useProjectStore()
  const [query, setQuery] = useState("")
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const allFiles = flattenTree(fileTree)
  const results = filterFiles(allFiles, query)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Reset selection on query change
  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIdx])

  const openSelected = useCallback(
    async (file: FileEntry) => {
      try {
        const content = await window.api.readFile(file.path)
        openFile(file.path, content ?? "")
        onClose()
      } catch (err) {
        console.error("[QuickOpen]", err)
      }
    },
    [openFile, onClose]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (results[selectedIdx]) openSelected(results[selectedIdx])
    }
  }

  const fileColors: Record<string, string> = {
    lua: "#6ba3f5", luau: "#6ba3f5", json: "#f59e0b", md: "#60b8ff", toml: "#fb923c"
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center animate-fade-in"
      style={{ background: "rgba(5,8,15,0.65)", backdropFilter: "blur(6px)", paddingTop: "15vh" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-[520px] rounded-xl overflow-hidden animate-slide-up"
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.8)"
        }}
      >
        {/* Search input */}
        <div
          className="flex items-center gap-3 px-4"
          style={{ borderBottom: "1px solid var(--border-subtle)", height: "44px" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search by file name..."
            className="flex-1 bg-transparent focus:outline-none"
            style={{ fontSize: "13px", color: "var(--text-primary)" }}
          />
          <span style={{ fontSize: "10px", color: "var(--text-ghost)" }}>ESC to close</span>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="overflow-y-auto"
          style={{ maxHeight: "360px" }}
        >
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center" style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              No matching files
            </div>
          ) : (
            results.map((file, i) => {
              const ext = file.ext ?? ""
              const dotColor = fileColors[ext] ?? "#5a82a0"
              const isSelected = i === selectedIdx

              // Show path relative to first occurrence of src/
              const displayPath = file.path.replace(/\\/g, "/")
              const srcIdx = displayPath.lastIndexOf("src/")
              const shortPath = srcIdx !== -1 ? displayPath.slice(srcIdx) : displayPath

              return (
                <div
                  key={file.path}
                  className="flex items-center gap-3 px-4 cursor-pointer transition-colors duration-75"
                  style={{
                    height: "36px",
                    background: isSelected ? "var(--bg-elevated)" : "transparent",
                    borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent"
                  }}
                  onMouseEnter={() => setSelectedIdx(i)}
                  onClick={() => openSelected(file)}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: dotColor }}
                  />
                  <span style={{ fontSize: "12px", color: "var(--text-primary)", flexShrink: 0 }}>
                    {file.name}
                  </span>
                  <span className="truncate" style={{ fontSize: "11px", color: "var(--text-ghost)" }}>
                    {shortPath}
                  </span>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div
            className="px-4 py-1.5 flex items-center gap-3"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            <span style={{ fontSize: "10px", color: "var(--text-ghost)" }}>
              ↑↓ navigate · ↵ open
            </span>
            <span style={{ fontSize: "10px", color: "var(--text-ghost)", marginLeft: "auto" }}>
              {results.length} files
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
