/**
 * electron/sentry.ts — Crash reporting (main process)
 *
 * Opt-IN telemetry: Sentry only initializes when the user has explicitly
 * enabled `telemetryEnabled` in settings. This matches the semantics of
 * `electron/telemetry/collector.ts` (Pro telemetry) and what ARCHITECTURE.md
 * documents — consent must be affirmative, not assumed.
 */

import * as Sentry from "@sentry/electron/main"
import { app, ipcMain } from "electron"
import { log } from "./logger"
import { store, getAnonymousId } from "./store"

declare const __SENTRY_DSN__: string
const SENTRY_DSN = __SENTRY_DSN__

function isTelemetryOptedIn(): boolean {
  return store.get("telemetryEnabled") === true
}

export function initSentry(): void {
  // Register the renderer-sync bridge first, unconditionally. Renderer calls
  // this via sendSync at boot; registering here — before any DSN or opt-in
  // gate — means the call always resolves fast instead of blocking. The
  // payload carries `telemetryEnabled: false` when disabled so the renderer
  // naturally short-circuits without any extra branching on its side.
  ipcMain.on("sentry:context-sync", (e) => {
    e.returnValue = {
      anonymousId: getAnonymousId(),
      version: app.getVersion(),
      environment: app.isPackaged ? "production" : "development",
      telemetryEnabled: SENTRY_DSN ? isTelemetryOptedIn() : false
    }
  })

  if (!SENTRY_DSN) return  // No DSN in public builds — Sentry disabled entirely

  // Opt-IN gate: do not init SDK at all if user hasn't consented. Avoids
  // starting sessions, registering crash handlers that phone home, etc.
  if (!isTelemetryOptedIn()) {
    log.info("[sentry] telemetry not opted in — SDK not initialized")
    return
  }

  // Always init so the sentry-ipc:// protocol is registered before any
  // renderer loads — otherwise renderer's Sentry SDK throws
  // "URL scheme sentry-ipc is not supported" on every breadcrumb.
  // Outgoing events are still gated by beforeSend on opt-out toggle.
  Sentry.init({
    dsn: SENTRY_DSN,
    release: `luano@${app.getVersion()}`,
    environment: app.isPackaged ? "production" : "development",
    sampleRate: 1.0,
    // Active-user count on the Sentry dashboard comes from user.id. Anonymous
    // UUID generated once per install — no PII, no cross-install linkage.
    initialScope: {
      user: { id: getAnonymousId() },
      tags: {
        "os.platform": process.platform,
        "os.arch": process.arch,
        "app.channel": app.isPackaged ? "release" : "dev"
      }
    },
    integrations: [
      // console.error → Sentry event. Captures places where we log but don't
      // throw. `handled: true` keeps these from marking the session as crashed.
      Sentry.captureConsoleIntegration({ levels: ["error"], handled: true })
    ],
    // Runtime re-check: user can toggle opt-out during a session. Main-process
    // events are dropped immediately; renderer stops on next app launch.
    beforeSend(event) {
      if (!isTelemetryOptedIn()) return null
      return event
    },
    beforeBreadcrumb(breadcrumb) {
      if (!isTelemetryOptedIn()) return null
      return breadcrumb
    }
  })

  log.info("[sentry] init complete (opted in)")
}
