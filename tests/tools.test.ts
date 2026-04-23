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
  const grep = findTool("Grep")

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
  const multiEdit = findTool("MultiEdit")

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
    "Read", "Edit", "MultiEdit", "Patch", "Write", "Delete",
    "Glob", "Grep", "SearchDocs", "Lint", "Format",
    "TypeCheck", "TodoWrite", "ReadInstanceTree", "RuntimeLogs",
    "RunScript", "SetProperty", "InsertModel",
    "WagRead", "WagSearch", "WagUpdate", "AskUser"
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
