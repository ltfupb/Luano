/**
 * tests/ask-user-card.test.tsx — AskUserCard React component
 */

import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { AskUserCard } from "../src/ai/AskUserCard"

// React import suppresses "React is not defined" — JSX in tests needs it
void React

const baseQuestion = {
  question: "Pick approach",
  header: "Approach",
  options: [
    { label: "Fast", description: "Less safe" },
    { label: "Safe", description: "Slower" }
  ]
}

const makeRequest = (questions = [baseQuestion]) => ({ id: "req-1", questions })

describe("AskUserCard", () => {
  it("renders the question text and chip header", () => {
    render(<AskUserCard request={makeRequest()} onSubmit={vi.fn()} />)
    expect(screen.getByText("Pick approach")).toBeInTheDocument()
    expect(screen.getByText("Approach")).toBeInTheDocument()
  })

  it("renders all options with their descriptions", () => {
    render(<AskUserCard request={makeRequest()} onSubmit={vi.fn()} />)
    expect(screen.getByText("Fast")).toBeInTheDocument()
    expect(screen.getByText("Safe")).toBeInTheDocument()
    expect(screen.getByText("Less safe")).toBeInTheDocument()
  })

  it("Submit is disabled until an option is selected", () => {
    render(<AskUserCard request={makeRequest()} onSubmit={vi.fn()} />)
    expect(screen.getByText("Submit")).toBeDisabled()
  })

  it("Submit becomes enabled after selecting an option", () => {
    render(<AskUserCard request={makeRequest()} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByText("Fast"))
    expect(screen.getByText("Submit")).not.toBeDisabled()
  })

  it("calls onSubmit with index-keyed answers when Submit is clicked", () => {
    const onSubmit = vi.fn()
    render(<AskUserCard request={makeRequest()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText("Fast"))
    fireEvent.click(screen.getByText("Submit"))
    expect(onSubmit).toHaveBeenCalledWith("req-1", { "0": "Fast" })
  })

  it("does not call onSubmit when disabled Submit is clicked", () => {
    const onSubmit = vi.fn()
    render(<AskUserCard request={makeRequest()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText("Submit"))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("requires all questions answered for multi-question request", () => {
    const req = makeRequest([
      { question: "Q1", header: "H1", options: [{ label: "A" }, { label: "B" }] },
      { question: "Q2", header: "H2", options: [{ label: "C" }, { label: "D" }] }
    ])
    render(<AskUserCard request={req} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByText("A"))
    expect(screen.getByText("Submit")).toBeDisabled() // Q2 still unanswered
    fireEvent.click(screen.getByText("D"))
    expect(screen.getByText("Submit")).not.toBeDisabled()
  })

  it("truncates header chip text to 12 characters", () => {
    const req = makeRequest([{
      question: "Q",
      header: "VeryLongHeaderText",
      options: [{ label: "X" }, { label: "Y" }]
    }])
    render(<AskUserCard request={req} onSubmit={vi.fn()} />)
    expect(screen.getByText("VeryLongHead")).toBeInTheDocument()
  })

  it("multiSelect: clicking same option toggles it off", () => {
    const onSubmit = vi.fn()
    const req = makeRequest([{
      question: "Pick",
      header: "Multi",
      options: [{ label: "A" }, { label: "B" }],
      multiSelect: true
    }])
    render(<AskUserCard request={req} onSubmit={onSubmit} />)
    // First click selects, label becomes "A ✓"
    fireEvent.click(screen.getByText("A"))
    fireEvent.click(screen.getByText("B"))
    // After selection labels are "A ✓" and "B ✓" — match by partial
    fireEvent.click(screen.getByText(/^A/)) // toggle A off
    fireEvent.click(screen.getByText("Submit"))
    expect(onSubmit).toHaveBeenCalledWith("req-1", { "0": "B" })
  })

  it("multiSelect: comma-joins selected labels", () => {
    const onSubmit = vi.fn()
    const req = makeRequest([{
      question: "Pick",
      header: "Multi",
      options: [{ label: "A" }, { label: "B" }, { label: "C" }],
      multiSelect: true
    }])
    render(<AskUserCard request={req} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText("A"))
    fireEvent.click(screen.getByText("C"))
    fireEvent.click(screen.getByText("Submit"))
    expect(onSubmit).toHaveBeenCalledWith("req-1", { "0": "A, C" })
  })

  it("shows multi indicator for multiSelect questions", () => {
    const req = makeRequest([{
      question: "Q", header: "H",
      options: [{ label: "X" }, { label: "Y" }], multiSelect: true
    }])
    render(<AskUserCard request={req} onSubmit={vi.fn()} />)
    expect(screen.getByText("multi")).toBeInTheDocument()
  })
})
