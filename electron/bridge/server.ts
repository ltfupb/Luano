import { createServer, IncomingMessage, ServerResponse } from "http"
import { BrowserWindow } from "electron"
import { randomBytes } from "crypto"

// ── Types ─────────────────────────────────────────────────────────────────────
export interface InstanceNode {
  name: string
  class: string
  children?: InstanceNode[]
}

export interface LogEntry {
  text: string
  kind: "output" | "warn" | "error"
  ts: number
}

interface Command {
  id: string
  type: "run_script"
  code: string
}

interface CommandResult {
  id: string
  success: boolean
  result: string
}

// ── State ─────────────────────────────────────────────────────────────────────
interface BridgeState {
  tree: InstanceNode | null
  logs: LogEntry[]
  lastUpdate: number
  connected: boolean
  pendingCommands: Command[]
  commandResults: Map<string, CommandResult>
}

const state: BridgeState = {
  tree: null,
  logs: [],
  lastUpdate: 0,
  connected: false,
  pendingCommands: [],
  commandResults: new Map()
}

let mainWin: BrowserWindow | null = null
let httpServer: ReturnType<typeof createServer> | null = null
let bridgeToken: string = ""

/** Auth token for Studio plugin to include in requests */
export function getBridgeToken(): string {
  return bridgeToken
}

export function setBridgeWindow(win: BrowserWindow): void {
  mainWin = win
}

export function getBridgeTree(): InstanceNode | null {
  return state.tree
}

export function getBridgeLogs(): LogEntry[] {
  return state.logs
}

export function isBridgeConnected(): boolean {
  return state.lastUpdate > 0 && Date.now() - state.lastUpdate < 6_000
}

export function clearBridgeLogs(): void {
  state.logs = []
}

export function queueScript(code: string): string {
  const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`
  state.pendingCommands.push({ id, type: "run_script", code })
  return id
}

export function getCommandResult(id: string): CommandResult | null {
  return state.commandResults.get(id) ?? null
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ""
    req.on("data", (chunk: Buffer) => (body += chunk.toString()))
    req.on("end", () => resolve(body))
  })
}

function pushToRenderer(event: "bridge:update", data: object): void {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(event, data)
  }
}

// ── Server ────────────────────────────────────────────────────────────────────
export function startBridgeServer(port = 27780): void {
  if (httpServer) return

  // Generate a fresh auth token each launch
  bridgeToken = randomBytes(16).toString("hex")

  httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Content-Type", "application/json")
    // Restrict CORS to same-origin only (no wildcard)
    res.setHeader("Access-Control-Allow-Origin", "null")

    const { url = "", method = "" } = req

    // Health check (no auth required — used for port detection)
    if (method === "GET" && url === "/api/ping") {
      res.end(JSON.stringify({ ok: true, version: 2 }))
      return
    }

    // Validate auth token on all other endpoints
    const reqToken = req.headers["x-luano-token"] as string | undefined
    if (reqToken !== bridgeToken) {
      res.statusCode = 403
      res.end(JSON.stringify({ ok: false, error: "invalid token" }))
      return
    }

    // Studio reports state
    if (method === "POST" && url === "/api/report") {
      try {
        const body = await readBody(req)
        const data = JSON.parse(body) as {
          tree?: InstanceNode
          logs?: Array<{ text: string; kind: string }>
        }

        if (data.tree) state.tree = data.tree

        const newLogs: LogEntry[] = (data.logs ?? []).map((l) => ({
          text: l.text,
          kind: (l.kind === "warn" ? "warn" : l.kind === "error" ? "error" : "output") as LogEntry["kind"],
          ts: Date.now()
        }))
        state.logs = [...state.logs, ...newLogs].slice(-1000)

        state.lastUpdate = Date.now()
        const wasConnected = state.connected
        state.connected = true

        // Push live update to renderer
        pushToRenderer("bridge:update", {
          connected: true,
          newLogs,
          hasTree: !!state.tree,
          justConnected: !wasConnected
        })

        // Return pending commands
        const cmds = [...state.pendingCommands]
        state.pendingCommands = []
        res.end(JSON.stringify({ ok: true, commands: cmds }))
      } catch {
        res.statusCode = 400
        res.end(JSON.stringify({ ok: false, error: "bad json" }))
      }
      return
    }

    // Studio returns command execution result
    if (method === "POST" && url === "/api/result") {
      try {
        const body = await readBody(req)
        const result = JSON.parse(body) as CommandResult
        state.commandResults.set(result.id, result)
        // Cap map size
        if (state.commandResults.size > 100) {
          const first = state.commandResults.keys().next().value
          if (first !== undefined) state.commandResults.delete(first)
        }
        pushToRenderer("bridge:update", { commandResult: result })
        res.end(JSON.stringify({ ok: true }))
      } catch {
        res.statusCode = 400
        res.end(JSON.stringify({ ok: false }))
      }
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({ ok: false }))
  })

  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`[LuanoBridge] HTTP server listening on 127.0.0.1:${port}`)
  })

  httpServer.on("error", (err: Error) => {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "EADDRINUSE") {
      console.warn(`[LuanoBridge] Port ${port} already in use`)
    } else {
      console.error("[LuanoBridge] Server error:", err.message)
    }
  })

  // Disconnection detector: mark disconnected if no report for 6s
  setInterval(() => {
    if (state.connected && Date.now() - state.lastUpdate > 6_000) {
      state.connected = false
      pushToRenderer("bridge:update", { connected: false })
      console.log("[LuanoBridge] Studio disconnected (no report for 6s)")
    }
  }, 2_000)
}
