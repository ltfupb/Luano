/**
 * tests/thinking-bubble.test.tsx — ThinkingBubble component
 */

import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { ThinkingBubble } from "../src/ai/ThinkingBubble"

void React

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("ThinkingBubble", () => {
  it("shows blinking cursor initially when thinkingActive is false", () => {
    const { container } = render(<ThinkingBubble thinkingActive={false} />)
    expect(container.querySelector(".animate-blink")).toBeInTheDocument()
  })

  it("shows ThinkingIndicator immediately when thinkingActive is true", () => {
    render(<ThinkingBubble thinkingActive={true} />)
    expect(screen.getByText(/Thinking|Reading|Analyzing|Writing|Almost/)).toBeInTheDocument()
  })

  it("transitions from cursor to ThinkingIndicator after 3s timeout", () => {
    const { container, rerender } = render(<ThinkingBubble thinkingActive={false} />)
    expect(container.querySelector(".animate-blink")).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(3000) })
    rerender(<ThinkingBubble thinkingActive={false} />)
    expect(screen.queryByText(/Thinking|Reading|Analyzing/)).toBeInTheDocument()
  })

  it("resets to cursor when thinkingActive prop transitions back to false", () => {
    const { rerender, container } = render(<ThinkingBubble thinkingActive={true} />)
    expect(screen.getByText(/Thinking|Reading|Analyzing/)).toBeInTheDocument()
    rerender(<ThinkingBubble thinkingActive={false} />)
    // After re-render with false, useEffect resets to cursor
    expect(container.querySelector(".animate-blink")).toBeInTheDocument()
  })

  it("does not crash when thinkingActive prop is undefined", () => {
    expect(() => render(<ThinkingBubble />)).not.toThrow()
  })
})
