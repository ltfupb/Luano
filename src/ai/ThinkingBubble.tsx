import { useEffect, useState } from "react"

/**
 * Gerund ↔ past-tense pairs for the thinking indicator.
 * Roblox culture + Luau/Roblox developer vocabulary — branding that makes
 * it unmistakable which tool you're using.
 *
 * Explicit pairs so irregular past-tenses ("Pathfound", not "Pathfinded")
 * don't need runtime conjugation.
 */
export const VERB_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Roblox culture (13)
  ["Respawning",     "Respawned"],
  ["Oofing",         "Oofed"],
  ["Baconating",     "Baconated"],
  ["Tweening",       "Tweened"],
  ["Raycasting",     "Raycasted"],
  ["Pathfinding",    "Pathfound"],
  ["Replicating",    "Replicated"],
  ["Heartbeating",   "Heartbeated"],
  ["Welding",        "Welded"],
  ["Grinding",       "Grinded"],
  ["Buffing",        "Buffed"],
  ["Nerfing",        "Nerfed"],
  ["Unioning",       "Unioned"],
  // Luau / Roblox developer vocabulary (12)
  ["Pcalling",       "Pcalled"],
  ["Yielding",       "Yielded"],
  ["Lerping",        "Lerped"],
  ["Typechecking",   "Typechecked"],
  ["Cloning",        "Cloned"],
  ["Parenting",      "Parented"],
  ["Firing",         "Fired"],
  ["Invoking",       "Invoked"],
  ["Rojoing",        "Rojoed"],
  ["Debouncing",     "Debounced"],
  ["Syncing",        "Synced"],
  ["Serializing",    "Serialized"],
  // Generic fallbacks (2) — familiar baseline so the set doesn't feel too niche
  ["Thinking",       "Thought"],
  ["Generating",     "Generated"]
]

/** Deterministic pick from VERB_PAIRS using a string seed (usually message.id). */
export function pickVerbPair(seed: string): readonly [string, string] {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0
  }
  return VERB_PAIRS[Math.abs(h) % VERB_PAIRS.length]
}

/** Format seconds as "Xs" under a minute, "Xm YYs" for a minute or more. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem}s`
}

/**
 * Live thinking indicator — "✢ Cogitating… (1m 23s)" with a ticking timer.
 * Shows a blinking cursor for the first 0.5s so short turns don't flash the timer.
 */
export function ThinkingBubble({
  verb,
  thinkingActive: _
}: { verb?: string; thinkingActive?: boolean }): JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  const [startedAt] = useState(() => Date.now())

  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    const interval = setInterval(tick, 500)
    return () => clearInterval(interval)
  }, [startedAt])

  if (elapsed < 1) {
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

  const displayVerb = verb ?? "Thinking"
  return (
    <div className="flex items-center gap-2" style={{ padding: "2px 4px" }}>
      <span
        aria-hidden
        className="animate-glow-pulse"
        style={{ color: "var(--accent)", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}
      >
        ✢
      </span>
      <span
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          fontFamily: "'JetBrains Mono', monospace"
        }}
      >
        {displayVerb}… <span style={{ color: "var(--text-muted)" }}>({formatDuration(elapsed)})</span>
      </span>
    </div>
  )
}
