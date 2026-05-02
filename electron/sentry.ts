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
import * as os from "os"
import { log } from "./logger"
import { store, getAnonymousId } from "./store"

declare const __SENTRY_DSN__: string
const SENTRY_DSN = __SENTRY_DSN__

// Maximum length for any user-supplied string field forwarded to Sentry.
// Tool outputs / API error bodies routinely exceed 100KB; truncating keeps
// events both private (no full file dumps) and within Sentry's per-event quota.
const MAX_STR_LEN = 1000

/**
 * Pure scrubbing helper — exported for unit tests.
 *
 * IMPORTANT: Best-effort only. Cannot detect base64-encoded, URL-encoded,
 * or chunk-split secrets. For high-assurance, structured-payload paths,
 * redact at the source before passing data to Sentry APIs.
 *
 * Order of transforms (each composes on the previous output):
 *   1. API key / bearer token / GitHub PAT / Slack bot token → `[REDACTED]`
 *   2. `os.homedir()` (and Windows backslash variant) → `~`
 *   3. Local username (basename of homedir) → `[USER]`
 *      — only when username appears after a path separator (/ or \)
 *      — prevents over-redaction of common words (e.g. "admin", "user")
 *        that happen to match a username but are not path components
 *   4. Truncate to MAX_STR_LEN with `…[truncated]` suffix
 *
 * Examples (homedir = `C:\Users\aidenk`):
 *   "Failed to read C:\\Users\\aidenk\\project\\src\\foo.ts"
 *     → "Failed to read ~\\project\\src\\foo.ts"
 *   "Auth: Bearer sk-ant-abc1234567890abcdef1234567890"
 *     → "Auth: [REDACTED]"
 *   "user=aidenk on host" (bare word, no path separator) → unchanged
 *   "D:\\profiles\\aidenk\\data" → "D:\\profiles\\[USER]\\data"
 */
export function makeRedactor(homedir: string): (s: string) => string {
  // Pre-compute homedir variants (forward + back slash) and username basename.
  const homedirNorm = homedir.replace(/\\/g, "/")
  const homedirRaw = homedir
  const username = homedir.split(/[\\/]/).filter(Boolean).pop() ?? ""

  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const homedirRe = homedirRaw
    ? new RegExp(escape(homedirRaw), "gi")
    : null
  const homedirNormRe = homedirNorm && homedirNorm !== homedirRaw
    ? new RegExp(escape(homedirNorm), "gi")
    : null
  // Only replace the username when it appears immediately after a path
  // separator (/ or \) or after the literal component "Users/" / "home/".
  // Without this restriction a user named "admin" or "dev" would lose every
  // occurrence of that word in stack traces and log messages (e.g. "admin"
  // appearing in error text, npm package names, etc.). Limiting to
  // path-separator boundaries ensures we only scrub the username when it is
  // acting as a path component — not as a generic word.
  const usernameRe = username && username.length >= 3
    ? new RegExp(`(?<=[/\\\\])${escape(username)}(?![A-Za-z0-9_])`, "gi")
    : null

  return (s: string): string => {
    if (typeof s !== "string" || s.length === 0) return s
    let out = s
    // 1. API keys / tokens (do this first — before homedir which may contain
    //    a substring of an api key in pathological cases).
    out = out.replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
    out = out.replace(/Bearer\s+[A-Za-z0-9_.\-+/=]{20,}/gi, "[REDACTED]")
    out = out.replace(/xoxb-[A-Za-z0-9-]+/g, "[REDACTED]")
    out = out.replace(/ghp_[A-Za-z0-9]{20,}/g, "[REDACTED]")
    out = out.replace(/gho_[A-Za-z0-9]{20,}/g, "[REDACTED]")
    out = out.replace(/ghs_[A-Za-z0-9]{20,}/g, "[REDACTED]")
    // 2. Homedir → ~
    if (homedirRe) out = out.replace(homedirRe, "~")
    if (homedirNormRe) out = out.replace(homedirNormRe, "~")
    // 3. Bare username
    if (usernameRe) out = out.replace(usernameRe, "[USER]")
    // 4. Truncate
    if (out.length > MAX_STR_LEN) {
      out = out.slice(0, MAX_STR_LEN) + "…[truncated]"
    }
    return out
  }
}

/**
 * Depth-capped recursive walker: scrub strings in an arbitrary object/array
 * up to `maxDepth` levels deep. Stops at depth cap to avoid pathological
 * nesting and circular reference loops.
 *
 * Mutates the object in place. Returns the same reference.
 */
function scrubDeep(
  obj: Record<string, unknown> | unknown[],
  redact: (s: string) => string,
  depth: number,
  maxDepth: number
): void {
  if (depth >= maxDepth) return
  const keys = Array.isArray(obj) ? obj.map((_, i) => i) : Object.keys(obj)
  for (const k of keys) {
    const v = (obj as Record<string | number, unknown>)[k as string | number]
    if (typeof v === "string") {
      (obj as Record<string | number, unknown>)[k as string | number] = redact(v)
    } else if (Array.isArray(v)) {
      scrubDeep(v, redact, depth + 1, maxDepth)
    } else if (v !== null && typeof v === "object") {
      scrubDeep(v as Record<string, unknown>, redact, depth + 1, maxDepth)
    }
    // Primitives (number, boolean, null, undefined) pass through unchanged.
  }
}

/**
 * Walk a Sentry event and apply `redact` to every user-supplied string field.
 * Mutates the event in place and returns it. Defensive against missing fields.
 *
 * `contexts`, `extra`, and breadcrumb `data` are walked recursively (depth ≤ 4)
 * so nested objects (e.g. Sentry.setExtra("k", { nested: { token: "sk-…" } }))
 * are scrubbed rather than silently passed through.
 *
 * Generic over the event type so it satisfies both `beforeSend` (which sees
 * `ErrorEvent`) and `Event` callers from tests.
 */
export function scrubEvent<E extends Sentry.Event>(
  event: E,
  redact: (s: string) => string
): E {
  const DEEP_MAX = 4
  if (event.message) event.message = redact(event.message)
  if (event.logentry?.message) event.logentry.message = redact(event.logentry.message)

  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) ex.value = redact(ex.value)
      if (ex.type) ex.type = redact(ex.type)
      const frames = ex.stacktrace?.frames
      if (frames) {
        for (const f of frames) {
          if (f.filename) f.filename = redact(f.filename)
          if (f.abs_path) f.abs_path = redact(f.abs_path)
          if (f.module) f.module = redact(f.module)
        }
      }
    }
  }

  if (event.breadcrumbs) {
    for (const b of event.breadcrumbs) {
      if (b.message) b.message = redact(b.message)
      if (b.data && typeof b.data === "object") {
        scrubDeep(b.data as Record<string, unknown>, redact, 0, DEEP_MAX)
      }
    }
  }

  // Runtime / OS contexts may carry the home path in `name` / `version` slots
  // when set by us. Use recursive walker to catch nested objects.
  if (event.contexts) {
    for (const ctxKey of Object.keys(event.contexts)) {
      const ctx = event.contexts[ctxKey] as Record<string, unknown> | undefined
      if (!ctx || typeof ctx !== "object") continue
      scrubDeep(ctx, redact, 0, DEEP_MAX)
    }
  }

  // Tags are short by design but can include paths if a caller mis-uses them.
  if (event.tags) {
    for (const k of Object.keys(event.tags)) {
      const v = event.tags[k]
      if (typeof v === "string") event.tags[k] = redact(v)
    }
  }

  // `extra` is a free-form bag — recursively scrub strings (depth ≤ 4) so
  // nested structures like { nested: { token: "sk-…" } } are also redacted.
  if (event.extra) {
    scrubDeep(event.extra as Record<string, unknown>, redact, 0, DEEP_MAX)
  }

  return event
}

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
  const redact = makeRedactor(os.homedir())

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
      // Forward only `fatal` console output to Sentry. We previously captured
      // `error` too, but `log.error(...)` sites routinely embed raw user paths
      // and tool outputs which leaked PII into events. Real crashes still
      // arrive via the default onUncaughtException / onUnhandledRejection
      // integrations bundled with @sentry/electron.
      Sentry.captureConsoleIntegration({ levels: ["fatal"], handled: true })
    ],
    // Runtime re-check + PII scrub. The user can toggle opt-out during a
    // session — main-process events are dropped immediately. When opted in,
    // every user-supplied string is run through `redact` to strip homedir,
    // username, and API-key patterns before the event leaves the process.
    beforeSend(event) {
      if (!isCrashReportsEnabled()) return null
      try {
        return scrubEvent(event, redact)
      } catch (e) {
        log.warn(`[sentry] scrubEvent failed, dropping event: ${String(e)}`)
        return null
      }
    },
    beforeBreadcrumb(breadcrumb) {
      if (!isCrashReportsEnabled()) return null
      try {
        if (breadcrumb.message) breadcrumb.message = redact(breadcrumb.message)
        if (breadcrumb.data && typeof breadcrumb.data === "object") {
          for (const k of Object.keys(breadcrumb.data)) {
            const v = breadcrumb.data[k]
            if (typeof v === "string") breadcrumb.data[k] = redact(v)
          }
        }
      } catch {
        // Don't drop the breadcrumb on scrub failure — leave it as-is rather
        // than lose forensic context. (Event-level scrub above is the last gate.)
      }
      return breadcrumb
    }
  })

  // First event of the session — proves the pipeline works and gives the
  // dashboard a "Users affected" count even when nothing crashes.
  Sentry.captureMessage("app:launched", "info")

  log.info("[sentry] init complete (opted in)")
}
