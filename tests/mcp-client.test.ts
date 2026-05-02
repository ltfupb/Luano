/**
 * tests/mcp-client.test.ts — Studio MCP stdio client (electron/mcp/client.ts)
 *
 * Covers the parts the existing test suite leaves unverified — every other test
 * mocks this module wholesale, so the real stdio framing, JSON-RPC dispatch,
 * and lifecycle teardown have no direct coverage.
 *
 * Strategy:
 *   - Mock electron, fs, child_process, sidecar, logger
 *   - Override process.platform per platform test
 *   - Drive the module by feeding fake stdout chunks and asserting on stdin
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "events"
import { Readable, Writable } from "stream"

// ── Hoisted state ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const fakeExists = vi.fn((_p: string) => true)
  const fakeSpawn = vi.fn()
  return { fakeExists, fakeSpawn }
})

vi.mock("electron", () => ({
  app: { getVersion: () => "1.2.3-test" }
}))

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs")
  return { ...actual, existsSync: h.fakeExists }
})

vi.mock("child_process", () => ({
  spawn: h.fakeSpawn
}))

vi.mock("../electron/sidecar/index", () => ({
  buildSidecarEnv: () => ({ PATH: "/usr/bin", LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" })
}))

vi.mock("../electron/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// ── Fake child process ────────────────────────────────────────────────────────

interface FakeChild extends EventEmitter {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  killed: boolean
  kill: () => void
  __stdinChunks: string[]
  __pushStdout: (json: unknown) => void
  __exit: (code: number) => void
}

function makeFakeChild(): FakeChild {
  const proc = new EventEmitter() as FakeChild
  proc.__stdinChunks = []

  proc.stdin = new Writable({
    write(chunk, _enc, cb) {
      proc.__stdinChunks.push(chunk.toString("utf-8"))
      cb()
    }
  })
  proc.stdout = new Readable({ read() { /* no-op */ } })
  proc.stderr = new Readable({ read() { /* no-op */ } })
  proc.killed = false
  proc.kill = vi.fn(() => { proc.killed = true })

  proc.__pushStdout = (json: unknown): void => {
    // Emit "data" synchronously so the test can drive request/response order
    // without depending on stream microtask timing.
    proc.stdout.emit("data", Buffer.from(JSON.stringify(json) + "\n"))
  }
  proc.__exit = (code: number): void => {
    proc.killed = true
    proc.emit("exit", code)
  }

  return proc
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORIGINAL_PLATFORM = process.platform

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true })
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  h.fakeExists.mockReturnValue(true)
  h.fakeSpawn.mockReset()
  process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local"
})

afterEach(async () => {
  // Clear module-level state so the next test gets a fresh client.
  // mcpShutdown() teardown is the public way to reset _proc, _initialized,
  // _pending, _connectedCache.
  try {
    const mod = await import("../electron/mcp/client")
    mod.mcpShutdown()
  } catch { /* module may not have loaded */ }
  setPlatform(ORIGINAL_PLATFORM)
})

// ── resolveStudioMcpCommand (via isMcpConnected) ──────────────────────────────

describe("resolveStudioMcpCommand", () => {
  it("returns false on Linux (Studio unsupported)", async () => {
    setPlatform("linux")
    const { isMcpConnected } = await import("../electron/mcp/client")
    expect(await isMcpConnected()).toBe(false)
    expect(h.fakeSpawn).not.toHaveBeenCalled()
  })

  it("returns false on win32 when mcp.bat is missing", async () => {
    setPlatform("win32")
    h.fakeExists.mockReturnValue(false)
    const { isMcpConnected } = await import("../electron/mcp/client")
    expect(await isMcpConnected()).toBe(false)
    expect(h.fakeSpawn).not.toHaveBeenCalled()
  })

  it("returns false on win32 when LOCALAPPDATA is unset", async () => {
    setPlatform("win32")
    delete process.env.LOCALAPPDATA
    const { isMcpConnected } = await import("../electron/mcp/client")
    expect(await isMcpConnected()).toBe(false)
    expect(h.fakeSpawn).not.toHaveBeenCalled()
  })

  it("spawns cmd.exe with the .bat path on win32", async () => {
    setPlatform("win32")
    h.fakeExists.mockReturnValue(true)
    const child = makeFakeChild()
    h.fakeSpawn.mockReturnValue(child)
    const { isMcpConnected } = await import("../electron/mcp/client")

    // Resolve initialize with a successful response so isMcpConnected returns true.
    const p = isMcpConnected()
    await Promise.resolve()
    child.__pushStdout({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } })

    expect(await p).toBe(true)
    expect(h.fakeSpawn).toHaveBeenCalledTimes(1)
    const [cmd, args] = h.fakeSpawn.mock.calls[0]
    expect(cmd).toBe("cmd.exe")
    expect(args).toEqual(["/c", expect.stringContaining("Roblox")])
  })

  it("spawns the StudioMCP binary on darwin", async () => {
    setPlatform("darwin")
    h.fakeExists.mockReturnValue(true)
    const child = makeFakeChild()
    h.fakeSpawn.mockReturnValue(child)
    const { isMcpConnected } = await import("../electron/mcp/client")

    const p = isMcpConnected()
    await Promise.resolve()
    child.__pushStdout({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } })

    expect(await p).toBe(true)
    const [cmd, args] = h.fakeSpawn.mock.calls[0]
    expect(cmd).toBe("/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP")
    expect(args).toEqual([])
  })
})

// ── Connectivity cache invalidation ───────────────────────────────────────────

describe("isMcpConnected cache (Studio restart)", () => {
  it("invalidates the cache when the child exits, so a stale 'connected=true' doesn't outlive Studio", async () => {
    setPlatform("darwin")
    const child = makeFakeChild()
    h.fakeSpawn.mockReturnValue(child)
    const { isMcpConnected } = await import("../electron/mcp/client")

    // Initial connect.
    const p = isMcpConnected()
    await Promise.resolve()
    child.__pushStdout({ jsonrpc: "2.0", id: 1, result: {} })
    expect(await p).toBe(true)

    // Studio dies — the proc.exit handler runs teardown(), which must clear
    // the connectivity cache. Without this, the 30s TTL keeps reporting
    // "connected" while the studioContext block lies to the agent.
    child.__exit(0)

    // Next call must NOT be served from the stale cache.
    // Make the next spawn produce a fresh child that succeeds.
    const child2 = makeFakeChild()
    h.fakeSpawn.mockReturnValueOnce(child2)
    const p2 = isMcpConnected()
    await Promise.resolve()
    // If cache wasn't invalidated, no second spawn — the existing cache value
    // would short-circuit. Asserting two spawns proves the cache was cleared.
    expect(h.fakeSpawn).toHaveBeenCalledTimes(2)
    // _reqId is module-level and not reset by teardown — the second
    // initialize request is id=2.
    child2.__pushStdout({ jsonrpc: "2.0", id: 2, result: {} })
    expect(await p2).toBe(true)
  })
})

// ── Spawn env policy ──────────────────────────────────────────────────────────

describe("spawn env (H2 — no API key leak)", () => {
  it("uses buildSidecarEnv() instead of process.env", async () => {
    setPlatform("darwin")
    const child = makeFakeChild()
    h.fakeSpawn.mockReturnValue(child)
    const { isMcpConnected } = await import("../electron/mcp/client")

    const p = isMcpConnected()
    await Promise.resolve()
    child.__pushStdout({ jsonrpc: "2.0", id: 1, result: {} })
    await p

    const opts = h.fakeSpawn.mock.calls[0][2]
    expect(opts.env).toEqual({ PATH: "/usr/bin", LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" })
    expect(opts.env).not.toHaveProperty("ANTHROPIC_API_KEY")
  })
})

// ── Initialize handshake ──────────────────────────────────────────────────────

describe("initialize handshake", () => {
  it("sends initialize then notifications/initialized", async () => {
    setPlatform("darwin")
    const child = makeFakeChild()
    h.fakeSpawn.mockReturnValue(child)
    const { isMcpConnected } = await import("../electron/mcp/client")

    const p = isMcpConnected()
    await Promise.resolve()
    child.__pushStdout({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } })
    await p

    // First write: initialize. Second write: notifications/initialized.
    expect(child.__stdinChunks.length).toBeGreaterThanOrEqual(2)
    const init = JSON.parse(child.__stdinChunks[0].trim())
    expect(init.method).toBe("initialize")
    expect(init.params.clientInfo).toEqual({ name: "Luano", version: "1.2.3-test" })
    const note = JSON.parse(child.__stdinChunks[1].trim())
    expect(note.method).toBe("notifications/initialized")
    expect(note).not.toHaveProperty("id")  // notification, no id
  })

  it("returns false when initialize errors", async () => {
    setPlatform("darwin")
    const child = makeFakeChild()
    h.fakeSpawn.mockReturnValue(child)
    const { isMcpConnected } = await import("../electron/mcp/client")

    const p = isMcpConnected()
    await Promise.resolve()
    child.__pushStdout({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Invalid Request" } })

    expect(await p).toBe(false)
  })
})

// ── Caching ───────────────────────────────────────────────────────────────────

describe("isMcpConnected cache", () => {
  it("does not spawn twice within the cache TTL", async () => {
    setPlatform("linux")  // no spawn at all on linux — easiest cache check
    const { isMcpConnected } = await import("../electron/mcp/client")
    await isMcpConnected()
    await isMcpConnected()
    await isMcpConnected()
    expect(h.fakeSpawn).not.toHaveBeenCalled()
  })
})

// ── Tool calls ────────────────────────────────────────────────────────────────

describe("mcpInsertModel", () => {
  it("calls insert_from_creator_store (not the deprecated InsertModel)", async () => {
    setPlatform("darwin")
    const child = makeFakeChild()
    h.fakeSpawn.mockReturnValue(child)
    const { mcpInsertModel } = await import("../electron/mcp/client")

    const p = mcpInsertModel("Tree", "Workspace")
    await Promise.resolve()
    child.__pushStdout({ jsonrpc: "2.0", id: 1, result: {} })
    await Promise.resolve()
    await Promise.resolve()
    child.__pushStdout({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: "ok" }] }
    })

    await p

    const toolCall = JSON.parse(child.__stdinChunks[2].trim())
    expect(toolCall.params.name).toBe("insert_from_creator_store")
    expect(toolCall.params.arguments).toEqual({ query: "Tree", parent: "Workspace" })
  })
})

// ── Stdout framing ────────────────────────────────────────────────────────────

describe("stdout line framing", () => {
  it("dispatches messages by request id (out-of-order responses are fine)", async () => {
    setPlatform("darwin")
    const child = makeFakeChild()
    h.fakeSpawn.mockReturnValue(child)
    const { isMcpConnected, mcpInsertModel } = await import("../electron/mcp/client")

    // Initialize first
    const initP = isMcpConnected()
    await Promise.resolve()
    child.__pushStdout({ jsonrpc: "2.0", id: 1, result: {} })
    await initP

    // Issue two parallel calls — they get ids 2 and 3 in order
    const a = mcpInsertModel("a")
    const b = mcpInsertModel("b")
    await Promise.resolve()
    await Promise.resolve()

    // Respond to id 3 first, then id 2 — out of order
    child.__pushStdout({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "B" }] } })
    child.__pushStdout({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "A" }] } })

    expect((await a)?.output).toBe("A")
    expect((await b)?.output).toBe("B")
  })

  it("buffers partial chunks until a newline arrives", async () => {
    setPlatform("darwin")
    const child = makeFakeChild()
    h.fakeSpawn.mockReturnValue(child)
    const { isMcpConnected } = await import("../electron/mcp/client")

    const p = isMcpConnected()
    await Promise.resolve()

    // Emit the response in two halves; only the second one completes a line.
    const json = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })
    child.stdout.emit("data", Buffer.from(json.slice(0, 20)))  // partial
    await Promise.resolve()
    child.stdout.emit("data", Buffer.from(json.slice(20) + "\n"))

    expect(await p).toBe(true)
  })
})

// ── Teardown ──────────────────────────────────────────────────────────────────

describe("mcpShutdown / teardown", () => {
  it("ends stdin and kills the child", async () => {
    setPlatform("darwin")
    const child = makeFakeChild()
    h.fakeSpawn.mockReturnValue(child)
    const { isMcpConnected, mcpShutdown } = await import("../electron/mcp/client")

    const p = isMcpConnected()
    await Promise.resolve()
    child.__pushStdout({ jsonrpc: "2.0", id: 1, result: {} })
    await p

    const stdinEnd = vi.spyOn(child.stdin, "end")
    mcpShutdown()

    expect(stdinEnd).toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalled()
  })

  it("rejects pending requests when the child exits unexpectedly", async () => {
    setPlatform("darwin")
    const child = makeFakeChild()
    h.fakeSpawn.mockReturnValue(child)
    const { isMcpConnected, mcpInsertModel } = await import("../electron/mcp/client")

    // Complete init so we have an initialized session
    const initP = isMcpConnected()
    await Promise.resolve()
    child.__pushStdout({ jsonrpc: "2.0", id: 1, result: {} })
    await initP

    // Issue a tool call; before responding, kill the child
    const callP = mcpInsertModel("Tree")
    await Promise.resolve()
    await Promise.resolve()
    child.__exit(1)

    // The pending tools/call should resolve (not hang) — null means "MCP failed".
    const result = await callP
    expect(result).toBeNull()
  })

  it("is idempotent — calling mcpShutdown twice does not throw", async () => {
    setPlatform("linux")
    const { mcpShutdown } = await import("../electron/mcp/client")
    expect(() => { mcpShutdown(); mcpShutdown() }).not.toThrow()
  })
})
