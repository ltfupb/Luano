/**
 * electron/sentry.ts — Crash reporting (main process)
 *
 * Initializes Sentry in the main process. Only sends crash data
 * when the user has opted in via telemetry settings.
 */

import * as Sentry from "@sentry/electron/main"
import { app } from "electron"
import { store } from "./store"

const SENTRY_DSN = "https://84cff3b3ab58d7e5f6ee6b4a259f193c@o4511173243830272.ingest.us.sentry.io/4511173246451712"

export function initSentry(): void {
  // Always init so the sentry-ipc:// protocol is registered before any
  // renderer loads — otherwise renderer's Sentry SDK throws
  // "URL scheme sentry-ipc is not supported" on every breadcrumb.
  // Outgoing events are still gated by beforeSend on opt-out.
  Sentry.init({
    dsn: SENTRY_DSN,
    release: `luano@${app.getVersion()}`,
    environment: app.isPackaged ? "production" : "development",
    sampleRate: 1.0,
    beforeSend(event) {
      if (store.get("telemetryEnabled") === false) return null
      return event
    },
    beforeBreadcrumb(breadcrumb) {
      if (store.get("telemetryEnabled") === false) return null
      return breadcrumb
    }
  })
}
