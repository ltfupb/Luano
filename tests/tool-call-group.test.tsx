/**
 * tests/tool-call-group.test.tsx — ToolCallGroup component
 *
 * Flat inline layout: each tool call is a row. Click row to toggle raw output.
 * Failed tools auto-expand.
 */

import React from "react"
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { ToolCallGroup } from "../src/ai/ToolCallGroup"
import type { ChatMessage } from "../src/stores/aiStore"

void React

const mkEvent = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: Math.random().toString(36).slice(2),
  role: "tool",
  content: "result text",
  toolName: "read_file",
  toolSuccess: true,
  ...overrides
} as ChatMessage)

describe("ToolCallGroup", () => {
  it("collapses multi-tool groups behind a summary header, expands on click", () => {
    const events = [mkEvent({ toolName: "read_file" }), mkEvent({ toolName: "edit_file" })]
    render(<ToolCallGroup events={events} />)
    // Collapsed: summary "2 tools used" is visible; individual rows are hidden.
    const header = screen.getByText("2 tools used")
    expect(header).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Read$/ })).not.toBeInTheDocument()
    // Expand the group and the individual tool rows appear.
    fireEvent.click(header)
    expect(screen.getByText("Read")).toBeInTheDocument()
    expect(screen.getByText("Edit")).toBeInTheDocument()
  })

  it("starts with successful rows collapsed (no output body visible)", () => {
    render(<ToolCallGroup events={[mkEvent({ content: "hello world output" })]} />)
    expect(screen.queryByText("hello world output")).not.toBeInTheDocument()
  })

  it("reveals raw output when a row is clicked", () => {
    render(<ToolCallGroup events={[mkEvent({ toolName: "read_file", content: "hello world output" })]} />)
    fireEvent.click(screen.getByText("Read"))
    expect(screen.getByText("hello world output")).toBeInTheDocument()
  })

  it("does not auto-expand failed tools — user clicks to reveal the error body", () => {
    const events = [mkEvent({ toolName: "edit_file", toolSuccess: false, content: "ERROR: text not found" })]
    render(<ToolCallGroup events={events} />)
    expect(screen.queryByText("ERROR: text not found")).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("Edit"))
    expect(screen.getByText("ERROR: text not found")).toBeInTheDocument()
  })

  it("falls back to tool name for unknown tools", () => {
    render(<ToolCallGroup events={[mkEvent({ toolName: "custom_tool" })]} />)
    expect(screen.getByText("custom_tool")).toBeInTheDocument()
  })

  it("shows empty-output placeholder when content is missing after expand", () => {
    render(<ToolCallGroup events={[mkEvent({ toolName: "read_file", content: "" })]} />)
    fireEvent.click(screen.getByText("Read"))
    expect(screen.getByText("No output")).toBeInTheDocument()
  })

  it("toggles output open/close on repeated clicks", () => {
    render(<ToolCallGroup events={[mkEvent({ toolName: "read_file", content: "stuff" })]} />)
    fireEvent.click(screen.getByText("Read"))
    expect(screen.getByText("stuff")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Read"))
    expect(screen.queryByText("stuff")).not.toBeInTheDocument()
  })
})
