/**
 * src/sentry.ts — Crash reporting (renderer process)
 */

import * as Sentry from "@sentry/electron/renderer"

const SENTRY_DSN = "https://placeholder@o0.ingest.sentry.io/0"

export function initSentryRenderer(): void {
  Sentry.init({
    dsn: SENTRY_DSN
  })
}
