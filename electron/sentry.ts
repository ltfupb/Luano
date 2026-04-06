/**
 * electron/sentry.ts — Crash reporting (main process)
 *
 * Initializes Sentry in the main process. Only sends crash data
 * when the user has opted in via telemetry settings.
 */

import * as Sentry from "@sentry/electron/main"
import { app } from "electron"
import { store } from "./store"

const SENTRY_DSN = "https://placeholder@o0.ingest.sentry.io/0"

export function initSentry(): void {
  const telemetryEnabled = store.get("telemetryEnabled") as boolean | undefined
  if (telemetryEnabled === false) return

  Sentry.init({
    dsn: SENTRY_DSN,
    release: `luano@${app.getVersion()}`,
    environment: app.isPackaged ? "production" : "development",
    sampleRate: 1.0,
    beforeSend(event) {
      // Re-check opt-in at send time
      if (store.get("telemetryEnabled") === false) return null
      return event
    }
  })
}
