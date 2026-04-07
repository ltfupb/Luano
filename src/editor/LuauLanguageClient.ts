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

export async function startLuauLanguageClient(port: number): Promise<void> {
  // Tear down existing client first
  if (_client) {
    try { if (_client.isRunning()) await _client.stop() } catch { /* ignore */ }
    _client = null
  }
  if (_ws) {
    _ws.close()
    _ws = null
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
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => ({ action: CloseAction.DoNotRestart })
      }
    },
    connectionProvider: {
      get: (_encoding: string) => Promise.resolve({ reader, writer })
    }
  })

  _client = client
  try {
    await client.start()
  } catch {
    // Client may fail to start (e.g. connection lost during init) — clean up silently
    if (_client === client) _client = null
  }
}

export async function stopLuauLanguageClient(): Promise<void> {
  if (_client) {
    try { if (_client.isRunning()) await _client.stop() } catch { /* ignore */ }
    _client = null
  }
  if (_ws) {
    _ws.close()
    _ws = null
  }
}

export function isLuauLspConnected(): boolean {
  return _ws !== null && _ws.readyState === WebSocket.OPEN
}
