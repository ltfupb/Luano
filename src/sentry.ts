/**
 * src/sentry.ts — Crash reporting (renderer process)
 *
 * Opt-IN: only initializes when the main process reports
 * `crashReportsEnabled === true`. Mirrors main's gating semantics so that
 * turning the toggle off in Settings prevents renderer errors from ever
 * reaching Sentry.
 */

import * as Sentry from "@sentry/electron/renderer"

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined

export function initSentryRenderer(): void {
  if (!SENTRY_DSN) return  // No DSN in public builds — Sentry disabled

  // Main process owns the authoritative anonymousId + version + opt-in state.
  // Pulled sync via sendSync so the first render's errors are tagged correctly.
  // Returns null if main-process Sentry is disabled (handler not registered).
  const ctx = window.api?.sentryGetContext?.() ?? null

  // Opt-IN gate: skip init entirely if user hasn't consented. No network
  // traffic, no session start, no breadcrumbs. User can enable in settings
  // and restart to begin collection.
  if (!ctx || !ctx.crashReportsEnabled) return

  Sentry.init({
    dsn: SENTRY_DSN,
    release: `luano@${ctx.version}`,
    environment: ctx.environment,
    initialScope: {
      user: { id: ctx.anonymousId },
      // Sentry's browser SDK auto-captures OS context (name/version) from
      // the User-Agent, so no os.platform tag here — would be redundant and
      // `navigator.platform` is deprecated anyway. process.type helps
      // distinguish renderer events from main in Sentry filters.
      tags: { "process.type": "renderer" }
    },
    integrations: [
      // console.error → Sentry event. Renderer code path has more of these
      // than main (React boundary logs, fetch failures), so this is where
      // it pays off most.
      Sentry.captureConsoleIntegration({ levels: ["error"], handled: true })
    ]
  })
}
