import { useState, useEffect, useCallback } from "react"

export type ToastType = "error" | "warn" | "info"

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  action?: ToastAction
}

let _addToast: ((message: string, type?: ToastType, action?: ToastAction) => void) | null = null

export function toast(message: string, type: ToastType = "error", action?: ToastAction): void {
  _addToast?.(message, type, action)
}

export function ToastContainer(): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((message: string, type: ToastType = "error", action?: ToastAction) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setToasts((prev) => [...prev.slice(-4), { id, message, type, action }])
    // Toasts with actions linger longer so the user has time to click.
    const ttl = action ? 10_000 : 5_000
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, ttl)
  }, [])

  useEffect(() => {
    _addToast = addToast
    return () => { _addToast = null }
  }, [addToast])

  if (toasts.length === 0) return <></>

  const dismiss = (id: string): void => setToasts((prev) => prev.filter((t) => t.id !== id))

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="fixed bottom-10 right-4 flex flex-col gap-2 z-50 pointer-events-none"
    >
      {toasts.map((t) => {
        const color = t.type === "error" ? "var(--danger)" : t.type === "warn" ? "var(--warning)" : "var(--info)"
        // Errors assertively interrupt the screen reader; warn/info are polite.
        const role = t.type === "error" ? "alert" : "status"
        const ariaLive = t.type === "error" ? "assertive" : "polite"
        return (
          <div
            key={t.id}
            role={role}
            aria-live={ariaLive}
            aria-atomic="true"
            className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs max-w-xs animate-fade-in pointer-events-auto"
            style={{
              background: "var(--bg-elevated)",
              border: `1px solid ${color}`,
              color,
              boxShadow: "0 4px 12px rgba(0,0,0,0.4)"
            }}
          >
            <span className="flex-1 leading-relaxed">{t.message}</span>
            {t.action && (
              <button
                onClick={() => { t.action!.onClick(); dismiss(t.id) }}
                className="flex-shrink-0 px-2 py-0.5 rounded transition-colors duration-100"
                style={{
                  fontSize: "11px",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                  background: "transparent",
                  border: `1px solid ${color}`
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-base)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="opacity-50 hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
