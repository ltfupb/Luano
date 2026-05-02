/**
 * tests/pro-modules.test.ts — Free-mode contract tests for electron/pro/modules.ts
 *
 * Goal: Verify that all exports are callable and return the expected shape,
 * and that the free system prompt is well-formed. Catches breakage if
 * someone renames an export, changes its signature, or removes a fallback.
 *
 * Note: In the private repo, Pro modules are loaded. These tests validate the
 * export CONTRACT (types, callability, return shape), not which implementation runs.
 * The free prompt is always tested because it is the fallback function embedded
 * in this file.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

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
import { isTopLevelMiss } from "../electron/pro/modules"

// ── Export shape tests ─────────────────────────────────────────────────────────

describe("pro/modules — all exports are callable", () => {
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
    expect(typeof m.isStudioConnected).toBe("function")
    expect(typeof m.mcpShutdown).toBe("function")
  })

  it("bridge exports are all functions", () => {
    expect(typeof m.startBridgeServer).toBe("function")
    expect(typeof m.setBridgeWindow).toBe("function")
    expect(typeof m.getBridgeTree).toBe("function")
    expect(typeof m.getBridgeLogs).toBe("function")
    expect(typeof m.isBridgeConnected).toBe("function")
    expect(typeof m.clearBridgeLogs).toBe("function")
    expect(typeof m.queueScript).toBe("function")
    expect(typeof m.consumeCommandResult).toBe("function")
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

// ── Free system prompt tests ─────────────────────────────────────────────

describe("free buildSystemPrompt", () => {
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
    // Contract: file content gets sliced at 3000 chars before injection.
    expect(result).toContain("x".repeat(3000))
    expect(result).not.toContain("x".repeat(3001))
  })
})

// ── tryRequire error discrimination ────────────────────────────────────────
//
// These tests verify the core contract of pro/modules.ts's tryRequire:
// swallow MODULE_NOT_FOUND *only* when the top-level module we asked for is
// absent. Any other error — syntax, permission, transitive miss — must
// propagate so a real "forgot to ship a dep" bug surfaces instead of being
// misread as "Free edition, use fallback."
//
// Strategy: we drive tryRequire directly with fabricated error conditions
// by writing a temporary file next to pro/modules.ts that throws the error
// we want, then calling tryRequire with the relative path to that file.
// This exercises the *real* require() flow and the real discrimination
// logic — no mocks of the require itself.

describe("pro/modules — tryRequire error discrimination", () => {
  // Location: a temp folder under the real electron/pro/ directory so the
  // tryRequire's __dirname-based resolution can reach it via "./<name>".
  const proDir = join(process.cwd(), "electron", "pro")
  const tempSubdir = join(proDir, "__test_fixtures__")
  const created: string[] = []

  function makeFixture(name: string, body: string): string {
    if (!existsSync(tempSubdir)) mkdirSync(tempSubdir, { recursive: true })
    const file = join(tempSubdir, `${name}.cjs`)
    writeFileSync(file, body, "utf-8")
    created.push(file)
    return file
  }

  afterEach(() => {
    // Clean up any fixtures created during this test run.
    for (const f of created.splice(0)) {
      try { rmSync(f, { force: true }) } catch { /* noop */ }
    }
    try {
      if (existsSync(tempSubdir)) rmSync(tempSubdir, { recursive: true, force: true })
    } catch { /* noop */ }
  })

  it("swallows top-level MODULE_NOT_FOUND (baseline)", () => {
    // No fixture exists — tryRequire should return null, not throw.
    const result = m.tryRequire("./__test_fixtures__/does_not_exist")
    expect(result).toBeNull()
  })

  it("rethrows a non-MODULE_NOT_FOUND error (EACCES)", () => {
    makeFixture("throws_eacces", `
      const err = new Error("permission denied");
      err.code = "EACCES";
      throw err;
    `)
    expect(() => m.tryRequire("./__test_fixtures__/throws_eacces.cjs")).toThrow(/permission denied|EACCES/)
  })

  it("rethrows a SyntaxError from a Pro file", () => {
    // Write an actually-malformed CJS file so Node raises a real SyntaxError
    // at load time. We use a .cjs extension + genuine syntax garbage so the
    // Node loader — not our transform — produces the throw.
    makeFixture("syntax_error", `this is not valid javascript at all ;;; {{{`)
    expect(() => m.tryRequire("./__test_fixtures__/syntax_error.cjs")).toThrow(SyntaxError)
  })

  it("swallows top-level miss when modules.ts loaded via deep chain (regression: stack.length > 1)", () => {
    // Production load path: main.ts → handlers.ts → ai-handlers.ts → modules.ts.
    // When modules.ts's body runs tryRequire on a missing file, requireStack
    // contains modules.ts at index 0 PLUS the chain that loaded it. The old
    // `stack.length === 1 && stack[0] === __filename` check never matched
    // and the missing module was misclassified as transitive — crashing app
    // boot. The fixed condition is just `stack[0] === __filename`.
    //
    // Direct test: tryRequire(non-existent) issued from this test still
    // resolves stack[0] to modules.ts (the function calling require); we
    // can't easily simulate a deep production stack from a unit test, but
    // the baseline test above + the fixture-based transitive test below
    // together pin the discrimination contract.
    const result = m.tryRequire("./__test_fixtures__/also_does_not_exist")
    expect(result).toBeNull()
  })

  it("rethrows a MODULE_NOT_FOUND caused by a TRANSITIVE dep", () => {
    // The fixture itself loads fine, but IT requires a missing module —
    // that presents as MODULE_NOT_FOUND with a non-empty requireStack whose
    // first entry is the fixture file (not pro/modules.ts). tryRequire must
    // treat it as transitive and rethrow.
    makeFixture("transitive_miss", `
      require("definitely-not-a-real-package-xyz-${Date.now()}");
      module.exports = {};
    `)
    expect(() => m.tryRequire("./__test_fixtures__/transitive_miss.cjs"))
      .toThrow(/Cannot find module/)
  })

  it("logs at error level via log.error when rethrowing", async () => {
    // Use the logger mock set up at the top of this test file.
    const loggerMod = await import("../electron/logger")
    ;(loggerMod.log.error as ReturnType<typeof vi.fn>).mockClear?.()

    makeFixture("log_on_error", `
      const err = new Error("runtime boom");
      err.code = "EACCES";
      throw err;
    `)
    expect(() => m.tryRequire("./__test_fixtures__/log_on_error.cjs")).toThrow()
    expect(loggerMod.log.error).toHaveBeenCalled()
  })
})

// ── isTopLevelMiss pure-function unit tests ────────────────────────────────
//
// These tests construct synthesized MODULE_NOT_FOUND errors with fabricated
// requireStack values that mirror the real production scenarios and assert
// that isTopLevelMiss classifies them correctly. This pins the discrimination
// contract independently of the integration tests above (which can't easily
// control requireStack from the test process).

describe("isTopLevelMiss — pure discrimination logic", () => {
  const currentFile = "/app/electron/pro/modules.js"

  function makeModNotFound(requireStack?: string[]): unknown {
    const err = new Error("Cannot find module 'some-module'") as NodeJS.ErrnoException & {
      requireStack?: string[]
    }
    err.code = "MODULE_NOT_FOUND"
    if (requireStack !== undefined) err.requireStack = requireStack
    return err
  }

  it("returns true when requireStack is absent (old Node fallback)", () => {
    expect(isTopLevelMiss(makeModNotFound(undefined), currentFile)).toBe(true)
  })

  it("returns true when requireStack is empty", () => {
    expect(isTopLevelMiss(makeModNotFound([]), currentFile)).toBe(true)
  })

  it("returns true when requireStack[0] === currentFile (direct top-level call)", () => {
    expect(isTopLevelMiss(makeModNotFound([currentFile]), currentFile)).toBe(true)
  })

  it("returns true when modules.ts is first entry in a deep production chain", () => {
    // Production load: main.ts → handlers.ts → ai-handlers.ts → modules.ts
    const stack = [
      currentFile,
      "/app/electron/ipc/ai-handlers.js",
      "/app/electron/ipc/handlers.js",
      "/app/electron/main.js"
    ]
    expect(isTopLevelMiss(makeModNotFound(stack), currentFile)).toBe(true)
  })

  it("returns false when requireStack[0] is the Pro file (transitive miss)", () => {
    // Pro file (agent.js) loaded fine but then required something missing.
    const stack = [
      "/app/electron/ai/agent.js",
      currentFile,
      "/app/electron/ipc/ai-handlers.js"
    ]
    expect(isTopLevelMiss(makeModNotFound(stack), currentFile)).toBe(false)
  })

  it("returns false for a deeply nested transitive miss (Pro file two levels in)", () => {
    const stack = [
      "/app/electron/analysis/cross-script.js",
      "/app/electron/analysis/helper.js",
      currentFile
    ]
    expect(isTopLevelMiss(makeModNotFound(stack), currentFile)).toBe(false)
  })

  // ── Win32 case-insensitive comparison ──────────────────────────────────────

  describe("win32 case-insensitive path comparison", () => {
    let originalPlatform: string

    beforeEach(() => {
      originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    })

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("returns true when drive letter casing differs (c:\\ vs C:\\)", () => {
      const lower = "c:\\app\\electron\\pro\\modules.js"
      const upper = "C:\\app\\electron\\pro\\modules.js"
      // stack[0] has lowercase drive, currentFile has uppercase — must match
      expect(isTopLevelMiss(makeModNotFound([lower]), upper)).toBe(true)
    })

    it("returns true when stack uses uppercase and currentFile uses lowercase", () => {
      const lower = "c:\\app\\electron\\pro\\modules.js"
      const upper = "C:\\app\\electron\\pro\\modules.js"
      expect(isTopLevelMiss(makeModNotFound([upper]), lower)).toBe(true)
    })

    it("returns false for transitive miss even with different drive letter casing", () => {
      const currentFileLower = "c:\\app\\electron\\pro\\modules.js"
      const agentFile = "C:\\app\\electron\\ai\\agent.js"
      const stack = [agentFile, currentFileLower]
      expect(isTopLevelMiss(makeModNotFound(stack), currentFileLower)).toBe(false)
    })
  })
})
