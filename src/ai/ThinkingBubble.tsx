import { useState, useEffect } from "react"

const THINKING_HINTS = [
  "Thinking…",
  "Reading your code…",
  "Analyzing the script…",
  "Writing a response…",
  "Almost there…"
]

function ThinkingIndicator(): JSX.Element {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    let fadeTimeout: ReturnType<typeof setTimeout> | null = null
    const fade = setInterval(() => {
      setVisible(false)
      fadeTimeout = setTimeout(() => {
        setIndex((i) => (i + 1) % THINKING_HINTS.length)
        setVisible(true)
      }, 300)
    }, 2000)
    return () => {
      clearInterval(fade)
      if (fadeTimeout !== null) clearTimeout(fadeTimeout)
    }
  }, [])

  return (
    <div className="flex items-center gap-2" style={{ padding: "2px 4px" }}>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--accent)",
          animation: "glowPulse 1.4s ease-in-out infinite"
        }}
      />
      <span
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.3s ease"
        }}
      >
        {THINKING_HINTS[index]}
      </span>
    </div>
  )
}

/**
 * Inline thinking indicator — no container, no background. Shows a subtle
 * blinking cursor for the first 3 seconds (matches text-streaming feel),
 * then flips to a rotating hint with pulsing dot. If the model emits an
 * explicit thinking block, flip immediately.
 */
export function ThinkingBubble({ thinkingActive }: { thinkingActive?: boolean }): JSX.Element {
  const [showHints, setShowHints] = useState(false)

  useEffect(() => {
    setShowHints(false)
    if (thinkingActive) {
      setShowHints(true)
      return
    }
    const timer = setTimeout(() => setShowHints(true), 3000)
    return () => clearTimeout(timer)
  }, [thinkingActive])

  if (!showHints) {
    return (
      <span
        aria-hidden
        className="animate-blink"
        style={{ color: "var(--accent)", padding: "2px 4px" }}
      >
        {"\u258C"}
      </span>
    )
  }
  return <ThinkingIndicator />
}
