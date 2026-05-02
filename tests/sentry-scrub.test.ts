/**
 * tests/sentry-scrub.test.ts — PII scrubbing for Sentry events.
 *
 * The scrubber is a pure function (`makeRedactor` + `scrubEvent`) so we can
 * test it without spinning up the full Sentry SDK. Covers the four transform
 * stages documented at the top of `electron/sentry.ts`:
 *
 *   1. API-key / bearer-token / GitHub PAT / Slack bot patterns → [REDACTED]
 *   2. os.homedir() → ~  (both back-slash and forward-slash variants)
 *   3. Local username (basename of homedir) → [USER]
 *   4. Truncation at MAX_STR_LEN with the truncation marker
 */

import { describe, it, expect, vi } from "vitest"

// sentry.ts has a module-level `const SENTRY_DSN = __SENTRY_DSN__` (a Vite
// `define` substitution). vi.hoisted() runs before any imports, so the
// global is defined by the time sentry.ts evaluates its top-level statements.
vi.hoisted(() => {
  (globalThis as unknown as { __SENTRY_DSN__: string }).__SENTRY_DSN__ = ""
})

// sentry.ts imports `electron`, `@sentry/electron/main`, `./store`, and
// `./logger` at module load. Stub them so this unit test only exercises the
// pure scrubbing helpers.
vi.mock("electron", () => ({
  app: { getVersion: () => "test", isPackaged: false, getPath: () => "/tmp" },
  ipcMain: { on: () => {}, handle: () => {} }
}))
vi.mock("@sentry/electron/main", () => ({
  init: vi.fn(),
  captureMessage: vi.fn(),
  captureConsoleIntegration: vi.fn(() => ({}))
}))
vi.mock("../electron/store", () => ({
  store: { get: () => undefined, set: () => {} },
  getAnonymousId: () => "anon-test"
}))
vi.mock("../electron/logger", () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}))

import { makeRedactor, scrubEvent } from "../electron/sentry"
// `import type` is erased at compile time — does not trigger the @sentry
// runtime module load, so the mock above isn't undermined.
import type { Event } from "@sentry/electron/main"

describe("makeRedactor", () => {
  describe("homedir scrubbing", () => {
    it("replaces backslash homedir with ~", () => {
      const redact = makeRedactor("C:\\Users\\aidenk")
      expect(redact("Failed to read C:\\Users\\aidenk\\project\\src\\foo.ts"))
        .toBe("Failed to read ~\\project\\src\\foo.ts")
    })

    it("replaces forward-slash homedir with ~ (POSIX)", () => {
      const redact = makeRedactor("/home/aidenk")
      expect(redact("ENOENT: /home/aidenk/.config/luano"))
        .toBe("ENOENT: ~/.config/luano")
    })

    it("replaces both slash variants when seen on Windows", () => {
      // Some logs normalize to forward slashes even on Windows
      const redact = makeRedactor("C:\\Users\\aidenk")
      const out = redact("native: C:\\Users\\aidenk\\foo and norm: C:/Users/aidenk/bar")
      expect(out).toBe("native: ~\\foo and norm: ~/bar")
    })

    it("is case-insensitive for the homedir match", () => {
      const redact = makeRedactor("C:\\Users\\aidenk")
      // Windows often lowercases drive letter in some logs
      expect(redact("c:\\users\\aidenk\\app")).toBe("~\\app")
    })
  })

  describe("API key / token scrubbing", () => {
    it("redacts sk- API keys", () => {
      const redact = makeRedactor("/home/u")
      expect(redact("key=sk-ant-abcdefghijklmnopqrstuvwxyz1234"))
        .toBe("key=[REDACTED]")
    })

    it("redacts Bearer tokens", () => {
      const redact = makeRedactor("/home/u")
      expect(redact("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"))
        .toBe("Authorization: [REDACTED]")
    })

    it("redacts GitHub PATs (ghp_, gho_, ghs_)", () => {
      const redact = makeRedactor("/home/u")
      expect(redact("token=ghp_abcdefghijklmnopqrstuvwxyz1234"))
        .toBe("token=[REDACTED]")
      expect(redact("token=gho_abcdefghijklmnopqrstuvwxyz1234"))
        .toBe("token=[REDACTED]")
    })

    it("redacts Slack bot tokens", () => {
      const redact = makeRedactor("/home/u")
      expect(redact("slack=xoxb-1234567890-abcdef-XYZ"))
        .toBe("slack=[REDACTED]")
    })

    it("does not redact short alphanumerics that look like prefixes", () => {
      const redact = makeRedactor("/home/u")
      expect(redact("sk-too-short")).toBe("sk-too-short")
    })
  })

  describe("username scrubbing", () => {
    it("replaces username when it appears as a path component (after /)", () => {
      const redact = makeRedactor("/home/aidenk")
      // Only scrub when preceded by a path separator — not as a bare word.
      expect(redact("/home/aidenk/project")).toBe("~/project")  // homedir takes precedence
      expect(redact("path: /var/aidenk/app")).toBe("path: /var/[USER]/app")
    })

    it("does NOT replace bare username outside of path contexts", () => {
      // Finding #13: a user named "admin" must not lose every "admin" token
      // in stack traces. Only redact username after a path-separator boundary.
      const redact = makeRedactor("/home/aidenk")
      expect(redact("user=aidenk on host=foo")).toBe("user=aidenk on host=foo")
    })

    it("does not partially match longer identifiers containing username", () => {
      const redact = makeRedactor("/home/aiden")
      // "aidenkang" should not be scrubbed to "[USER]kang"
      expect(redact("contributor: aidenkang")).toBe("contributor: aidenkang")
    })

    it("handles Windows homedir format for username extraction (path context)", () => {
      const redact = makeRedactor("C:\\Users\\aidenk")
      // Username in a path context (after \) is redacted.
      expect(redact("C:\\Users\\aidenk\\app")).toBe("~\\app")  // homedir takes precedence
      expect(redact("D:\\profiles\\aidenk\\data")).toBe("D:\\profiles\\[USER]\\data")
    })

    it("does NOT replace username in non-path context even on Windows", () => {
      const redact = makeRedactor("C:\\Users\\aidenk")
      expect(redact("Hello aidenk world")).toBe("Hello aidenk world")
    })

    it("skips username scrubbing when basename is too short (< 3 chars)", () => {
      // Avoids over-matching common short tokens.
      const redact = makeRedactor("/home/al")
      expect(redact("install al")).toBe("install al")
    })
  })

  describe("truncation", () => {
    it("truncates strings over MAX_STR_LEN with marker", () => {
      const redact = makeRedactor("/home/u")
      const big = "x".repeat(2000)
      const out = redact(big)
      // 1000 + "…[truncated]" length
      expect(out.length).toBeLessThan(big.length)
      expect(out.endsWith("…[truncated]")).toBe(true)
    })

    it("leaves under-length strings alone", () => {
      const redact = makeRedactor("/home/u")
      expect(redact("short string")).toBe("short string")
    })
  })

  describe("composition", () => {
    it("applies all transforms together", () => {
      const redact = makeRedactor("C:\\Users\\aidenk")
      // Use the username in a path context (after \) so path-restricted scrubbing fires.
      const input =
        "ERROR in C:\\Users\\aidenk\\proj and D:\\profiles\\aidenk\\data: Bearer sk-ant-abcdefghijklmnopqrstuvwxyz"
      const out = redact(input)
      // The literal word "Bearer" may remain — we only need the SECRET gone.
      expect(out).not.toContain("C:\\Users\\aidenk")
      expect(out).not.toContain("sk-ant-")
      expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz")
      // Homedir is replaced with ~
      expect(out).toContain("~\\proj")
      // Username in path context (D:\\profiles\\aidenk) is redacted
      expect(out).toContain("[USER]")
      expect(out).toContain("[REDACTED]")
    })
  })

  describe("edge cases", () => {
    it("returns empty string unchanged", () => {
      const redact = makeRedactor("/home/u")
      expect(redact("")).toBe("")
    })

    it("handles homedir = empty string gracefully", () => {
      const redact = makeRedactor("")
      expect(redact("just a string")).toBe("just a string")
    })
  })
})

describe("scrubEvent", () => {
  const homedir = "C:\\Users\\aidenk"
  const redact = makeRedactor(homedir)

  it("scrubs event.message", () => {
    const event: Event = { message: `read C:\\Users\\aidenk\\file` }
    scrubEvent(event, redact)
    expect(event.message).toBe("read ~\\file")
  })

  it("scrubs exception values and stacktrace frames", () => {
    const event: Event = {
      exception: {
        values: [{
          type: "Error",
          value: "ENOENT: C:\\Users\\aidenk\\proj\\src\\bad.ts",
          stacktrace: {
            frames: [
              { filename: "C:\\Users\\aidenk\\app\\out\\main\\index.js" },
              { filename: "C:\\Users\\aidenk\\app\\out\\main\\handler.js" }
            ]
          }
        }]
      }
    }
    scrubEvent(event, redact)
    expect(event.exception?.values?.[0].value).toBe("ENOENT: ~\\proj\\src\\bad.ts")
    expect(event.exception?.values?.[0].stacktrace?.frames?.[0].filename)
      .toBe("~\\app\\out\\main\\index.js")
    expect(event.exception?.values?.[0].stacktrace?.frames?.[1].filename)
      .toBe("~\\app\\out\\main\\handler.js")
  })

  it("scrubs breadcrumbs (message + data)", () => {
    const event: Event = {
      breadcrumbs: [{
        category: "console",
        message: "Failed in C:\\Users\\aidenk\\foo",
        data: { path: "C:\\Users\\aidenk\\bar.ts", count: 5 }
      }]
    }
    scrubEvent(event, redact)
    expect(event.breadcrumbs?.[0].message).toBe("Failed in ~\\foo")
    expect(event.breadcrumbs?.[0].data?.path).toBe("~\\bar.ts")
    expect(event.breadcrumbs?.[0].data?.count).toBe(5)  // numeric untouched
  })

  it("scrubs context string fields", () => {
    const event: Event = {
      contexts: {
        runtime: { name: "node", build_path: "C:\\Users\\aidenk\\luano" }
      }
    }
    scrubEvent(event, redact)
    expect(event.contexts?.runtime?.build_path).toBe("~\\luano")
  })

  it("does not crash on a minimal/empty event", () => {
    const event: Event = {}
    expect(() => scrubEvent(event, redact)).not.toThrow()
  })

  it("returns the same event reference (mutates in place)", () => {
    const event: Event = { message: "hello" }
    const out = scrubEvent(event, redact)
    expect(out).toBe(event)
  })
})
