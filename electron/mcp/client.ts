import { request } from "http"

// Studio MCP server defaults — configurable in Studio settings
const STUDIO_MCP_HOST = "localhost"
const STUDIO_MCP_PORT = 8080
const REQUEST_TIMEOUT_MS = 3000

interface McpResult {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

function callMcpTool(toolName: string, args: Record<string, unknown> = {}): Promise<McpResult | null> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: args },
      id: Date.now()
    })

    const req = request(
      {
        hostname: STUDIO_MCP_HOST,
        port: STUDIO_MCP_PORT,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = ""
        res.on("data", (chunk: Buffer) => (data += chunk.toString()))
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data) as { result?: McpResult }
            resolve(parsed.result ?? null)
          } catch {
            resolve(null)
          }
        })
      }
    )

    req.on("error", () => resolve(null))
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy()
      resolve(null)
    })

    req.write(body)
    req.end()
  })
}

export async function getConsoleOutput(): Promise<string | null> {
  const result = await callMcpTool("get_console_output")
  if (!result || result.isError) return null
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
}

export async function isStudioConnected(): Promise<boolean> {
  // Use a lightweight tool to check connectivity
  const result = await callMcpTool("list_scripts")
  return result !== null && !result.isError
}
