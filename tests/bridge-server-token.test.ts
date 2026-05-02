/**
 * tests/bridge-server-token.test.ts — bridge server token handling + result FIFO
 *
 * Covers:
 *   - Valid existing token file → reused, no regeneration, no IPC
 *   - Corrupt token file → fresh token generated AND bridge:token-invalidated
 *     fires to all windows (token itself is NOT broadcast — explicit Pro gate)
 *   - Command result FIFO: pushing past COMMAND_RESULTS_CAP (100) evicts the
 *     oldest entry first
 *   - /api/result id allowlist: rejects results for ids never issued
 *   - /api/result size cap: rejects per-result payloads > MAX_RESULT_BYTES
 *   - queueScript pending-queue cap: throws past MAX_PENDING_COMMANDS
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const h = vi.hoisted(() => {
  const winSend = vi.fn()
  const win = {
    webContents: { send: winSend },
    isDestroyed: () => false,
  }
  // Single HTTP "server" reused across tests — we capture the request handler
  // on first createServer call to drive the /api/result endpoint directly.
  let requestHandler: ((req: unknown, res: unknown) => Promise<void> | void) | null = null
  const mockListen = vi.fn((_port: number, _host: string, cb?: () => void) => { if (cb) cb() })
  const mockClose = vi.fn()
  const mockOnError = vi.fn()
  const mockCreateServer = vi.fn((handler: (req: unknown, res: unknown) => unknown) => {
    requestHandler = handler as typeof requestHandler
    return { listen: mockListen, close: mockClose, on: mockOnError }
  })

  // fs stubs — overridden per test
  const mockExistsSync = vi.fn().mockReturnValue(false)
  const mockReadFileSync = vi.fn()
  const mockWriteFileSync = vi.fn()

  return {
    winSend, win, mockListen, mockClose, mockCreateServer, mockOnError,
    mockExistsSync, mockReadFileSync, mockWriteFileSync,
    getRequestHandler: () => requestHandler,
  }
})

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  BrowserWindow: { getAllWindows: () => [h.win] },
}))

vi.mock("http", () => ({ createServer: h.mockCreateServer }))

vi.mock("fs", () => ({
  existsSync: h.mockExistsSync,
  readFileSync: h.mockReadFileSync,
  writeFileSync: h.mockWriteFileSync,
}))

vi.mock("../electron/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Import AFTER mocks so module pulls in the mocked deps.
import {
  startBridgeServer, stopBridgeServer, getBridgeToken, consumeCommandResult,
  queueScript,
} from "../electron/bridge/server"

/** Drive /api/result directly so we can push results past the cap. */
async function postResult(id: string, success = true, result = "ok"): Promise<void> {
  await postResultCapturing(id, success, result)
}

/** Same as postResult but returns the captured response so tests can assert
 *  statusCode for the allowlist / size-cap rejections. */
async function postResultCapturing(
  id: string,
  success = true,
  result = "ok"
): Promise<{ res: { statusCode: number; end: ReturnType<typeof vi.fn> } }> {
  const handler = h.getRequestHandler()
  if (!handler) throw new Error("no request handler — did you call startBridgeServer?")

  type DataCb = (chunk: Buffer) => void
  type EndCb = () => void
  const listeners: Record<string, Array<DataCb | EndCb>> = {}
  const body = JSON.stringify({ id, success, result })
  const req = {
    url: "/api/result",
    method: "POST",
    headers: { "x-luano-token": getBridgeToken() },
    on(event: string, fn: DataCb | EndCb) {
      (listeners[event] ??= []).push(fn)
      return this
    },
    destroy: vi.fn(),
  }
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  }
  const done = handler(req, res)
  const chunk = Buffer.from(body)
  ;(listeners["data"] ?? []).forEach((fn) => (fn as DataCb)(chunk))
  ;(listeners["end"] ?? []).forEach((fn) => (fn as EndCb)())
  await done
  return { res }
}

/** Drive /api/report to drain state.pendingCommands (Studio plugin poll). */
async function drainPending(): Promise<void> {
  const handler = h.getRequestHandler()
  if (!handler) throw new Error("no request handler — did you call startBridgeServer?")

  type DataCb = (chunk: Buffer) => void
  type EndCb = () => void
  const listeners: Record<string, Array<DataCb | EndCb>> = {}
  const body = JSON.stringify({ tree: null, logs: [] })
  const req = {
    url: "/api/report",
    method: "POST",
    headers: { "x-luano-token": getBridgeToken() },
    on(event: string, fn: DataCb | EndCb) {
      (listeners[event] ??= []).push(fn)
      return this
    },
    destroy: vi.fn(),
  }
  const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() }
  const done = handler(req, res)
  const chunk = Buffer.from(body)
  ;(listeners["data"] ?? []).forEach((fn) => (fn as DataCb)(chunk))
  ;(listeners["end"] ?? []).forEach((fn) => (fn as EndCb)())
  await done
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  h.mockExistsSync.mockReturnValue(false)
})

afterEach(() => {
  stopBridgeServer()
  vi.useRealTimers()
})

describe("bridge token persistence", () => {
  it("reuses a valid existing token file (no IPC invalidation)", async () => {
    const validToken = "a".repeat(32) // 32 hex chars
    h.mockExistsSync.mockReturnValue(true)
    h.mockReadFileSync.mockReturnValue(validToken)

    startBridgeServer(27780)
    // setImmediate for the invalidated event would fire after this flush
    await vi.advanceTimersByTimeAsync(0)

    expect(getBridgeToken()).toBe(validToken)
    expect(h.mockWriteFileSync).not.toHaveBeenCalled()
    expect(h.winSend).not.toHaveBeenCalledWith("bridge:token-invalidated")
  })

  it("regenerates when token file is corrupt and emits bridge:token-invalidated", async () => {
    // existsSync=true but content doesn't match /^[0-9a-f]{32}$/
    h.mockExistsSync.mockReturnValue(true)
    h.mockReadFileSync.mockReturnValue("not-a-valid-token")

    startBridgeServer(27780)
    // setImmediate queue drains on next microtask flush
    await vi.advanceTimersByTimeAsync(0)
    // vi.useFakeTimers() also controls setImmediate in newer vitest; explicit
    // flush via runOnlyPendingTimers for safety.
    vi.runOnlyPendingTimers()

    // Fresh token written to disk
    expect(h.mockWriteFileSync).toHaveBeenCalledTimes(1)
    const writtenToken = h.mockWriteFileSync.mock.calls[0][1] as string
    expect(writtenToken).toMatch(/^[0-9a-f]{32}$/)
    expect(getBridgeToken()).toBe(writtenToken)

    // IPC fires on setImmediate — flush and then assert
    await vi.advanceTimersByTimeAsync(0)
    vi.runOnlyPendingTimers()

    // bridge:token-invalidated was sent; the token itself MUST NOT be in
    // the payload (explicit comment: only emit a notice, not the token).
    const invalidatedCalls = h.winSend.mock.calls.filter((c) =>
      c[0] === "bridge:token-invalidated"
    )
    expect(invalidatedCalls.length).toBeGreaterThan(0)
    // No payload (server.ts sends the channel with no data)
    expect(invalidatedCalls[0].length).toBe(1)
  })
})

describe("command result FIFO cap", () => {
  it("evicts oldest result when 101st is pushed past the 100-entry cap", async () => {
    startBridgeServer(27780)
    // Flush any startup setImmediate
    await vi.advanceTimersByTimeAsync(0)

    // Queue 101 scripts first so their ids are in the outstandingIds allowlist
    // (post-fix: /api/result rejects any id that wasn't queued). MAX_PENDING_COMMANDS
    // is 50, so drain the queue via /api/report between bursts to keep queue
    // space available while still holding the ids as outstanding.
    const ids: string[] = []
    for (let i = 0; i < 101; i++) {
      ids.push(queueScript(`print('${i}')`))
      // Every 40 scripts, drain pendingCommands via an /api/report call
      // (which pops all pending). queueScript's cap is on pendingCommands
      // length, not outstandingIds size.
      if ((i + 1) % 40 === 0) await drainPending()
    }

    // Push a result for each outstanding id.
    for (let i = 0; i < 101; i++) {
      await postResult(ids[i], true, `r${i}`)
    }

    // Oldest id (ids[0]) should be evicted; ids[1] should be the new oldest
    // and still present. consumeCommandResult returns null after eviction.
    expect(consumeCommandResult(ids[0])).toBeNull()
    const survived = consumeCommandResult(ids[1])
    expect(survived).toMatchObject({ id: ids[1], success: true, result: "r1" })
    const latest = consumeCommandResult(ids[100])
    expect(latest).toMatchObject({ id: ids[100], success: true, result: "r100" })
  })
})

describe("/api/result id allowlist (forged-id rejection)", () => {
  it("rejects a result whose id was never queued", async () => {
    startBridgeServer(27780)
    await vi.advanceTimersByTimeAsync(0)

    // No queueScript → no outstanding ids. /api/result for a made-up id
    // must be rejected (400) and must not be stored.
    const { res } = await postResultCapturing("cmd-forged-id", true, "x")
    expect(res.statusCode).toBe(400)
    expect(consumeCommandResult("cmd-forged-id")).toBeNull()
  })

  it("accepts a result whose id WAS queued, then rejects a replay", async () => {
    startBridgeServer(27780)
    await vi.advanceTimersByTimeAsync(0)

    const id = queueScript("print('x')")
    const { res: res1 } = await postResultCapturing(id, true, "r")
    expect(res1.statusCode).not.toBe(400)
    // First consumeCommandResult removes id from outstandingIds, so any
    // replay with the same id is now a forgery.
    expect(consumeCommandResult(id)).toMatchObject({ id, success: true, result: "r" })
    const { res: res2 } = await postResultCapturing(id, true, "replay")
    expect(res2.statusCode).toBe(400)
  })
})

describe("/api/result size cap", () => {
  it("rejects a result whose body exceeds MAX_RESULT_BYTES (1 MB)", async () => {
    startBridgeServer(27780)
    await vi.advanceTimersByTimeAsync(0)

    const id = queueScript("print('big')")
    // 1 MB + 1 byte of payload puts us clearly over the 1 MB cap.
    const huge = "a".repeat(1 * 1024 * 1024 + 1)
    const { res } = await postResultCapturing(id, true, huge)
    expect(res.statusCode).toBe(413)
    // Outstanding id was dropped, so a waiter sees null (not a hung wait).
    expect(consumeCommandResult(id)).toBeNull()
  })
})

describe("queueScript pending cap", () => {
  it("throws once MAX_PENDING_COMMANDS (50) is reached", async () => {
    startBridgeServer(27780)
    await vi.advanceTimersByTimeAsync(0)

    // 50 queues without draining → next one throws.
    for (let i = 0; i < 50; i++) {
      expect(() => queueScript(`print(${i})`)).not.toThrow()
    }
    expect(() => queueScript("overflow")).toThrow(/queue full|pending command/i)
  })
})

// H1 — timing-safe token compare. Validate that wrong-but-equal-length tokens
// are rejected (no string-shortcut), shorter tokens are rejected cleanly
// (no Buffer-length crash), and the correct token still authenticates.
async function reportWithToken(token: string | undefined): Promise<{ statusCode: number }> {
  const handler = h.getRequestHandler()
  if (!handler) throw new Error("no request handler — did you call startBridgeServer?")
  type DataCb = (chunk: Buffer) => void
  type EndCb = () => void
  const listeners: Record<string, Array<DataCb | EndCb>> = {}
  const headers: Record<string, string> = {}
  if (token !== undefined) headers["x-luano-token"] = token
  const req = {
    url: "/api/report",
    method: "POST",
    headers,
    on(event: string, fn: DataCb | EndCb) {
      (listeners[event] ??= []).push(fn)
      return this
    },
    destroy: vi.fn(),
  }
  const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() }
  const done = handler(req, res)
  const chunk = Buffer.from(JSON.stringify({ tree: null, logs: [] }))
  ;(listeners["data"] ?? []).forEach((fn) => (fn as DataCb)(chunk))
  ;(listeners["end"] ?? []).forEach((fn) => (fn as EndCb)())
  await done
  return { statusCode: res.statusCode }
}

describe("H1 — timing-safe token compare", () => {
  beforeEach(() => {
    // Force a known token so we can craft a wrong-but-same-length forgery.
    h.mockExistsSync.mockReturnValue(true)
    h.mockReadFileSync.mockReturnValue("a".repeat(32))
  })

  it("accepts the correct token (200)", async () => {
    startBridgeServer(27780)
    await vi.advanceTimersByTimeAsync(0)

    const { statusCode } = await reportWithToken("a".repeat(32))
    expect(statusCode).toBe(200)
  })

  it("rejects a wrong-but-equal-length token (403)", async () => {
    startBridgeServer(27780)
    await vi.advanceTimersByTimeAsync(0)

    // 32 chars but every char differs — must NOT short-circuit through string
    // equality and must not pass timingSafeEqual.
    const { statusCode } = await reportWithToken("b".repeat(32))
    expect(statusCode).toBe(403)
  })

  it("rejects a shorter token without crashing (timingSafeEqual length mismatch)", async () => {
    startBridgeServer(27780)
    await vi.advanceTimersByTimeAsync(0)

    // node:crypto timingSafeEqual throws when lengths differ. The length-pre-check
    // in server.ts is what keeps the handler from crashing here. If a future
    // refactor drops the pre-check and naively passes mismatched buffers, this
    // assertion trips because the response will never come back as 403 cleanly.
    const { statusCode } = await reportWithToken("a".repeat(8))
    expect(statusCode).toBe(403)
  })

  it("rejects a missing token header (403)", async () => {
    startBridgeServer(27780)
    await vi.advanceTimersByTimeAsync(0)

    const { statusCode } = await reportWithToken(undefined)
    expect(statusCode).toBe(403)
  })
})
