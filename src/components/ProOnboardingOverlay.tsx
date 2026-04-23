import { useState, useEffect, useRef } from "react"
import { STORAGE_KEYS, STORAGE_FLAG_TRUE } from "../storageKeys"

const STORAGE_KEY = STORAGE_KEYS.PRO_ONBOARDING_DONE

interface Step {
  emoji: string
  title: string
  body: string
  highlight?: string  // data-tour target to pulse-highlight
}

const STEPS: Step[] = [
  {
    emoji: "✦",
    title: "You're Pro",
    body: "Managed AI, Agent mode, and Inline Edit — all unlocked. Let's take 30 seconds."
  },
  {
    emoji: "⚡",
    title: "Managed AI — no key needed",
    body: "Settings → AI Mode → Managed. Claude Sonnet 4.6 ready to use. 2.5M tokens/month included. No API key, no billing surprises."
  },
  {
    emoji: "🤖",
    title: "Agent & Plan Mode",
    body: "Agent writes and edits files directly — approve each change or run hands-free. Plan mode thinks through architecture without touching code."
  },
  {
    emoji: "⌨",
    title: "Inline Edit",
    body: "Select any code and press Ctrl+K (Cmd+K on Mac). AI edits exactly what you highlighted, nothing else."
  },
  {
    emoji: "🚀",
    title: "Ready",
    body: "Open a project and start building."
  }
]

export function shouldShowProOnboarding(): boolean {
  try {
    return !localStorage.getItem(STORAGE_KEY)
  } catch {
    return false
  }
}

export function markProOnboardingDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, STORAGE_FLAG_TRUE)
  } catch {
    // ignore — storage may be unavailable in sandboxed contexts
  }
}

export function ProOnboardingOverlay({ onDone }: { onDone: () => void }): JSX.Element {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const nextBtnRef = useRef<HTMLButtonElement | null>(null)
  // Keep the keyboard handler bound once; read latest onDone via ref so
  // late prop changes don't get stranded in a stale closure.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const stepRef = useRef(step)
  stepRef.current = step

  const next = () => {
    if (stepRef.current < STEPS.length - 1) {
      setStep((s) => s + 1)
    } else {
      markProOnboardingDone()
      onDoneRef.current()
    }
  }

  const skip = () => {
    markProOnboardingDone()
    onDoneRef.current()
  }

  // Autofocus primary button on each step
  useEffect(() => {
    nextBtnRef.current?.focus()
  }, [step])

  // Keyboard: Escape skips, Enter advances. Bound once — latest step/onDone
  // flow through refs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        skip()
      } else if (e.key === "Enter") {
        e.preventDefault()
        next()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- next/skip close over refs
  }, [])

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && skip()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-onboarding-title"
    >
      <div
        className="flex flex-col"
        style={{
          width: 380,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
          overflow: "hidden"
        }}
      >
        {/* Progress bar */}
        <div style={{ height: 2, background: "var(--bg-elevated)" }}>
          <div
            style={{
              height: "100%",
              background: "var(--accent)",
              width: `${((step + 1) / STEPS.length) * 100}%`,
              transition: "width 0.3s ease"
            }}
          />
        </div>

        {/* Content */}
        <div className="flex flex-col gap-4 p-6">
          {/* Emoji + step counter */}
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 28 }}>{current.emoji}</span>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              {step + 1} / {STEPS.length}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <div id="pro-onboarding-title" style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
              {current.title}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {current.body}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            onClick={skip}
            className="text-xs transition-colors duration-150"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
          >
            Skip
          </button>
          <button
            ref={nextBtnRef}
            onClick={next}
            className="px-5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
            style={{ background: "var(--accent)", color: "white" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
          >
            {step === STEPS.length - 1 ? "Let's go" : "Next"}
          </button>
        </div>
      </div>
    </div>
  )
}
