/**
 * tests/thinking-bubble.test.tsx — ThinkingBubble helpers
 *
 * The component this file originally tested was removed in v0.9.0; the
 * turn-level status line in ChatPanel now covers the live indicator.
 * What remains is the utility surface (verb pairs + duration formatter).
 */

import { describe, it, expect } from "vitest"
import { VERB_PAIRS, pickVerbPair, formatDuration } from "../src/ai/ThinkingBubble"

describe("formatDuration", () => {
  it("formats seconds under a minute as Xs", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(1)).toBe("1s")
    expect(formatDuration(59)).toBe("59s")
  })

  it("formats 60 seconds and over as Xm Ys", () => {
    expect(formatDuration(60)).toBe("1m 0s")
    expect(formatDuration(61)).toBe("1m 1s")
    expect(formatDuration(125)).toBe("2m 5s")
  })

  it("clamps negative input to 0s", () => {
    expect(formatDuration(-5)).toBe("0s")
  })

  it("floors fractional seconds", () => {
    expect(formatDuration(2.9)).toBe("2s")
  })
})

describe("pickVerbPair", () => {
  it("returns a [gerund, pastTense] pair from VERB_PAIRS", () => {
    const pair = pickVerbPair("test-seed")
    expect(Array.isArray(pair)).toBe(true)
    expect(pair.length).toBe(2)
    expect(VERB_PAIRS).toContainEqual(pair)
  })

  it("is deterministic for the same seed", () => {
    const a = pickVerbPair("abc")
    const b = pickVerbPair("abc")
    expect(a).toEqual(b)
  })

  it("different seeds can pick different pairs (across the full set)", () => {
    const seen = new Set<string>()
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]) {
      const [gerund] = pickVerbPair(seed)
      seen.add(gerund)
    }
    // With 27 pairs and 10 seeds, we should almost always see multiple
    expect(seen.size).toBeGreaterThan(1)
  })
})
