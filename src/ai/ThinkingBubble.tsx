/**
 * Thinking-indicator helpers.
 *
 * The component this file originally exported has been removed — the chat
 * panel now renders a single turn-level status line. What's left are the
 * pure utilities (verb pairs + duration formatter) that the status line
 * and the per-message footer both consume.
 */

/**
 * Gerund ↔ past-tense pairs for the thinking indicator.
 * Roblox culture + Luau developer vocabulary — branding that makes it
 * unmistakable which tool you're using. Explicit pairs so irregular
 * past-tenses ("Pathfound", not "Pathfinded") don't need conjugation.
 */
export const VERB_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Roblox culture (13)
  ["Respawning",   "Respawned"],
  ["Oofing",       "Oofed"],
  ["Baconating",   "Baconated"],
  ["Tweening",     "Tweened"],
  ["Raycasting",   "Raycasted"],
  ["Pathfinding",  "Pathfound"],
  ["Replicating",  "Replicated"],
  ["Heartbeating", "Heartbeated"],
  ["Welding",      "Welded"],
  ["Grinding",     "Grinded"],
  ["Buffing",      "Buffed"],
  ["Nerfing",      "Nerfed"],
  ["Unioning",     "Unioned"],
  // Luau / Roblox developer vocabulary (12)
  ["Pcalling",     "Pcalled"],
  ["Yielding",     "Yielded"],
  ["Lerping",      "Lerped"],
  ["Typechecking", "Typechecked"],
  ["Cloning",      "Cloned"],
  ["Parenting",    "Parented"],
  ["Firing",       "Fired"],
  ["Invoking",     "Invoked"],
  ["Rojoing",      "Rojoed"],
  ["Debouncing",   "Debounced"],
  ["Syncing",      "Synced"],
  ["Serializing",  "Serialized"],
  // Generic fallbacks so the set doesn't feel too niche
  ["Thinking",     "Thought"],
  ["Generating",   "Generated"]
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
