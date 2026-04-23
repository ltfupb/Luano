import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  // Explicitly unset in case a local .env provided a real key
  vi.stubEnv("VITE_POSTHOG_KEY", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("analytics opt-in gate", () => {
  it("track is a no-op before initPostHog", async () => {
    const posthog = (await import("posthog-js")).default
    const { track } = await import("../src/analytics")
    track("some_event")
    expect(posthog.capture).not.toHaveBeenCalled()
  })

  it("initPostHog does not init when VITE_POSTHOG_KEY is absent", async () => {
    vi.stubGlobal("import.meta", { env: { VITE_POSTHOG_KEY: undefined } })
    vi.stubGlobal("window", {
      api: { sentryGetContext: () => ({ analyticsEnabled: true, anonymousId: "anon", version: "1.0" }) },
    })
    const posthog = (await import("posthog-js")).default
    const { initPostHog } = await import("../src/analytics")
    initPostHog()
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it("initPostHog does not init when analyticsEnabled is false", async () => {
    vi.stubGlobal("window", {
      api: { sentryGetContext: () => ({ analyticsEnabled: false, anonymousId: "anon", version: "1.0" }) },
    })
    const posthog = (await import("posthog-js")).default
    const { initPostHog } = await import("../src/analytics")
    initPostHog()
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it("initPostHog does not init when sentryGetContext returns null", async () => {
    vi.stubGlobal("window", {
      api: { sentryGetContext: () => null },
    })
    const posthog = (await import("posthog-js")).default
    const { initPostHog } = await import("../src/analytics")
    initPostHog()
    expect(posthog.init).not.toHaveBeenCalled()
  })
})
