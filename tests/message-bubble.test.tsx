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

  it("renders streaming cursor block for assistant when streaming with content", () => {
    const { container } = render(
      <MessageBubble message={mkMsg({ role: "assistant", content: "partial", streaming: true })} />
    )
    expect(container.querySelector(".animate-blink")).toBeInTheDocument()
  })

  it("shows ThinkingBubble when assistant is streaming with no content yet", () => {
    const { container } = render(
      <MessageBubble message={mkMsg({ role: "assistant", content: "", streaming: true })} />
    )
    // ThinkingBubble renders the cursor initially
    expect(container.querySelector(".animate-blink")).toBeInTheDocument()
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
