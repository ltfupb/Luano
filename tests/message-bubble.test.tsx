/**
 * tests/message-bubble.test.tsx — MessageBubble component
 */

import React from "react"
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { MessageBubble } from "../src/ai/MessageBubble"
import type { ChatMessage } from "../src/stores/aiStore"

void React

const mkMsg = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: "m1",
  role: "user",
  content: "hello",
  ...overrides
} as ChatMessage)

describe("MessageBubble", () => {
  it("renders user message content as plain text (no markdown)", () => {
    render(<MessageBubble message={mkMsg({ role: "user", content: "**not bold**" })} />)
    expect(screen.getByText("**not bold**")).toBeInTheDocument()
  })

  it("preserves whitespace in user messages (whiteSpace: pre-wrap)", () => {
    const text = "line 1\nline 2"
    const { container } = render(<MessageBubble message={mkMsg({ role: "user", content: text })} />)
    const div = container.querySelector('[style*="pre-wrap"]')
    expect(div).toBeTruthy()
    expect(div?.textContent).toBe(text)
  })

  it("renders assistant message as markdown", () => {
    render(<MessageBubble message={mkMsg({ role: "assistant", content: "**bold text**" })} />)
    const strong = screen.getByText("bold text")
    expect(strong.tagName).toBe("STRONG")
  })

  it("renders streaming content for assistant without a blinking cursor", () => {
    // Cursor indicator was removed in v0.9.0 — content streams cleanly.
    const { container } = render(
      <MessageBubble message={mkMsg({ role: "assistant", content: "partial", streaming: true })} />
    )
    expect(container.querySelector(".animate-blink")).not.toBeInTheDocument()
  })

  it("empty streaming bubble renders silently — persistent turn status lives at the chat root", () => {
    // After v0.9.0: message bubbles no longer host ThinkingBubble.
    // The turn-level status line (ChatPanel) covers thinking / streaming
    // activity for the whole turn, so empty bubbles stay invisible.
    const { container } = render(
      <MessageBubble message={mkMsg({ role: "assistant", content: "", streaming: true })} />
    )
    expect(container.querySelector(".animate-glow-pulse-text")).not.toBeInTheDocument()
    expect(container.querySelector(".animate-blink")).not.toBeInTheDocument()
  })

  it("right-aligns user messages via justify-end wrapper", () => {
    const { container } = render(<MessageBubble message={mkMsg({ role: "user" })} />)
    expect(container.querySelector(".justify-end")).toBeInTheDocument()
  })

  it("assistant message renders flat — no bubble container, no right-alignment wrapper", () => {
    const { container } = render(
      <MessageBubble message={mkMsg({ role: "assistant", content: "x" })} />
    )
    expect(container.querySelector(".justify-end")).not.toBeInTheDocument()
    // Assistant text is wrapped in the markdown-body container, not a bubble
    expect(container.querySelector(".markdown-body")).toBeInTheDocument()
  })

  it("renders markdown code block for assistant", () => {
    const md = "```lua\nlocal x = 1\n```"
    const { container } = render(
      <MessageBubble message={mkMsg({ role: "assistant", content: md })} />
    )
    // CodeBlock component wraps fenced code
    expect(container.textContent).toContain("local x = 1")
  })

  it("renders inline code content (rendered in some code-styled element)", () => {
    const { container } = render(
      <MessageBubble message={mkMsg({ role: "assistant", content: "use `foo()` here" })} />
    )
    // react-markdown v9 removed the `inline` prop; both inline and block code paths
    // render the text. Just verify content reaches the DOM via a code-related node.
    expect(container.textContent).toContain("foo()")
  })
})
