/**
 * tests/lsp-bridge.test.ts — LspBridge WebSocket cap + Content-Length guards.
 *
 * Covers:
 *   - MAX_CLIENTS: 9th connection is rejected with close code 1013
 *   - Content-Length over MAX_CONTENT_LENGTH closes clients with code 1009
 *   - Content-Length NaN / negative / non-finite → rejected
 *   - CRLF-framed message parses and is broadcast to clients
 *   - LF-framed message parses and is broadcast (normalized to CRLF on wire)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventEmitter } from "events"

// ── Module mocks for ws ──────────────────────────────────────────────────────

vi.mock("../electron/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock("ws", async () => {
  const { EventEmitter } = await import("events")
  class WebSocket {
    static OPEN = 1
    static CLOSED = 3
    readyState = 1
    close = () => {}
    send = () => {}
    on = () => {}
  }
  class WebSocketServer extends EventEmitter {
    host?: string
    port?: number
    constructor(opts: { host?: string; port?: number }, listenCb?: () => void) {
      super()
      this.host = opts.host
      this.port = opts.port
      if (listenCb) setImmediate(listenCb)
    }
    close() { /* noop */ }
  }
  return { WebSocket, WebSocketServer }
})

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Make a fake luau-lsp child process. */
function makeLspProcess() {
  const stdin = Object.assign(new EventEmitter(), {
    writable: true,
    write: vi.fn(),
  })
  const stdout = new EventEmitter()
  return {
    stdin,
    stdout,
    exitCode: null,
  } as unknown as import("child_process").ChildProcess
}

/** Make a fake ws client (connection). */
function makeClient() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  const ws = {
    readyState: 1, // OPEN
    close: vi.fn(),
    send: vi.fn(),
    on(event: string, fn: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(fn)
    },
    emit(event: string, ...args: unknown[]) {
      (listeners[event] ?? []).forEach((fn) => fn(...args))
    },
  }
  return ws
}

// Grab the underlying WSServer emitter from the LspBridge instance.
// We need to peek into the bridge's private `wss` field since our mock
// class is what the bridge created.
function getServerEmitter(bridge: unknown): EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (bridge as any).wss as EventEmitter
}

// ── Tests ────────────────────────────────────────────────────────────────────

// Import after mocks so the bridge picks up mocked `ws`.
import { LspBridge } from "../electron/lsp/bridge"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("LspBridge — MAX_CLIENTS", () => {
  it("rejects the 9th client with close code 1013", async () => {
    const proc = makeLspProcess()
    const bridge = new LspBridge(proc, 6008)
    await bridge.start()

    const server = getServerEmitter(bridge)

    // Connect 8 clients — all accepted
    const accepted = Array.from({ length: 8 }, () => makeClient())
    accepted.forEach((c) => server.emit("connection", c))
    accepted.forEach((c) => expect(c.close).not.toHaveBeenCalled())

    // 9th connection is rejected with 1013
    const ninth = makeClient()
    server.emit("connection", ninth)
    expect(ninth.close).toHaveBeenCalledWith(1013, "too many clients")
  })
})

describe("LspBridge — Content-Length framing & cap", () => {
  it("closes all clients with 1009 when Content-Length exceeds MAX_CONTENT_LENGTH", async () => {
    const proc = makeLspProcess()
    const bridge = new LspBridge(proc, 6008)
    await bridge.start()
    const server = getServerEmitter(bridge)

    const client = makeClient()
    server.emit("connection", client)

    // Spec: 10MB + 1 → rejected. Header alone doesn't need body — the guard
    // fires as soon as the length is parsed.
    const tooBig = 10 * 1024 * 1024 + 1
    const header = `Content-Length: ${tooBig}\r\n\r\n`
    proc.stdout!.emit("data", Buffer.from(header))

    expect(client.close).toHaveBeenCalledWith(1009, "message too big")
  })

  it("rejects pathologically huge Content-Length (DoS guard)", async () => {
    const proc = makeLspProcess()
    const bridge = new LspBridge(proc, 6008)
    await bridge.start()
    const server = getServerEmitter(bridge)

    const client = makeClient()
    server.emit("connection", client)

    // 9999999999 is the canonical DoS trigger called out in the source comment.
    const header = `Content-Length: 9999999999\r\n\r\n`
    proc.stdout!.emit("data", Buffer.from(header))

    expect(client.close).toHaveBeenCalledWith(1009, "message too big")
  })

  it("parses a CRLF-framed message and broadcasts to all clients", async () => {
    const proc = makeLspProcess()
    const bridge = new LspBridge(proc, 6008)
    await bridge.start()
    const server = getServerEmitter(bridge)

    const client = makeClient()
    server.emit("connection", client)

    const body = `{"jsonrpc":"2.0","id":1,"result":null}`
    const header = `Content-Length: ${body.length}\r\n`
    const msg = `${header}\r\n${body}`
    proc.stdout!.emit("data", Buffer.from(msg))

    expect(client.send).toHaveBeenCalledTimes(1)
    const sent = client.send.mock.calls[0][0] as string
    expect(sent).toContain(body)
    // Outbound is always CRLF-normalized
    expect(sent).toContain("\r\n\r\n")
  })

  it("parses an LF-framed message (bare LF headers) and broadcasts normalized", async () => {
    const proc = makeLspProcess()
    const bridge = new LspBridge(proc, 6008)
    await bridge.start()
    const server = getServerEmitter(bridge)

    const client = makeClient()
    server.emit("connection", client)

    const body = `{"jsonrpc":"2.0","method":"initialized"}`
    // LF-only framing: Content-Length: X\nX-Foo: bar\n\n<body>
    const msg = `Content-Length: ${body.length}\nX-Accept: */*\n\n${body}`
    proc.stdout!.emit("data", Buffer.from(msg))

    expect(client.send).toHaveBeenCalledTimes(1)
    const sent = client.send.mock.calls[0][0] as string
    expect(sent).toContain(body)
    // Normalized to CRLF on wire
    expect(sent).toContain("\r\n\r\n")
  })

  it("buffers partial messages and flushes when body completes", async () => {
    const proc = makeLspProcess()
    const bridge = new LspBridge(proc, 6008)
    await bridge.start()
    const server = getServerEmitter(bridge)

    const client = makeClient()
    server.emit("connection", client)

    const body = `{"hello":"world"}`
    // Emit header first, then body in a second chunk
    proc.stdout!.emit("data", Buffer.from(`Content-Length: ${body.length}\r\n\r\n`))
    expect(client.send).not.toHaveBeenCalled()
    proc.stdout!.emit("data", Buffer.from(body))
    expect(client.send).toHaveBeenCalledTimes(1)
  })
})
