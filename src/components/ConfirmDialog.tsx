import { ReactNode } from "react"

interface Props {
  title: string
  body: ReactNode
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  width?: number
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  width = 380
}: Props): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center animate-fade-in"
      style={{ background: "rgba(5,8,15,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        className="rounded-xl overflow-hidden animate-slide-up"
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
          width: `${width}px`
        }}
      >
        <div className="px-5 pt-5 pb-3">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</p>
          <div className="text-xs mt-1.5" style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>{body}</div>
        </div>
        <div className="flex items-center gap-2 px-4 pb-4 pt-1">
          <button
            onClick={onConfirm}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
            style={{ background: "var(--accent)", color: "white" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 py-1.5 rounded-lg text-xs transition-all duration-150"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
