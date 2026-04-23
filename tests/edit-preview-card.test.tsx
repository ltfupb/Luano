/**
 * tests/edit-preview-card.test.tsx — EditPreviewCard React component
 *
 * Coverage:
 * - Header (kind label, filename, stat)
 * - Create / Edit / Delete rendering paths
 * - Unified diff rows (add / del / ctx)
 * - Error banner (missing file, duplicate old_text)
 * - Y / N keyboard shortcuts (fired + ignored when typing in an input)
 * - LCS guard fallback when diff is too large (m*n > 2M cells)
 */

import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { EditPreviewCard } from "../src/ai/EditPreviewCard"

void React

function makePreview(overrides: Partial<{
  path: string
  oldContent: string
  newContent: string | null
  kind: "create" | "edit" | "delete"
  error: string
}> = {}) {
  return {
    path: overrides.path ?? "/project/script.luau",
    oldContent: overrides.oldContent ?? "",
    newContent: overrides.newContent ?? "",
    kind: overrides.kind ?? "edit",
    error: overrides.error
  }
}

describe("EditPreviewCard — create path", () => {
  it("renders Create label and all lines as additions", () => {
    const preview = makePreview({
      kind: "create",
      path: "/project/new.luau",
      oldContent: "",
      newContent: "local x = 1\nreturn x"
    })
    render(<EditPreviewCard tool="Write" preview={preview} input={{}} onAccept={vi.fn()} onReject={vi.fn()} />)

    expect(screen.getByText("Create")).toBeInTheDocument()
    expect(screen.getByText("new.luau")).toBeInTheDocument()
    // Both content lines visible
    expect(screen.getByText("local x = 1")).toBeInTheDocument()
    expect(screen.getByText("return x")).toBeInTheDocument()
    // stat shows +2
    expect(screen.getByText("+2")).toBeInTheDocument()
  })

  it("infers create kind from tool name when preview is null", () => {
    render(
      <EditPreviewCard
        tool="Write"
        preview={null}
        input={{ path: "/project/new.luau", content: "-- empty" }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />
    )
    expect(screen.getByText("Create")).toBeInTheDocument()
  })
})

describe("EditPreviewCard — delete path", () => {
  it("renders Delete label and all lines as removals", () => {
    const preview = makePreview({
      kind: "delete",
      path: "/project/old.luau",
      oldContent: "print('bye')\nreturn nil"
    })
    render(<EditPreviewCard tool="Delete" preview={preview} input={{}} onAccept={vi.fn()} onReject={vi.fn()} />)

    expect(screen.getByText("Delete")).toBeInTheDocument()
    expect(screen.getByText("-2")).toBeInTheDocument()
  })
})

describe("EditPreviewCard — edit path", () => {
  it("renders unified diff with add + del + context rows", () => {
    const preview = makePreview({
      kind: "edit",
      path: "/project/script.luau",
      oldContent: "local x = 1\nreturn x",
      newContent: "local x = 99\nreturn x"
    })
    render(<EditPreviewCard tool="Edit" preview={preview} input={{}} onAccept={vi.fn()} onReject={vi.fn()} />)

    // One add, one del, one ctx (return x stays)
    expect(screen.getByText("+1")).toBeInTheDocument()
    expect(screen.getByText("-1")).toBeInTheDocument()
    expect(screen.getByText("local x = 1")).toBeInTheDocument()
    expect(screen.getByText("local x = 99")).toBeInTheDocument()
  })
})

describe("EditPreviewCard — error banner", () => {
  it("shows the preview error and hides the diff body", () => {
    const preview = makePreview({
      kind: "edit",
      error: "old_text matches 3 locations"
    })
    render(<EditPreviewCard tool="Edit" preview={preview} input={{}} onAccept={vi.fn()} onReject={vi.fn()} />)

    expect(screen.getByText(/Cannot preview: old_text matches 3 locations/)).toBeInTheDocument()
    // No diff content rendered
    expect(screen.queryByText(/^\+$/)).toBeNull()
  })
})

describe("EditPreviewCard — keyboard shortcuts", () => {
  it("Y accepts", () => {
    const onAccept = vi.fn()
    const onReject = vi.fn()
    const preview = makePreview({ kind: "edit", oldContent: "a", newContent: "b" })
    render(<EditPreviewCard tool="Edit" preview={preview} input={{}} onAccept={onAccept} onReject={onReject} />)

    fireEvent.keyDown(window, { key: "y" })
    expect(onAccept).toHaveBeenCalledOnce()
    expect(onReject).not.toHaveBeenCalled()
  })

  it("N rejects", () => {
    const onAccept = vi.fn()
    const onReject = vi.fn()
    const preview = makePreview({ kind: "edit", oldContent: "a", newContent: "b" })
    render(<EditPreviewCard tool="Edit" preview={preview} input={{}} onAccept={onAccept} onReject={onReject} />)

    fireEvent.keyDown(window, { key: "N" })
    expect(onReject).toHaveBeenCalledOnce()
    expect(onAccept).not.toHaveBeenCalled()
  })

  it("ignores Y/N while the user is typing in an input", () => {
    const onAccept = vi.fn()
    const preview = makePreview({ kind: "edit", oldContent: "a", newContent: "b" })
    const { container } = render(
      <div>
        <input data-testid="typing-target" />
        <EditPreviewCard tool="Edit" preview={preview} input={{}} onAccept={onAccept} onReject={vi.fn()} />
      </div>
    )
    const input = container.querySelector("input")!
    input.focus()
    fireEvent.keyDown(input, { key: "y" })
    expect(onAccept).not.toHaveBeenCalled()
  })

  it("removes the listener on unmount — shortcuts do not fire after", () => {
    const onAccept = vi.fn()
    const preview = makePreview({ kind: "edit", oldContent: "a", newContent: "b" })
    const { unmount } = render(
      <EditPreviewCard tool="Edit" preview={preview} input={{}} onAccept={onAccept} onReject={vi.fn()} />
    )
    unmount()
    fireEvent.keyDown(window, { key: "y" })
    expect(onAccept).not.toHaveBeenCalled()
  })
})

describe("EditPreviewCard — LCS OOM guard", () => {
  it("falls back to a summary view for very large diffs", () => {
    // 2000 * 2000 = 4M > LCS_MAX_CELLS (2M). Force fallback.
    const bigOld = Array.from({ length: 2000 }, (_, i) => `old line ${i}`).join("\n")
    const bigNew = Array.from({ length: 2000 }, (_, i) => `new line ${i}`).join("\n")
    const preview = makePreview({ kind: "edit", oldContent: bigOld, newContent: bigNew })

    render(<EditPreviewCard tool="Edit" preview={preview} input={{}} onAccept={vi.fn()} onReject={vi.fn()} />)

    // Summary marker line should be present
    expect(screen.getByText(/file too large for full diff/)).toBeInTheDocument()
  })
})
