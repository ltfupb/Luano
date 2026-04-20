/**
 * tests/thinking-bubble.test.tsx — ThinkingBubble component (CC-style timer)
 */

import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { ThinkingBubble, formatDuration } from "../src/ai/ThinkingBubble"

void React

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("ThinkingBubble", () => {
  it("shows blinking cursor initially (under 1s elapsed)", () => {
    const { container } = render(<ThinkingBubble />)
    expect(container.querySelector(".animate-blink")).toBeInTheDocument()
  })

  it("transitions to verb + elapsed timer after 1s", () => {
    render(<ThinkingBubble verb="Respawning" />)
    act(() => { vi.advanceTimersByTime(1500) })
    expect(screen.getByText(/Respawning/)).toBeInTheDocument()
    expect(screen.getByText(/\(1s\)/)).toBeInTheDocument()
  })

  it("updates the elapsed timer as time advances", () => {
    render(<ThinkingBubble />)
    act(() => { vi.advanceTimersByTime(5500) })
    expect(screen.getByText(/\(5s\)/)).toBeInTheDocument()
  })

  it("does not crash when thinkingActive prop is undefined", () => {
    expect(() => render(<ThinkingBubble />)).not.toThrow()
  })
})

describe("formatDuration", () => {
  it("formats under 60s as Xs", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(59)).toBe("59s")
  })

  it("formats 60s+ as Xm Ys", () => {
    expect(formatDuration(60)).toBe("1m 0s")
    expect(formatDuration(148)).toBe("2m 28s")
    expect(formatDuration(3600)).toBe("60m 0s")
  })

  it("clamps negative values to 0s", () => {
    expect(formatDuration(-5)).toBe("0s")
  })
})
