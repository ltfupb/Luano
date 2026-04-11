// src/editor/LuauLanguageClient.ts
// Connects Monaco Editor to luau-lsp via the WebSocket bridge (port 6008)
// The bridge sends/receives Content-Length framed JSON-RPC over WebSocket

import { MonacoLanguageClient } from "monaco-languageclient"
import { initServices } from "monaco-languageclient/vscode/services"
import { CloseAction, ErrorAction } from "vscode-languageclient"
import {
  AbstractMessageReader,
  AbstractMessageWriter,
  DataCallback,
  Emitter,
  Disposable,
  Message
} from "vscode-jsonrpc"

// ── Custom WebSocket transport ─────────────────────────────────────────────────

class WsMessageReader extends AbstractMessageReader {
  private readonly _msgEmitter = new Emitter<Message>()
  private _buffer = ""

  constructor(private readonly ws: WebSocket) {
    super()
    ws.addEventListener("message", (evt: MessageEvent) => {
      if (typeof evt.data === "string") {
        this._buffer += evt.data
        this._drain()
      }
    })
    ws.addEventListener("close", () => this.fireClose())
    ws.addEventListener("error", () => this.fireError(new Error("LSP WebSocket error")))
  }

  listen(callback: DataCallback): Disposable {
    return this._msgEmitter.event(callback)
  }

  private _drain(): void {
    while (true) {
      const sep = this._buffer.indexOf("\r\n\r\n")
      if (sep === -1) break
      const header = this._buffer.slice(0, sep)
      const m = header.match(/Content-Length:\s*(\d+)/i)
      if (!m) {
        // Malformed header — discard to next boundary
        this._buffer = this._buffer.slice(sep + 4)
        continue
      }
      const len = parseInt(m[1], 10)
      const bodyStart = sep + 4
      if (this._buffer.length < bodyStart + len) break // wait for more data
      const body = this._buffer.slice(bodyStart, bodyStart + len)
      this._buffer = this._buffer.slice(bodyStart + len)
      try {
        this._msgEmitter.fire(JSON.parse(body) as Message)
      } catch {
        // Ignore parse errors
      }
    }
  }
}

class WsMessageWriter extends AbstractMessageWriter {
  constructor(private readonly ws: WebSocket) {
    super()
  }

  write(msg: Message): Promise<void> {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.resolve()
    const body = JSON.stringify(msg)
    const len = new TextEncoder().encode(body).length
    const frame = `Content-Length: ${len}\r\n\r\n${body}`
    this.ws.send(frame)
    return Promise.resolve()
  }

  end(): void {
    // no-op
  }
}

// ── Client lifecycle ───────────────────────────────────────────────────────────

let _client: MonacoLanguageClient | null = null
let _ws: WebSocket | null = null
let _startPromise: Promise<void> | null = null

export async function startLuauLanguageClient(port: number): Promise<void> {
  // Await any in-progress start so we don't race teardown against init
  if (_startPromise) {
    try { await _startPromise } catch { /* ignore */ }
  }

  // Close WebSocket *before* stopping client to avoid cascading "connection
  // got disposed" rejections from pending JSON-RPC responses (ELECTRON-7)
  if (_ws) {
    _ws.close()
    _ws = null
  }
  if (_client) {
    try { if (_client.isRunning()) await _client.stop() } catch { /* ignore */ }
    _client = null
  }

  const ws = new WebSocket(`ws://localhost:${port}`)
  _ws = ws

  // Wait for connection
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true })
    ws.addEventListener("error", (e) => reject(new Error(`LSP WS error: ${String(e)}`)), { once: true })
  })

  // VSCode services must be initialized before creating MonacoLanguageClient (v8+)
  await initServices({ caller: "LuauLanguageClient" })

  const reader = new WsMessageReader(ws)
  const writer = new WsMessageWriter(ws)

  const client = new MonacoLanguageClient({
    name: "Luau Language Client",
    clientOptions: {
      // Covers both "lua" (what @monaco-editor/react uses by default) and custom "luau"
      documentSelector: [
        { language: "lua" },
        { language: "luau" }
      ],
      // Tell luau-lsp to load sourcemap.json from its cwd (the project root)
      // and watch it for changes. The sync tool (Rojo/Argon) writes the file;
      // luau-lsp picks up updates without us needing a separate watcher.
      // The CLI flag --sourcemap doesn't exist on the lsp subcommand — this
      // is the supported channel.
      initializationOptions: {
        sourcemap: {
          enabled: true,
          autogenerate: false,
          sourcemapFile: "sourcemap.json"
        }
      },
      // luau-lsp queries the client for the "luau-lsp.*" config sections via
      // workspace/configuration. Without a handler the server gets undefined
      // and falls back to defaults — including disabling sourcemap. Mirror
      // the initializationOptions here so both code paths agree.
      middleware: {
        workspace: {
          configuration: (params, _token, _next) => {
            return params.items.map((item) => {
              if (item.section === "luau-lsp.sourcemap") {
                return { enabled: true, autogenerate: false, sourcemapFile: "sourcemap.json" }
              }
              if (item.section === "luau-lsp") {
                return {
                  sourcemap: { enabled: true, autogenerate: false, sourcemapFile: "sourcemap.json" }
                }
              }
              return {}
            })
          }
        }
      },
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => ({ action: CloseAction.DoNotRestart })
      }
    },
    connectionProvider: {
      get: (_encoding: string) => Promise.resolve({ reader, writer })
    }
  })

  // Prevent internal stop()/shutdown() from producing unhandled rejections when
  // the library calls stop() during "starting" state (ELECTRON-8)
  const origStop = client.stop.bind(client)
  client.stop = async (timeout?: number) => {
    try { return await origStop(timeout) } catch { /* suppress lifecycle error */ }
  }

  _client = client
  _startPromise = client.start()
  try {
    await _startPromise
  } catch {
    // Client may fail to start (e.g. connection lost during init) — clean up silently
    if (_client === client) _client = null
  } finally {
    _startPromise = null
  }
}

export async function stopLuauLanguageClient(): Promise<void> {
  if (_startPromise) {
    try { await _startPromise } catch { /* ignore */ }
  }
  // Close WebSocket first to prevent cascading errors
  if (_ws) {
    _ws.close()
    _ws = null
  }
  if (_client) {
    try { if (_client.isRunning()) await _client.stop() } catch { /* ignore */ }
    _client = null
  }
}

export function isLuauLspConnected(): boolean {
  return _ws !== null && _ws.readyState === WebSocket.OPEN
}
