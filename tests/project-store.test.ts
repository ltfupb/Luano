/**
 * tests/project-store.test.ts — Unit tests for src/stores/projectStore.ts
 *
 * Runs in jsdom (localStorage available).
 * Tests file open/close lifecycle, dirty tracking, and project switching.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { useProjectStore } from "../src/stores/projectStore"

// ── Reset helpers ─────────────────────────────────────────────────────────────

const INITIAL: Parameters<typeof useProjectStore.setState>[0] = {
  projectPath: null,
  fileTree: [],
  openFiles: [],
  activeFile: null,
  fileContents: {},
  lspPort: null,
  dirtyFiles: []
}

beforeEach(() => {
  useProjectStore.setState(INITIAL)
})

afterEach(() => {
  localStorage.clear()
})

// ── setProject ────────────────────────────────────────────────────────────────

describe("setProject", () => {
  it("sets projectPath, fileTree, and lspPort", () => {
    const tree = [{ name: "foo.luau", path: "/p/foo.luau", type: "file" as const }]
    useProjectStore.getState().setProject("/p", tree, 6008)
    const state = useProjectStore.getState()
    expect(state.projectPath).toBe("/p")
    expect(state.fileTree).toEqual(tree)
    expect(state.lspPort).toBe(6008)
  })
})

// ── closeProject ──────────────────────────────────────────────────────────────

describe("closeProject", () => {
  it("resets all state to defaults", () => {
    useProjectStore.getState().setProject("/p", [], 6008)
    useProjectStore.getState().openFile("/p/foo.luau", "return {}")
    useProjectStore.getState().updateFileContent("/p/foo.luau", "edited")
    useProjectStore.getState().closeProject()
    const state = useProjectStore.getState()
    expect(state.projectPath).toBeNull()
    expect(state.openFiles).toHaveLength(0)
    expect(state.activeFile).toBeNull()
    expect(state.fileContents).toEqual({})
    expect(state.dirtyFiles).toHaveLength(0)
    expect(state.lspPort).toBeNull()
  })
})

// ── openFile ──────────────────────────────────────────────────────────────────

describe("openFile", () => {
  it("adds file to openFiles and sets activeFile", () => {
    useProjectStore.getState().openFile("/p/foo.lua", "-- code")
    const state = useProjectStore.getState()
    expect(state.openFiles).toContain("/p/foo.lua")
    expect(state.activeFile).toBe("/p/foo.lua")
    expect(state.fileContents["/p/foo.lua"]).toBe("-- code")
  })

  it("does not duplicate if file is already open", () => {
    useProjectStore.getState().openFile("/p/foo.lua", "v1")
    useProjectStore.getState().openFile("/p/foo.lua", "v2")
    expect(useProjectStore.getState().openFiles).toHaveLength(1)
  })

  it("updates content and sets active even when already open", () => {
    useProjectStore.getState().openFile("/p/foo.lua", "v1")
    useProjectStore.getState().openFile("/p/foo.lua", "v2")
    const state = useProjectStore.getState()
    expect(state.fileContents["/p/foo.lua"]).toBe("v2")
    expect(state.activeFile).toBe("/p/foo.lua")
  })

  it("opens multiple files in order", () => {
    useProjectStore.getState().openFile("/p/a.lua", "a")
    useProjectStore.getState().openFile("/p/b.lua", "b")
    expect(useProjectStore.getState().openFiles).toEqual(["/p/a.lua", "/p/b.lua"])
    expect(useProjectStore.getState().activeFile).toBe("/p/b.lua")
  })
})

// ── closeFile ─────────────────────────────────────────────────────────────────

describe("closeFile", () => {
  it("removes file from openFiles", () => {
    useProjectStore.getState().openFile("/p/foo.lua", "x")
    useProjectStore.getState().closeFile("/p/foo.lua")
    expect(useProjectStore.getState().openFiles).not.toContain("/p/foo.lua")
  })

  it("sets activeFile to the last remaining file when closing the active file", () => {
    useProjectStore.getState().openFile("/p/a.lua", "a")
    useProjectStore.getState().openFile("/p/b.lua", "b")
    useProjectStore.getState().closeFile("/p/b.lua") // b is active
    expect(useProjectStore.getState().activeFile).toBe("/p/a.lua")
  })

  it("sets activeFile to null when no files remain", () => {
    useProjectStore.getState().openFile("/p/only.lua", "x")
    useProjectStore.getState().closeFile("/p/only.lua")
    expect(useProjectStore.getState().activeFile).toBeNull()
  })

  it("keeps activeFile unchanged when closing a non-active file", () => {
    useProjectStore.getState().openFile("/p/a.lua", "a")
    useProjectStore.getState().openFile("/p/b.lua", "b")
    useProjectStore.getState().setActiveFile("/p/b.lua")
    useProjectStore.getState().closeFile("/p/a.lua")
    expect(useProjectStore.getState().activeFile).toBe("/p/b.lua")
  })

  it("removes closed file from dirtyFiles", () => {
    useProjectStore.getState().openFile("/p/foo.lua", "x")
    useProjectStore.getState().updateFileContent("/p/foo.lua", "edited")
    expect(useProjectStore.getState().dirtyFiles).toContain("/p/foo.lua")
    useProjectStore.getState().closeFile("/p/foo.lua")
    expect(useProjectStore.getState().dirtyFiles).not.toContain("/p/foo.lua")
  })
})

// ── updateFileContent ─────────────────────────────────────────────────────────

describe("updateFileContent", () => {
  it("updates file content and marks as dirty", () => {
    useProjectStore.getState().openFile("/p/foo.lua", "original")
    useProjectStore.getState().updateFileContent("/p/foo.lua", "modified")
    const state = useProjectStore.getState()
    expect(state.fileContents["/p/foo.lua"]).toBe("modified")
    expect(state.dirtyFiles).toContain("/p/foo.lua")
  })

  it("does not duplicate in dirtyFiles on multiple edits", () => {
    useProjectStore.getState().openFile("/p/foo.lua", "v1")
    useProjectStore.getState().updateFileContent("/p/foo.lua", "v2")
    useProjectStore.getState().updateFileContent("/p/foo.lua", "v3")
    expect(useProjectStore.getState().dirtyFiles.filter((f) => f === "/p/foo.lua")).toHaveLength(1)
  })
})

// ── markClean ─────────────────────────────────────────────────────────────────

describe("markClean", () => {
  it("removes file from dirtyFiles", () => {
    useProjectStore.getState().openFile("/p/foo.lua", "x")
    useProjectStore.getState().updateFileContent("/p/foo.lua", "edited")
    useProjectStore.getState().markClean("/p/foo.lua")
    expect(useProjectStore.getState().dirtyFiles).not.toContain("/p/foo.lua")
  })

  it("is safe to call on a clean file", () => {
    useProjectStore.getState().openFile("/p/foo.lua", "x")
    expect(() => useProjectStore.getState().markClean("/p/foo.lua")).not.toThrow()
  })
})

// ── setFileTree ───────────────────────────────────────────────────────────────

describe("setFileTree", () => {
  it("replaces the file tree", () => {
    const tree = [{ name: "mod.luau", path: "/p/mod.luau", type: "file" as const }]
    useProjectStore.getState().setFileTree(tree)
    expect(useProjectStore.getState().fileTree).toEqual(tree)
  })
})

// ── reorderFiles ──────────────────────────────────────────────────────────────

describe("reorderFiles", () => {
  it("moves a file from one index to another", () => {
    useProjectStore.getState().openFile("/p/a.lua", "a")
    useProjectStore.getState().openFile("/p/b.lua", "b")
    useProjectStore.getState().openFile("/p/c.lua", "c")
    // move a (index 0) to index 2
    useProjectStore.getState().reorderFiles(0, 2)
    expect(useProjectStore.getState().openFiles).toEqual(["/p/b.lua", "/p/c.lua", "/p/a.lua"])
  })

  it("handles moving to front", () => {
    useProjectStore.getState().openFile("/p/a.lua", "a")
    useProjectStore.getState().openFile("/p/b.lua", "b")
    useProjectStore.getState().openFile("/p/c.lua", "c")
    // move c (index 2) to index 0
    useProjectStore.getState().reorderFiles(2, 0)
    expect(useProjectStore.getState().openFiles).toEqual(["/p/c.lua", "/p/a.lua", "/p/b.lua"])
  })
})
