/**
 * electron/sentry.ts — Crash reporting (main process)
 *
 * Gated by its OWN store key `crashReports` — kept separate from the AI
 * sqlite telemetry (`telemetryEnabled` in collector.ts) so a user can opt
 * into crash reports without sharing AI training data, or vice versa.
 *
 * Consent is affirmative: a first-run prompt asks before anything is sent.
 * `crashReports` defaults to undefined; `initSentry` only fires when it is
 * explicitly true, and a runtime re-check inside beforeSend honours opt-out
 * mid-session.
 */

import * as Sentry from "@sentry/electron/main"
import { app, ipcMain } from "electron"
import { log } from "./logger"
import { store, getAnonymousId } from "./store"

declare const __SENTRY_DSN__: string
const SENTRY_DSN = __SENTRY_DSN__

function isCrashReportsEnabled(): boolean {
  return store.get("crashReports") === true
}

function isAnalyticsUsageEnabled(): boolean {
  return store.get("analyticsUsage") === true
}

function migrateAnalyticsUsage(): void {
  if (store.get("analyticsUsage") !== undefined) return
  if (isCrashReportsEnabled()) store.set("analyticsUsage", true)
}

/**
 * One-time migration for users who consented to the old single
 * `telemetryEnabled` toggle (which controlled both AI sqlite + Sentry).
 * Their prior consent is forwarded to `crashReports`. New installs see the
 * first-run prompt; old opt-out users stay opted out (undefined → false path).
 */
function migrateFromLegacyToggle(): void {
  if (store.get("crashReports") !== undefined) return
  if (store.get("telemetryEnabled") === true) {
    store.set("crashReports", true)
    store.set("crashReportsPrompted", true)
    log.info("[sentry] migrated legacy telemetryEnabled=true to crashReports=true")
  }
}

export function initSentry(): void {
  // Register the renderer-sync bridge first, unconditionally. Renderer calls
  // this via sendSync at boot; registering here — before any DSN or opt-in
  // gate — means the call always resolves fast instead of blocking. The
  // payload carries `crashReportsEnabled: false` when disabled so the
  // renderer naturally short-circuits without any extra branching.
  migrateAnalyticsUsage()

  ipcMain.on("sentry:context-sync", (e) => {
    e.returnValue = {
      anonymousId: getAnonymousId(),
      version: app.getVersion(),
      environment: app.isPackaged ? "production" : "development",
      crashReportsEnabled: SENTRY_DSN ? isCrashReportsEnabled() : false,
      // Decoupled from crashReports — users can opt into usage analytics
      // independently. Backed by "analyticsUsage" store key.
      analyticsEnabled: isAnalyticsUsageEnabled()
    }
  })

  ipcMain.handle("analytics-usage:is-enabled", () => isAnalyticsUsageEnabled())
  ipcMain.handle("analytics-usage:set-enabled", (_, v: unknown) => {
    if (typeof v !== "boolean") return { success: false }
    store.set("analyticsUsage", v)
    return { success: true }
  })

  if (!SENTRY_DSN) return  // No DSN in public builds — Sentry disabled entirely

  // Run the legacy-toggle migration AFTER the DSN check so public builds
  // never write Sentry-specific consent into the store. If a user upgrades
  // from a public mirror build to a DSN-bearing build later, they'll see
  // the first-run prompt on next launch instead of being pre-opted-in.
  migrateFromLegacyToggle()

  // Opt-IN gate: do not init SDK at all if user hasn't consented. Avoids
  // starting sessions, registering crash handlers that phone home, etc.
  if (!isCrashReportsEnabled()) {
    log.info("[sentry] crashReports not opted in — SDK not initialized")
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
    // Sessions = app launch → close (or 30 min idle). Drives "Crash-free
    // Users %" + Releases adoption rate. @sentry/electron v7 ships session
    // tracking ON by default via its bundled integrations (no explicit
    // option to set), so this comment serves as the contract: if a future
    // SDK version disables it by default we need to wire it back up.
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
      if (!isCrashReportsEnabled()) return null
      return event
    },
    beforeBreadcrumb(breadcrumb) {
      if (!isCrashReportsEnabled()) return null
      return breadcrumb
    }
  })

  // First event of the session — proves the pipeline works and gives the
  // dashboard a "Users affected" count even when nothing crashes.
  Sentry.captureMessage("app:launched", "info")

  log.info("[sentry] init complete (opted in)")
}
