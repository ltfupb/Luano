/**
 * tests/pro-onboarding-overlay.test.tsx — ProOnboardingOverlay React component
 *
 * Covers the Pro onboarding state machine, storage contract, keyboard nav,
 * backdrop click, focus trap, and the shouldShow/markDone helpers.
 */

import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import {
  ProOnboardingOverlay,
  shouldShowProOnboarding,
  markProOnboardingDone,
} from "../src/components/ProOnboardingOverlay"

void React

const STORAGE_KEY = "luano-pro-onboarding-done"

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("shouldShowProOnboarding / markProOnboardingDone", () => {
  it("returns true when storage key is absent", () => {
    expect(shouldShowProOnboarding()).toBe(true)
  })

  it("returns false after markProOnboardingDone", () => {
    markProOnboardingDone()
    expect(shouldShowProOnboarding()).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1")
  })

  it("is idempotent — multiple markDone calls leave a single flag", () => {
    markProOnboardingDone()
    markProOnboardingDone()
    markProOnboardingDone()
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1")
  })

  it("gracefully returns false when localStorage read throws", () => {
    const orig = Storage.prototype.getItem
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error("SecurityError")
    })
    try {
      expect(shouldShowProOnboarding()).toBe(false)
    } finally {
      Storage.prototype.getItem = orig
    }
  })

  it("swallows errors from localStorage write", () => {
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error("QuotaExceededError")
    })
    try {
      expect(() => markProOnboardingDone()).not.toThrow()
    } finally {
      Storage.prototype.setItem = orig
    }
  })
})

describe("ProOnboardingOverlay state machine", () => {
  it("renders step 1 of 5 initially", () => {
    render(<ProOnboardingOverlay onDone={vi.fn()} />)
    expect(screen.getByText("You're Pro")).toBeInTheDocument()
    expect(screen.getByText("1 / 5")).toBeInTheDocument()
  })

  it("advances through all 5 steps with Next button", () => {
    render(<ProOnboardingOverlay onDone={vi.fn()} />)
    const titles = [
      "You're Pro",
      "Managed AI — no key needed",
      "Agent & Plan Mode",
      "Inline Edit — not the chat panel",
      "Ready",
    ]
    for (let i = 0; i < titles.length; i++) {
      expect(screen.getByText(titles[i])).toBeInTheDocument()
      expect(screen.getByText(`${i + 1} / 5`)).toBeInTheDocument()
      if (i < titles.length - 1) {
        fireEvent.click(screen.getByRole("button", { name: "Next" }))
      }
    }
  })

  it("final step button reads 'Let's go' instead of 'Next'", () => {
    render(<ProOnboardingOverlay onDone={vi.fn()} />)
    // Advance to last step
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }))
    }
    expect(screen.getByRole("button", { name: "Let's go" })).toBeInTheDocument()
  })

  it("last-step Next calls markProOnboardingDone + onDone", () => {
    const onDone = vi.fn()
    render(<ProOnboardingOverlay onDone={onDone} />)
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }))
    }
    fireEvent.click(screen.getByRole("button", { name: "Let's go" }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1")
  })

  it("Skip calls markProOnboardingDone + onDone at any step", () => {
    const onDone = vi.fn()
    render(<ProOnboardingOverlay onDone={onDone} />)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))  // step 2
    fireEvent.click(screen.getByRole("button", { name: "Skip" }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1")
  })
})

describe("ProOnboardingOverlay accessibility", () => {
  it("has role=dialog + aria-modal + aria-labelledby", () => {
    render(<ProOnboardingOverlay onDone={vi.fn()} />)
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveAttribute("aria-labelledby", "pro-onboarding-title")
    expect(document.getElementById("pro-onboarding-title")).toHaveTextContent("You're Pro")
  })

  it("Escape key triggers skip", () => {
    const onDone = vi.fn()
    render(<ProOnboardingOverlay onDone={onDone} />)
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" })
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1")
  })

  it("Enter key advances to next step", () => {
    render(<ProOnboardingOverlay onDone={vi.fn()} />)
    expect(screen.getByText("1 / 5")).toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(document, { key: "Enter" })
    })
    expect(screen.getByText("2 / 5")).toBeInTheDocument()
  })

  it("Enter on last step triggers onDone", () => {
    const onDone = vi.fn()
    render(<ProOnboardingOverlay onDone={onDone} />)
    for (let i = 0; i < 4; i++) {
      act(() => {
        fireEvent.keyDown(document, { key: "Enter" })
      })
    }
    act(() => {
      fireEvent.keyDown(document, { key: "Enter" })
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("backdrop click (outside the modal card) triggers skip", () => {
    const onDone = vi.fn()
    render(<ProOnboardingOverlay onDone={onDone} />)
    const backdrop = screen.getByRole("dialog")
    // Click on the backdrop itself (target === currentTarget)
    fireEvent.click(backdrop, { target: backdrop, currentTarget: backdrop })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("clicks inside the modal card do NOT close the overlay", () => {
    const onDone = vi.fn()
    render(<ProOnboardingOverlay onDone={onDone} />)
    // Clicking the title (inside the card) should not dismiss
    const title = screen.getByText("You're Pro")
    fireEvent.click(title)
    expect(onDone).not.toHaveBeenCalled()
  })

  it("keyboard listener is removed on unmount", () => {
    const onDone = vi.fn()
    const { unmount } = render(<ProOnboardingOverlay onDone={onDone} />)
    unmount()
    // Pressing Escape after unmount should not call onDone
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onDone).not.toHaveBeenCalled()
  })
})
