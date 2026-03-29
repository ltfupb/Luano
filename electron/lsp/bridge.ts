import { ChildProcess } from "child_process"
import { WebSocketServer, WebSocket } from "ws"

// luau-lsp의 stdio를 WebSocket으로 브릿지
// Monaco languageclient가 WebSocket으로 LSP에 연결할 수 있게 함
export class LspBridge {
  private wss: WebSocketServer | null = null
  private clients: Set<WebSocket> = new Set()
  private buffer = ""

  constructor(
    private readonly lspProcess: ChildProcess,
    private readonly port: number
  ) {}

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port }, () => resolve())

      this.wss.on("connection", (ws) => {
        this.clients.add(ws)

        ws.on("message", (data) => {
          // 클라이언트 → luau-lsp stdin
          const msg = data.toString()
          this.lspProcess.stdin?.write(msg)
        })

        ws.on("close", () => this.clients.delete(ws))
      })

      // luau-lsp stdout → 클라이언트
      this.lspProcess.stdout?.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString()
        this.processBuffer()
      })
    })
  }

  private processBuffer(): void {
    // LSP는 Content-Length 헤더 기반 메시지 프레이밍 사용
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) break

      const header = this.buffer.slice(0, headerEnd)
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) break

      const contentLength = parseInt(lengthMatch[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + contentLength) break

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength)
      const fullMessage = `${header}\r\n\r\n${body}`

      // 모든 연결된 클라이언트에 전송
      this.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(fullMessage)
        }
      })

      this.buffer = this.buffer.slice(bodyStart + contentLength)
    }
  }

  stop(): void {
    this.wss?.close()
    this.clients.clear()
  }
}
