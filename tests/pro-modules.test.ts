/**
 * tests/pro-modules.test.ts — Community-mode contract tests for electron/pro/modules.ts
 *
 * Goal: Verify that all exports are callable and return the expected shape,
 * and that the community system prompt is well-formed. Catches breakage if
 * someone renames an export, changes its signature, or removes a fallback.
 *
 * Note: In the private repo, Pro modules are loaded. These tests validate the
 * export CONTRACT (types, callability, return shape), not which implementation runs.
 * The community prompt is always tested because it is the fallback function embedded
 * in this file.
 */

import { describe, it, expect, vi } from "vitest"

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("../electron/store", () => ({
  store: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() }
}))

vi.mock("../electron/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import * as m from "../electron/pro/modules"

// ── Export shape tests ─────────────────────────────────────────────────────────

describe("pro/modules — all exports are callable", () => {
  it("isInternalKey is a function returning boolean", () => {
    expect(typeof m.isInternalKey).toBe("function")
    expect(typeof m.isInternalKey("someKey")).toBe("boolean")
  })

  it("buildGlobalSummary is an async function returning { globalSummary }", async () => {
    const result = await m.buildGlobalSummary("/project")
    expect(result).toHaveProperty("globalSummary")
    expect(typeof result.globalSummary).toBe("string")
  })

  it("buildSystemPrompt is a function returning a string", () => {
    const result = m.buildSystemPrompt({})
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })

  it("buildDocsContext is an async function returning string", async () => {
    const result = await m.buildDocsContext("RemoteEvent")
    expect(typeof result).toBe("string")
  })

  it("analyzeTopology is a function", () => {
    expect(typeof m.analyzeTopology).toBe("function")
  })

  it("analyzeCrossScript is a function", () => {
    expect(typeof m.analyzeCrossScript).toBe("function")
  })

  it("performanceLint is a function", () => {
    expect(typeof m.performanceLint).toBe("function")
  })

  it("performanceLintFile is a function", () => {
    expect(typeof m.performanceLintFile).toBe("function")
  })

  it("datastore exports are all functions", () => {
    expect(typeof m.loadSchemas).toBe("function")
    expect(typeof m.addSchema).toBe("function")
    expect(typeof m.deleteSchema).toBe("function")
    expect(typeof m.generateDataModule).toBe("function")
    expect(typeof m.generateMigration).toBe("function")
  })

  it("MCP exports are all functions", () => {
    expect(typeof m.getConsoleOutput).toBe("function")
    expect(typeof m.isStudioConnected).toBe("function")
  })

  it("bridge exports are all functions", () => {
    expect(typeof m.startBridgeServer).toBe("function")
    expect(typeof m.setBridgeWindow).toBe("function")
    expect(typeof m.getBridgeTree).toBe("function")
    expect(typeof m.getBridgeLogs).toBe("function")
    expect(typeof m.isBridgeConnected).toBe("function")
    expect(typeof m.clearBridgeLogs).toBe("function")
    expect(typeof m.queueScript).toBe("function")
    expect(typeof m.getCommandResult).toBe("function")
    expect(typeof m.getBridgeToken).toBe("function")
  })

  it("agent exports are all functions", () => {
    expect(typeof m.agentChat).toBe("function")
    expect(typeof m.inlineEdit).toBe("function")
    expect(typeof m.getLastCheckpoint).toBe("function")
    expect(typeof m.revertCheckpoint).toBe("function")
  })

  it("telemetry exports are all functions", () => {
    expect(typeof m.telemetryEnabled).toBe("function")
    expect(typeof m.setTelemetry).toBe("function")
    expect(typeof m.telemetryStats).toBe("function")
    expect(typeof m.recordDiff).toBe("function")
    expect(typeof m.recordQuery).toBe("function")
  })

  it("evaluator exports are all functions", () => {
    expect(typeof m.evaluateCode).toBe("function")
    expect(typeof m.evaluateFiles).toBe("function")
  })
})

// ── Community system prompt tests ─────────────────────────────────────────────

describe("community buildSystemPrompt", () => {
  it("includes Luano identity section", () => {
    const result = m.buildSystemPrompt({})
    expect(result).toContain("Luano")
    expect(result).toContain("Roblox")
  })

  it("includes globalSummary when provided", () => {
    const result = m.buildSystemPrompt({ globalSummary: "This project has 5 scripts." })
    expect(result).toContain("This project has 5 scripts.")
  })

  it("includes active file section when currentFile provided", () => {
    const result = m.buildSystemPrompt({ currentFile: "/project/main.luau" })
    expect(result).toContain("/project/main.luau")
  })

  it("includes code block when currentFileContent provided", () => {
    const result = m.buildSystemPrompt({
      currentFile: "/project/main.luau",
      currentFileContent: "local x = 1"
    })
    expect(result).toContain("local x = 1")
    expect(result).toContain("```lua")
  })

  it("includes docs context when provided", () => {
    const result = m.buildSystemPrompt({ docsContext: "DataStore:SetAsync sets a value." })
    expect(result).toContain("DataStore:SetAsync sets a value.")
  })

  it("includes bridge context when provided", () => {
    const result = m.buildSystemPrompt({ bridgeContext: "Studio is connected" })
    expect(result).toContain("Studio is connected")
  })

  it("includes attached files when provided", () => {
    const result = m.buildSystemPrompt({
      attachedFiles: [{ path: "/project/module.luau", content: "return {}" }]
    })
    expect(result).toContain("/project/module.luau")
    expect(result).toContain("return {}")
  })

  it("truncates large file content at 3000 chars", () => {
    const longContent = "x".repeat(5000)
    const result = m.buildSystemPrompt({
      currentFile: "/project/big.luau",
      currentFileContent: longContent
    })
    // Should contain the first 3000 chars of content
    expect(result).toContain("x".repeat(100))
    // Should not contain the full 5000-char string
    expect(result.length).toBeLessThan(longContent.length + 1000)
  })
})
