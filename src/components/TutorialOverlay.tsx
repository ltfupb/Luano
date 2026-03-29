import { useState, useEffect, useCallback, useRef } from "react"

interface TutorialStep {
  target?: string          // data-tour="xxx" selector
  title: string
  description: string
  position: "top" | "bottom" | "left" | "right" | "center"
}

const STEPS: TutorialStep[] = [
  {
    title: "Welcome to Luano!",
    description: "The all-in-one AI code editor for Roblox. Let's take a quick tour.",
    position: "center"
  },
  {
    target: "file-btn",
    title: "Open a Project",
    description: "Click File to open an existing Rojo project folder, or create a new one.",
    position: "bottom"
  },
  {
    target: "settings-btn",
    title: "Add Your API Key",
    description: "Go to Settings and enter your Claude or OpenAI API key to enable AI features.",
    position: "bottom"
  },
  {
    target: "sidebar",
    title: "Navigation",
    description: "Switch between File Explorer, Search, Rojo, Studio Bridge, and more.",
    position: "right"
  },
  {
    target: "editor-area",
    title: "Code Editor",
    description: "Write Luau code with full autocomplete, type checking, and 30+ Roblox snippets.",
    position: "center"
  },
  {
    target: "inline-edit-btn",
    title: "Inline AI Edit",
    description: "Select code and press Ctrl+K (or click this button) to let AI edit your code directly.",
    position: "bottom"
  },
  {
    target: "chat-panel",
    title: "AI Assistant",
    description: "Ask questions, plan features, or let the Agent write code autonomously. Supports Ask, Plan, and Agent modes.",
    position: "left"
  },
  {
    target: "rojo-icon",
    title: "Sync with Roblox Studio",
    description: "Start Rojo here to sync your code to Studio in real-time. Make sure to install the Rojo plugin in Studio first (Plugins > Manage Plugins > search \"Rojo\").",
    position: "right"
  },
  {
    title: "You're Ready!",
    description: "Start building your Roblox game. You can replay this tutorial anytime from Settings.",
    position: "center"
  }
]

const STORAGE_KEY = "luano-tutorial-done"

interface TooltipPos {
  top: number
  left: number
  arrowDir: "top" | "bottom" | "left" | "right" | "none"
}

function getTooltipPosition(target: string | undefined, position: string): TooltipPos {
  if (!target || position === "center") {
    return {
      top: window.innerHeight / 2 - 80,
      left: window.innerWidth / 2 - 180,
      arrowDir: "none"
    }
  }

  const el = document.querySelector(`[data-tour="${target}"]`)
  if (!el) {
    return {
      top: window.innerHeight / 2 - 80,
      left: window.innerWidth / 2 - 180,
      arrowDir: "none"
    }
  }

  const rect = el.getBoundingClientRect()
  const tooltipW = 320
  const tooltipH = 140
  const gap = 12

  switch (position) {
    case "bottom":
      return {
        top: rect.bottom + gap,
        left: Math.max(8, Math.min(rect.left + rect.width / 2 - tooltipW / 2, window.innerWidth - tooltipW - 8)),
        arrowDir: "top"
      }
    case "top":
      return {
        top: rect.top - tooltipH - gap,
        left: Math.max(8, Math.min(rect.left + rect.width / 2 - tooltipW / 2, window.innerWidth - tooltipW - 8)),
        arrowDir: "bottom"
      }
    case "right":
      return {
        top: Math.max(8, rect.top + rect.height / 2 - tooltipH / 2),
        left: rect.right + gap,
        arrowDir: "left"
      }
    case "left":
      return {
        top: Math.max(8, rect.top + rect.height / 2 - tooltipH / 2),
        left: rect.left - tooltipW - gap,
        arrowDir: "right"
      }
    default:
      return { top: window.innerHeight / 2 - 80, left: window.innerWidth / 2 - 180, arrowDir: "none" }
  }
}

export function TutorialOverlay({ onDone }: { onDone: () => void }): JSX.Element {
  const [step, setStep] = useState(0)
  const [pos, setPos] = useState<TooltipPos>({ top: 0, left: 0, arrowDir: "none" })
  const [visible, setVisible] = useState(false)
  const rafRef = useRef(0)

  const current = STEPS[step]

  const updatePosition = useCallback(() => {
    setPos(getTooltipPosition(current.target, current.position))
  }, [current])

  useEffect(() => {
    // Small delay so target elements are rendered
    rafRef.current = requestAnimationFrame(() => {
      updatePosition()
      setVisible(true)
    })
    return () => cancelAnimationFrame(rafRef.current)
  }, [step, updatePosition])

  useEffect(() => {
    window.addEventListener("resize", updatePosition)
    return () => window.removeEventListener("resize", updatePosition)
  }, [updatePosition])

  const next = () => {
    setVisible(false)
    setTimeout(() => {
      if (step < STEPS.length - 1) {
        setStep(step + 1)
      } else {
        localStorage.setItem(STORAGE_KEY, "true")
        onDone()
      }
    }, 150)
  }

  const skip = () => {
    localStorage.setItem(STORAGE_KEY, "true")
    onDone()
  }

  // Highlight target element
  const targetEl = current.target ? document.querySelector(`[data-tour="${current.target}"]`) : null
  const targetRect = targetEl?.getBoundingClientRect()

  return (
    <div className="fixed inset-0 z-[200]" style={{ pointerEvents: "auto" }}>
      {/* Dimmed overlay with cutout for target */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - 4}
                y={targetRect.top - 4}
                width={targetRect.width + 8}
                height={targetRect.height + 8}
                rx="6"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0" y="0" width="100%" height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Target highlight ring */}
      {targetRect && (
        <div
          className="absolute rounded-lg animate-glow-pulse"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            border: "2px solid var(--accent)",
            pointerEvents: "none",
            zIndex: 201
          }}
        />
      )}

      {/* Tooltip */}
      <div
        className="absolute"
        style={{
          top: pos.top,
          left: pos.left,
          width: 320,
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(6px)",
          transition: "all 0.2s ease-out",
          zIndex: 202,
          pointerEvents: "auto"
        }}
      >
        {/* Arrow */}
        {pos.arrowDir === "top" && (
          <div style={{
            position: "absolute", top: -6, left: "50%", marginLeft: -6,
            width: 0, height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderBottom: "6px solid var(--bg-elevated)"
          }} />
        )}
        {pos.arrowDir === "bottom" && (
          <div style={{
            position: "absolute", bottom: -6, left: "50%", marginLeft: -6,
            width: 0, height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderTop: "6px solid var(--bg-elevated)"
          }} />
        )}
        {pos.arrowDir === "left" && (
          <div style={{
            position: "absolute", left: -6, top: "50%", marginTop: -6,
            width: 0, height: 0,
            borderTop: "6px solid transparent",
            borderBottom: "6px solid transparent",
            borderRight: "6px solid var(--bg-elevated)"
          }} />
        )}
        {pos.arrowDir === "right" && (
          <div style={{
            position: "absolute", right: -6, top: "50%", marginTop: -6,
            width: 0, height: 0,
            borderTop: "6px solid transparent",
            borderBottom: "6px solid transparent",
            borderLeft: "6px solid var(--bg-elevated)"
          }} />
        )}

        {/* Card */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)"
          }}
        >
          <div className="px-4 pt-4 pb-3">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {current.title}
            </p>
            <p className="text-xs mt-1.5" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
              {current.description}
            </p>
          </div>
          <div
            className="flex items-center justify-between px-4 pb-3 pt-1"
          >
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {step + 1} / {STEPS.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={skip}
                className="px-3 py-1 rounded-lg text-xs transition-all duration-150"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
              >
                Skip
              </button>
              <button
                onClick={next}
                className="px-4 py-1 rounded-lg text-xs font-medium transition-all duration-150"
                style={{ background: "var(--accent)", color: "white" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--accent)"}
              >
                {step === STEPS.length - 1 ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function shouldShowTutorial(): boolean {
  return !localStorage.getItem(STORAGE_KEY)
}

export function resetTutorial(): void {
  localStorage.removeItem(STORAGE_KEY)
}
