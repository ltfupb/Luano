import { useRojoStore } from "../stores/rojoStore"
import { useProjectStore } from "../stores/projectStore"

const statusDot: Record<string, string> = {
  stopped: "#3a5272",
  starting: "#f59e0b",
  running: "#10b981",
  error: "#e11d48"
}

const statusLabel: Record<string, string> = {
  stopped: "Rojo stopped",
  starting: "Rojo starting…",
  running: "Rojo serving",
  error: "Rojo error"
}

export function StatusBar(): JSX.Element {
  const { status } = useRojoStore()
  const { activeFile, lspPort } = useProjectStore()

  return (
    <div
      className="h-[22px] flex items-center px-3 gap-4 flex-shrink-0"
      style={{
        background: "var(--bg-panel)",
        borderTop: "1px solid var(--border-subtle)",
        fontSize: "11px"
      }}
    >
      {/* Rojo status */}
      <div className="flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{
            background: statusDot[status] ?? statusDot.stopped,
            boxShadow: status === "running" ? "0 0 4px #10b981" : "none"
          }}
        />
        <span style={{ color: "var(--text-muted)" }}>{statusLabel[status] ?? status}</span>
      </div>

      {/* Separator */}
      {lspPort && <span style={{ color: "var(--border)", userSelect: "none" }}>·</span>}

      {/* LSP port */}
      {lspPort && (
        <span style={{ color: "var(--text-muted)" }}>LSP :{lspPort}</span>
      )}

      {/* Active file — right aligned */}
      {activeFile && (
        <span className="ml-auto truncate max-w-[240px]" style={{ color: "var(--text-muted)" }}>
          {activeFile.split(/[/\\]/).pop()}
        </span>
      )}
    </div>
  )
}
