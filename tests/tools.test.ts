import { describe, it, expect, vi } from "vitest"

// Mock Electron + heavy sidecar/bridge dependencies before importing tools
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))
vi.mock("../electron/sidecar/index", () => ({
  spawnSidecar: vi.fn(),
  isBinaryAvailable: vi.fn(() => false)
}))
vi.mock("../electron/sidecar/selene", () => ({
  lintFile: vi.fn()
}))
vi.mock("../electron/sidecar/stylua", () => ({
  formatFile: vi.fn()
}))
vi.mock("../electron/bridge/server", () => ({
  getBridgeTree: vi.fn(),
  getBridgeLogs: vi.fn(),
  isBridgeConnected: vi.fn(() => false),
  queueScript: vi.fn(),
  consumeCommandResult: vi.fn()
}))
vi.mock("../electron/mcp/client", () => ({
  isMcpConnected: vi.fn(async () => false),
  mcpRunCode: vi.fn(async () => ({ success: false, output: "MCP not connected" })),
  mcpGetConsole: vi.fn(async () => null),
  mcpInsertModel: vi.fn(async () => ({ success: false, output: "MCP not connected" }))
}))
vi.mock("../electron/ai/rag", () => ({
  searchDocs: vi.fn()
}))
vi.mock("../electron/file/sandbox", () => ({
  validatePath: vi.fn()
}))

import { TOOLS } from "../electron/ai/tools"

function findTool(name: string) {
  return TOOLS.find((t) => t.name === name)
}

describe("grep tool schema", () => {
  const grep = findTool("grep")

  it("exists", () => {
    expect(grep).toBeDefined()
  })

  it("has pattern as required parameter", () => {
    const props = grep!.input_schema as { required?: string[] }
    expect(props.required).toContain("pattern")
  })

  it("supports glob, context, and output_mode parameters", () => {
    const props = (grep!.input_schema as { properties?: Record<string, unknown> }).properties ?? {}
    expect(props).toHaveProperty("glob")
    expect(props).toHaveProperty("context")
    expect(props).toHaveProperty("output_mode")
  })
})

describe("multi_edit tool schema", () => {
  const multiEdit = findTool("multi_edit")

  it("exists", () => {
    expect(multiEdit).toBeDefined()
  })

  it("has path and edits as required", () => {
    const props = multiEdit!.input_schema as { required?: string[] }
    expect(props.required).toContain("path")
    expect(props.required).toContain("edits")
  })
})

describe("tool list completeness", () => {
  const expectedTools = [
    "read_file", "edit_file", "multi_edit", "patch_file", "create_file", "delete_file",
    "list_files", "grep", "search_docs", "lint_file", "format_file",
    "type_check", "todo_write", "read_instance_tree", "get_runtime_logs",
    "run_studio_script", "set_property", "insert_model",
    "wag_read", "wag_search", "wag_update", "ask_user"
  ]

  it("has all 22 client tools", () => {
    expect(TOOLS).toHaveLength(22)
  })

  for (const name of expectedTools) {
    it(`includes ${name}`, () => {
      expect(findTool(name)).toBeDefined()
    })
  }
})
