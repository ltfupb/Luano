import { useState, useEffect, useCallback } from "react"

export type ToastType = "error" | "warn" | "info"

export interface ToastItem {
  id: string
  message: string
  type: ToastType
}

let _addToast: ((message: string, type?: ToastType) => void) | null = null

export function toast(message: string, type: ToastType = "error"): void {
  _addToast?.(message, type)
}

export function ToastContainer(): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((message: string, type: ToastType = "error") => {
    const id = `toast-${Date.now()}`
    setToasts((prev) => [...prev.slice(-4), { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  useEffect(() => {
    _addToast = addToast
    return () => { _addToast = null }
  }, [addToast])

  if (toasts.length === 0) return <></>

  return (
    <div className="fixed bottom-8 right-4 flex flex-col gap-2 z-50 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs max-w-xs animate-fade-in pointer-events-auto"
          style={{
            background: t.type === "error" ? "#2d1515" : t.type === "warn" ? "#2d2415" : "#112030",
            border: `1px solid ${t.type === "error" ? "#7f1d1d" : t.type === "warn" ? "#78350f" : "#1e3a5a"}`,
            color: t.type === "error" ? "#fca5a5" : t.type === "warn" ? "#fcd34d" : "#93c5fd",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)"
          }}
        >
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <button
            onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
            className="opacity-50 hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
