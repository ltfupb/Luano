/**
 * src/sentry.ts — Crash reporting (renderer process)
 */

import * as Sentry from "@sentry/electron/renderer"

const SENTRY_DSN = "https://84cff3b3ab58d7e5f6ee6b4a259f193c@o4511173243830272.ingest.us.sentry.io/4511173246451712"

export function initSentryRenderer(): void {
  Sentry.init({
    dsn: SENTRY_DSN
  })
}
