import posthog from "posthog-js"

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined

let ready = false

export const Events = {
  APP_OPENED:     "app_opened",
  MESSAGE_SENT:   "message_sent",
  PROJECT_OPENED: "project_opened",
  MANAGED_SWITCHED_TO:       "managed_switched_to",
  MANAGED_CAP_HIT:           "managed_cap_hit",
  MANAGED_BYOK_FALLBACK:     "managed_byok_fallback",
  MANAGED_REQUEST_COMPLETED: "managed_request_completed",
} as const

export function initPostHog(): void {
  if (ready) return  // already initialized — avoid duplicate app_opened event
  const ctx = window.api?.sentryGetContext?.() ?? null
  if (!KEY || !ctx?.analyticsEnabled) return

  posthog.init(KEY, {
    api_host: "https://us.i.posthog.com",
    person_profiles: "identified_only",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
  })
  posthog.identify(ctx.anonymousId, { app_version: ctx.version })
  ready = true
  posthog.capture(Events.APP_OPENED, { version: ctx.version })
}

export function setAnalyticsEnabled(enabled: boolean): void {
  if (!ready) return
  if (enabled) {
    posthog.opt_in_capturing()
  } else {
    posthog.opt_out_capturing()
  }
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (!ready) return
  posthog.capture(event, props)
}
