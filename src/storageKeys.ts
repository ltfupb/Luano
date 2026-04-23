// Central registry for all localStorage keys.
// Prevents collisions between components. Keep values unique per key.
// zustand persist stores (settings/ai/project) use the `luano-*` prefix
// directly in their `persist` config; those are listed here for reference
// only — do not read them directly from localStorage.

export const STORAGE_KEYS = {
  // One-time onboarding markers (presence of key = "done")
  TUTORIAL_DONE:       "luano-tutorial-done",
  PRO_ONBOARDING_DONE: "luano-pro-onboarding-done",

  // Zustand persist stores (managed by zustand/middleware, not us)
  SETTINGS_STORE: "luano-settings",
  AI_STORE:       "luano-ai",
  PROJECT_STORE:  "luano-project",
} as const

// Sentinel value used when presence-only semantics are needed.
// Any non-empty string works; standardizing avoids drift.
export const STORAGE_FLAG_TRUE = "1"
