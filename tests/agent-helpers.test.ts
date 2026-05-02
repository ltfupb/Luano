/**
 * tests/agent-helpers.test.ts — pure-function tests for agent.ts helpers
 *
 * Covers detectStall (state machine) and broadcastRound (IPC wrapper).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => {
  const winSend = vi.fn()
  const win = { webContents: { send: winSend } }
  return { winSend, win }
})

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [h.win] },
  ipcMain: { on: vi.fn(), once: vi.fn(), removeListener: vi.fn() }
}))
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))
vi.mock("../electron/sidecar/index", () => ({ spawnSidecar: vi.fn(), isBinaryAvailable: vi.fn(() => false) }))
vi.mock("../electron/sidecar/selene", () => ({ lintFile: vi.fn() }))
vi.mock("../electron/sidecar/stylua", () => ({ formatFile: vi.fn() }))
vi.mock("../electron/bridge/server", () => ({
  getBridgeTree: vi.fn(), getBridgeLogs: vi.fn(), isBridgeConnected: vi.fn(() => false),
  queueScript: vi.fn(), consumeCommandResult: vi.fn()
}))
vi.mock("../electron/mcp/client", () => ({
  isMcpConnected: vi.fn(async () => false),
  mcpInsertModel: vi.fn(async () => ({ success: false, output: "" }))
}))
vi.mock("../electron/ai/rag", () => ({ searchDocs: vi.fn() }))
vi.mock("../electron/file/sandbox", () => ({ validatePath: vi.fn() }))
vi.mock("../electron/ai/wag", () => ({
  wagExists: vi.fn(() => false), readWagFile: vi.fn(),
  listSiblings: vi.fn(() => []), searchWag: vi.fn(() => []), rebuildWagIndex: vi.fn()
}))
vi.mock("../electron/ai/provider", () => ({
  getProvider: vi.fn().mockReturnValue("anthropic"),
  getModel: vi.fn().mockReturnValue("claude-sonnet-4-6"),
  getModelTier: vi.fn().mockReturnValue("frontier"),
  getAnthropicClient: vi.fn(), getOpenAIClient: vi.fn(),
  getAnthropicPath: vi.fn(),
  isAdvisorAvailable: vi.fn().mockReturnValue(false),
  getAdvisorModel: vi.fn().mockReturnValue("claude-opus-4-6"),
  _setActiveAbortController: vi.fn(),
  toCachedSystem: vi.fn().mockImplementation((s: unknown) => s),
  toCachedTools: vi.fn().mockImplementation((t: unknown) => t),
  chat: vi.fn(),
  StreamBlockTracker: class { onStart() {} onStop() {} }
}))

import {
  detectStall, broadcastRound, STALL_THRESHOLD,
  estimateTokens, microCompact,
  appendWagReminder, WAG_VALUE_PATTERN,
  getToolsForExecution, studioAvailable,
  redactSecrets,
  reconcileHistoryAfterError
} from "../electron/ai/agent"
import { wagExists } from "../electron/ai/wag"
import { isBridgeConnected } from "../electron/bridge/server"
import { isMcpConnected } from "../electron/mcp/client"

beforeEach(() => { vi.clearAllMocks() })

describe("detectStall", () => {
  it("resets counter and returns no-nudge when a write tool is used", () => {
    const state = { executeRoundsWithoutWrite: 5 }
    const result = detectStall(["Read", "Write"], state)
    expect(result).toEqual({ nudge: false })
    expect(state.executeRoundsWithoutWrite).toBe(0)
  })

  it(`increments counter without nudge for the first ${STALL_THRESHOLD - 1} read-only rounds`, () => {
    const state = { executeRoundsWithoutWrite: 0 }
    for (let i = 0; i < STALL_THRESHOLD - 1; i++) {
      const result = detectStall(["Read"], state)
      expect(result.nudge).toBe(false)
    }
    expect(state.executeRoundsWithoutWrite).toBe(STALL_THRESHOLD - 1)
  })

  it("nudges on the STALL_THRESHOLD-th consecutive read-only round", () => {
    const state = { executeRoundsWithoutWrite: STALL_THRESHOLD - 1 }
    const result = detectStall(["Read"], state)
    expect(result.nudge).toBe(true)
    if (result.nudge) expect(result.text).toMatch(/many rounds reading without writing/i)
    expect(state.executeRoundsWithoutWrite).toBe(0) // reset after nudge
  })

  it("treats empty tool rounds as non-write and accumulates", () => {
    const state = { executeRoundsWithoutWrite: STALL_THRESHOLD - 1 }
    const result = detectStall([], state)
    expect(result.nudge).toBe(true)
  })
})

describe("broadcastRound", () => {
  it("sends round payload to all windows on :round channel", () => {
    broadcastRound("ai:agent:abc", 3, 100)
    expect(h.winSend).toHaveBeenCalledWith("ai:agent:abc:round", { round: 3, max: 100 })
  })
})

describe("estimateTokens (CJK-aware)", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0)
  })

  it("produces fewer tokens for pure ASCII than pure Hangul of same length", () => {
    const ascii = "a".repeat(100)
    const hangul = "가".repeat(100)
    expect(estimateTokens(hangul)).toBeGreaterThan(estimateTokens(ascii))
  })

  it("counts Hiragana/Katakana in the CJK bucket", () => {
    const hira = estimateTokens("あいうえお".repeat(20))   // 100 chars
    const ascii = estimateTokens("a".repeat(100))
    expect(hira).toBeGreaterThan(ascii)
  })

  it("handles mixed Korean + English proportionally", () => {
    const mixed = estimateTokens("안녕 hello 세계")
    const pureAscii = estimateTokens("hi hello world xx")
    // Mixed content ballpark greater than a pure-ASCII string of similar char count
    expect(mixed).toBeGreaterThan(0)
    expect(pureAscii).toBeGreaterThan(0)
  })
})

describe("microCompact", () => {
  it("returns output unchanged when below threshold", () => {
    const small = "hello world"
    expect(microCompact("Read", small)).toBe(small)
  })

  it("Read output passes through unchanged regardless of size — Read tool itself caps at 2000 lines", () => {
    // Claude Code style: agent does NOT compact Read at all. The Read tool
    // already truncates >2000 line files at the source with an explicit hint
    // to the model. Agent-level head/mid/tail sampling created synthetic
    // views that triggered repeated re-reads.
    const small = Array.from({ length: 80 }, (_, i) => `line ${i} ${"x".repeat(50)}`).join("\n")
    expect(microCompact("Read", small)).toBe(small)

    const big = Array.from({ length: 500 }, (_, i) => `line ${i} ${"x".repeat(50)}`).join("\n")
    expect(microCompact("Read", big)).toBe(big)
  })

  it("caps grep output at 20 lines with narrow-hint", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `match ${i} ${"x".repeat(40)}`).join("\n")
    const out = microCompact("Grep", lines)
    expect(out).toContain("narrow the regex")
    // First 20 kept
    expect(out.split("\n")).toHaveLength(21) // 20 + 1 summary
  })

  it("caps list_files at 30 entries", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `file${i}.lua  ${"x".repeat(30)}`).join("\n")
    const out = microCompact("Glob", lines)
    expect(out).toContain("more entries")
  })
})

describe("appendWagReminder", () => {
  const projectRoot = "/tmp/proj"
  const luaPath = "/tmp/proj/src/foo.lua"

  beforeEach(() => {
    vi.mocked(wagExists).mockReturnValue(true)
  })

  it("appends reminder when tool input contains a tunable keyword (damage)", () => {
    const out = appendWagReminder("File updated", "Edit", luaPath, projectRoot, { content: "local damage = 10" })
    expect(out).toContain("[WAG]")
  })

  it("does NOT append for pure refactor with no tunable keywords", () => {
    const out = appendWagReminder("File updated", "Edit", luaPath, projectRoot, { content: "local function sayHi() return 'hi' end" })
    expect(out).not.toContain("[WAG]")
  })

  it("case-insensitive keyword match (HP)", () => {
    const out = appendWagReminder("ok", "Edit", luaPath, projectRoot, { new_string: "self.HP = 100" })
    expect(out).toContain("[WAG]")
  })

  it("skips when file is in wag/ directory", () => {
    const out = appendWagReminder("ok", "Edit", "/tmp/proj/wag/monster.md", projectRoot, { content: "damage: 10" })
    expect(out).not.toContain("[WAG]")
  })

  it("skips when file is not a .lua/.luau file", () => {
    const out = appendWagReminder("ok", "Edit", "/tmp/proj/README.md", projectRoot, { content: "local damage = 10" })
    expect(out).not.toContain("[WAG]")
  })

  it("skips when wagExists is false (no wag/ dir in project)", () => {
    vi.mocked(wagExists).mockReturnValueOnce(false)
    const out = appendWagReminder("ok", "Edit", luaPath, projectRoot, { content: "local damage = 10" })
    expect(out).not.toContain("[WAG]")
  })

  it("skips delete_file even if file is .lua", () => {
    const out = appendWagReminder("ok", "Delete", luaPath, projectRoot, { content: "hp = 10" })
    expect(out).not.toContain("[WAG]")
  })

  it("WAG_VALUE_PATTERN uses word boundaries — does not match inside 'damageless'", () => {
    expect(WAG_VALUE_PATTERN.test("damageless")).toBe(false)
    expect(WAG_VALUE_PATTERN.test("sheepdog")).toBe(false)
    expect(WAG_VALUE_PATTERN.test("damage")).toBe(true)
    expect(WAG_VALUE_PATTERN.test("max damage 10")).toBe(true)
  })
})

describe("getToolsForExecution (STUDIO filter)", () => {
  it("includes Studio tools when studioConnected is true", () => {
    const names = getToolsForExecution({ studioConnected: true }).map((t) => t.name)
    expect(names).toContain("ReadInstanceTree")
    expect(names).toContain("RunScript")
  })

  it("excludes Studio tools when studioConnected is false", () => {
    const names = getToolsForExecution({ studioConnected: false }).map((t) => t.name)
    expect(names).not.toContain("ReadInstanceTree")
    expect(names).not.toContain("RuntimeLogs")
    expect(names).not.toContain("RunScript")
    expect(names).not.toContain("SetProperty")
    expect(names).not.toContain("InsertModel")
  })

  it("keeps non-Studio tools regardless of studioConnected", () => {
    const offNames = getToolsForExecution({ studioConnected: false }).map((t) => t.name)
    expect(offNames).toContain("Read")
    expect(offNames).toContain("Write")
    expect(offNames).toContain("Edit")
  })

  it("excludeExploration removes list_files/grep/read_instance_tree/get_runtime_logs", () => {
    const names = getToolsForExecution({ excludeExploration: true, studioConnected: true }).map((t) => t.name)
    expect(names).not.toContain("Glob")
    expect(names).not.toContain("Grep")
    expect(names).not.toContain("ReadInstanceTree")
    expect(names).not.toContain("RuntimeLogs")
  })

  it("defaults include everything when no opts provided", () => {
    const names = getToolsForExecution().map((t) => t.name)
    expect(names).toContain("ReadInstanceTree")
    expect(names).toContain("Glob")
  })
})

describe("getToolsForExecution (PLAN MODE filter)", () => {
  it("strips every write/mutate tool in plan mode", () => {
    const names = getToolsForExecution({ planMode: true }).map((t) => t.name)
    expect(names).not.toContain("Write")
    expect(names).not.toContain("Edit")
    expect(names).not.toContain("MultiEdit")
    expect(names).not.toContain("Patch")
    expect(names).not.toContain("Delete")
    expect(names).not.toContain("RunScript")
    expect(names).not.toContain("SetProperty")
    expect(names).not.toContain("InsertModel")
  })

  it("keeps read-only tools in plan mode", () => {
    const names = getToolsForExecution({ planMode: true }).map((t) => t.name)
    expect(names).toContain("Read")
    expect(names).toContain("Glob")
    expect(names).toContain("Grep")
    expect(names).toContain("TodoWrite")
  })

  it("plan mode strips tools even when studio is connected", () => {
    const names = getToolsForExecution({ planMode: true, studioConnected: true }).map((t) => t.name)
    expect(names).toContain("ReadInstanceTree")
    expect(names).toContain("RuntimeLogs")
    expect(names).not.toContain("RunScript")
    expect(names).not.toContain("SetProperty")
  })
})

describe("redactSecrets", () => {
  it("returns empty/undefined input untouched", () => {
    expect(redactSecrets("")).toBe("")
  })

  it("redacts a Bearer token (≥16 chars) while keeping surrounding text", () => {
    // Token must be at least 16 chars to be redacted (minimum-length floor).
    const out = redactSecrets("Authorization header was Bearer abcdefghij123456")
    expect(out).toContain("Bearer [REDACTED]")
    expect(out).not.toContain("abcdefghij123456")
  })

  it("does NOT redact a short Bearer fragment (< 16 chars)", () => {
    // A 5-char fragment after 'Bearer ' is not a real token — must not be redacted.
    const out = redactSecrets("Bearer abcde")
    expect(out).toBe("Bearer abcde")
  })

  it("redacts an Authorization: header value", () => {
    const out = redactSecrets("Authorization: secret-token-here")
    expect(out).toContain("Authorization: [REDACTED]")
    expect(out).not.toContain("secret-token-here")
  })

  it("redacts api-key / x-api-key style headers", () => {
    expect(redactSecrets("api-key: aaa-bbb-ccc")).toContain("api-key: [REDACTED]")
    expect(redactSecrets("x-api-key: zzz-yyy")).toContain("api-key: [REDACTED]")
  })

  it("redacts Anthropic / OpenAI sk- keys", () => {
    const out = redactSecrets("My key is sk-ant-1234567890abcdef and another is sk-proj-abcdef0123456789")
    expect(out).toContain("sk-[REDACTED]")
    expect(out).not.toMatch(/sk-ant-\w+/)
    expect(out).not.toMatch(/sk-proj-\w+/)
  })

  it("redacts JSON-style \"access_token\" / \"refresh_token\" values", () => {
    const out = redactSecrets('{"access_token":"abc123def","other":"keep"}')
    expect(out).toContain('"access_token":"[REDACTED]"')
    expect(out).toContain('"other":"keep"')
  })

  it("does not mangle benign log lines", () => {
    const benign = "Player joined: name=Bob, score=42"
    expect(redactSecrets(benign)).toBe(benign)
  })
})

describe("studioAvailable", () => {
  it("returns true when bridge is connected", async () => {
    vi.mocked(isBridgeConnected).mockReturnValueOnce(true)
    await expect(studioAvailable()).resolves.toBe(true)
  })

  it("falls back to MCP check when bridge disconnected", async () => {
    vi.mocked(isBridgeConnected).mockReturnValueOnce(false)
    vi.mocked(isMcpConnected).mockResolvedValueOnce(true)
    await expect(studioAvailable()).resolves.toBe(true)
  })

  it("returns false when both bridge and MCP are unavailable", async () => {
    vi.mocked(isBridgeConnected).mockReturnValueOnce(false)
    vi.mocked(isMcpConnected).mockResolvedValueOnce(false)
    await expect(studioAvailable()).resolves.toBe(false)
  })

  it("swallows MCP errors and returns false", async () => {
    vi.mocked(isBridgeConnected).mockReturnValueOnce(false)
    vi.mocked(isMcpConnected).mockRejectedValueOnce(new Error("ECONNREFUSED"))
    await expect(studioAvailable()).resolves.toBe(false)
  })
})

// H11 — reconcileHistoryAfterError. When the Anthropic API call throws after
// streaming a tool_use block (ECONNRESET, premature close, etc), the last
// assistant turn carries an orphan tool_use with no matching tool_result.
// The next API retry would 400 with "tool_use without matching tool_result".
// reconcileHistoryAfterError pops the orphaned assistant turn so the loop can
// re-issue cleanly.
describe("reconcileHistoryAfterError", () => {
  type MsgParam = Parameters<typeof reconcileHistoryAfterError>[0][number]

  it("pops a tail assistant turn that contains a tool_use block", () => {
    const history: MsgParam[] = [
      { role: "user", content: "do the thing" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Sure — " },
          { type: "tool_use", id: "toolu_orphan", name: "Read", input: { path: "/x" } }
        ] as MsgParam["content"]
      }
    ]
    reconcileHistoryAfterError(history)
    expect(history).toHaveLength(1)
    expect(history[0].role).toBe("user")
  })

  it("leaves history alone when the last assistant turn has no tool_use", () => {
    const history: MsgParam[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hello" }] as MsgParam["content"] }
    ]
    reconcileHistoryAfterError(history)
    expect(history).toHaveLength(2)
  })

  it("leaves history alone when the last turn is not assistant (already reconciled)", () => {
    const history: MsgParam[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_a", name: "Read", input: {} }] as MsgParam["content"]
      },
      // tool_result already on history — last turn is user (synthesized result)
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_a", content: "ok" }] as MsgParam["content"] }
    ]
    reconcileHistoryAfterError(history)
    expect(history).toHaveLength(3)
  })

  it("is a no-op on empty history (defensive)", () => {
    const history: MsgParam[] = []
    expect(() => reconcileHistoryAfterError(history)).not.toThrow()
    expect(history).toHaveLength(0)
  })

  it("preserves history when assistant content is a plain string (no tool_use possible)", () => {
    const history: MsgParam[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "no tools here" }
    ]
    reconcileHistoryAfterError(history)
    expect(history).toHaveLength(2)
  })
})
