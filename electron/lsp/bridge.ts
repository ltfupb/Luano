import { ChildProcess } from "child_process"
import { WebSocketServer, WebSocket } from "ws"
import { log } from "../logger"

// Bridges luau-lsp stdio to WebSocket
// Allows Monaco languageclient to connect to LSP via WebSocket
const MAX_CLIENTS = 8
// Matches bridge/server's MAX_BODY_BYTES (5 MB) — any LSP message above this
// is either a bug or malicious (local process DoS: "Content-Length: 9999999999"
// forces the main process to accumulate gigabytes in `buffer` before framing).
const MAX_CONTENT_LENGTH = 10 * 1024 * 1024 // 10 MB

export class LspBridge {
  private wss: WebSocketServer | null = null
  private clients: Set<WebSocket> = new Set()
  private buffer = ""

  constructor(
    private readonly lspProcess: ChildProcess,
    private readonly port: number
  ) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ host: "127.0.0.1", port: this.port }, () => {
        log.info(`[lsp-bridge] WebSocket listening on 127.0.0.1:${this.port}`)
        resolve()
      })
      this.wss.on("error", (err) => {
        log.error("[lsp-bridge] WSS error:", err)
        reject(err)
      })

      // Swallow stdin errors (EPIPE when the LSP process has exited but a
      // late client message still tries to write). Without this handler,
      // Node throws synchronously from write().
      this.lspProcess.stdin?.on("error", (err) => {
        log.debug("[lsp-bridge] stdin error (process likely exited):", err)
      })

      this.wss.on("connection", (ws) => {
        // Reject connections past cap to prevent unbounded growth if a
        // renderer bug or reconnect storm keeps opening sockets.
        if (this.clients.size >= MAX_CLIENTS) {
          log.warn(`[lsp-bridge] rejecting connection: client cap (${MAX_CLIENTS}) reached`)
          try { ws.close(1013, "too many clients") } catch (err) {
            log.debug("[lsp-bridge] failed to close over-cap socket:", err)
          }
          return
        }
        this.clients.add(ws)
        log.debug(`[lsp-bridge] client connected (${this.clients.size}/${MAX_CLIENTS})`)

        ws.on("message", (data) => {
          // Client → luau-lsp stdin. Skip if the LSP process is gone.
          const stdin = this.lspProcess.stdin
          if (!stdin || !stdin.writable || this.lspProcess.exitCode !== null) return
          try { stdin.write(data.toString()) } catch (err) {
            log.debug("[lsp-bridge] stdin.write failed (process likely exited):", err)
          }
        })

        ws.on("close", () => this.clients.delete(ws))
        ws.on("error", (err) => { log.debug("[lsp-bridge] ws error (close will fire):", err) })
      })

      // luau-lsp stdout → Client
      this.lspProcess.stdout?.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString()
        this.processBuffer()
      })
    })
  }

  private processBuffer(): void {
    // LSP uses Content-Length header-based message framing.
    // Spec says CRLF, but some implementations / tooling emit bare LF,
    // so accept both.
    while (true) {
      // CRLF is spec-compliant; scan for it first and only fall through to
      // LF if it's absent. Short-circuits the second indexOf when the common
      // case (CRLF) is found.
      const crlfEnd = this.buffer.indexOf("\r\n\r\n")
      let headerEnd = -1
      let separatorLen = 0
      if (crlfEnd !== -1) {
        headerEnd = crlfEnd
        separatorLen = 4
      } else {
        const lfEnd = this.buffer.indexOf("\n\n")
        if (lfEnd === -1) break
        headerEnd = lfEnd
        separatorLen = 2
      }

      const header = this.buffer.slice(0, headerEnd)
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) break

      const contentLength = parseInt(lengthMatch[1])
      // DoS guard: a malicious or buggy source could send
      // "Content-Length: 9999999999" forcing `buffer` to accumulate
      // gigabytes before framing completes. Cap at 10MB (matches
      // bridge/server MAX_BODY_BYTES) and tear the connections down.
      if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_CONTENT_LENGTH) {
        log.warn(`[lsp-bridge] DoS guard: dropping ${this.clients.size} client(s) — Content-Length=${contentLength}`)
        this.clients.forEach((ws) => {
          try { ws.close(1009, "message too big") } catch (err) {
            log.debug("[lsp-bridge] failed to close oversized client:", err)
          }
        })
        this.clients.clear()
        this.buffer = ""
        return
      }
      const bodyStart = headerEnd + separatorLen
      if (this.buffer.length < bodyStart + contentLength) break

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength)
      // Normalize to CRLF on the outbound side — Monaco languageclient
      // expects spec-compliant framing even if upstream used LF.
      const fullMessage = `${header}\r\n\r\n${body}`

      // Broadcast to all connected clients
      this.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(fullMessage)
        }
      })

      this.buffer = this.buffer.slice(bodyStart + contentLength)
    }
  }

  stop(): void {
    this.clients.forEach((ws) => { try { ws.close() } catch (err) {
      log.debug("[lsp-bridge] stop: ws.close failed:", err)
    } })
    this.clients.clear()
    this.wss?.close()
    this.wss = null
  }
}
