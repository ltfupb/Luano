/**
 * tests/ai-store-migration.test.ts — zustand persist migration for aiStore.
 *
 * Covers the snake_case → PascalCase toolName rename introduced when
 * Luano renamed its AI tool surface to CC's convention. Pre-v0.8.6 user
 * sessions stored toolName as "read_file", "edit_file", etc.; on first
 * load after the rename, migrate() must rewrite those to "Read", "Edit",
 * etc. so the tool-call icon / label map still resolves.
 */

import { describe, it, expect } from "vitest"
import { migrateToolName, TOOL_NAME_MIGRATION } from "../src/stores/aiStore"

describe("migrateToolName", () => {
  it("returns undefined for undefined input", () => {
    expect(migrateToolName(undefined)).toBeUndefined()
  })

  it("returns empty string unchanged", () => {
    expect(migrateToolName("")).toBe("")
  })

  it("maps every snake_case name to its PascalCase equivalent", () => {
    const expectedMappings: Array<[string, string]> = [
      ["read_file", "Read"],
      ["edit_file", "Edit"],
      ["multi_edit", "MultiEdit"],
      ["create_file", "Write"],
      ["delete_file", "Delete"],
      ["list_files", "Glob"],
      ["lint_file", "Lint"],
      ["format_file", "Format"],
      ["type_check", "TypeCheck"],
      ["patch_file", "Patch"],
      ["search_docs", "SearchDocs"],
      ["read_instance_tree", "ReadInstanceTree"],
      ["get_runtime_logs", "RuntimeLogs"],
      ["run_studio_script", "RunScript"],
      ["set_property", "SetProperty"],
      ["insert_model", "InsertModel"],
      ["todo_write", "TodoWrite"],
      ["wag_read", "WagRead"],
      ["wag_search", "WagSearch"],
      ["wag_update", "WagUpdate"],
      ["ask_user", "AskUser"]
    ]
    for (const [oldName, newName] of expectedMappings) {
      expect(migrateToolName(oldName)).toBe(newName)
    }
  })

  it("maps legacy lowercase 'grep' → 'Grep' (case-sensitive branch)", () => {
    expect(migrateToolName("grep")).toBe("Grep")
    expect(migrateToolName("grep_files")).toBe("Grep")
  })

  it("leaves already-migrated PascalCase names unchanged", () => {
    expect(migrateToolName("Read")).toBe("Read")
    expect(migrateToolName("Edit")).toBe("Edit")
    expect(migrateToolName("Grep")).toBe("Grep")
    expect(migrateToolName("TypeCheck")).toBe("TypeCheck")
  })

  it("leaves unknown names unchanged (no spurious rewrites)", () => {
    expect(migrateToolName("custom_tool")).toBe("custom_tool")
    expect(migrateToolName("SomeNewTool")).toBe("SomeNewTool")
    expect(migrateToolName("mcp__slack__send")).toBe("mcp__slack__send")
  })

  it("TOOL_NAME_MIGRATION map is complete and self-consistent", () => {
    // Every mapped value should be distinct PascalCase (not a snake_case leftover).
    for (const [, newName] of Object.entries(TOOL_NAME_MIGRATION)) {
      expect(newName).not.toMatch(/_/)
      expect(newName[0]).toBe(newName[0].toUpperCase())
    }
  })
})
