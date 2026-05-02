import { ChildProcess } from "child_process"
import { BrowserWindow } from "electron"
import { spawnSidecar, getResourcePath } from "../sidecar/index"
import { LspBridge } from "./bridge"
import { log } from "../logger"

const MAX_AUTO_RETRIES = 5
const BASE_DELAY_MS = 2000
// Cap backoff at 10s — with 1.5^(n-1) growth and 5 retries, uncapped would
// hit ~10s anyway, but the cap keeps total retry window bounded if constants
// are later tuned. Keep formula explicit so intent is clear.
const MAX_DELAY_MS = 10000

export class LspManager {
  private proc: ChildProcess | null = null
  private bridge: LspBridge | null = null
  private projectPath: string | null = null
  private retryCount = 0
  /** Pending retry timer from handleExit — cleared in stop() so a
   *  retry fire doesn't spawn a second luau-lsp against the same port
   *  after the user explicitly stopped. */
  private retryTimer: NodeJS.Timeout | null = null
  readonly port = 6008

  /** User-initiated start. Resets retry budget. */
  async start(projectPath: string): Promise<void> {
    await this.stop()
    this.retryCount = 0
    this.projectPath = projectPath
    await this.spawnProcess(projectPath)
  }

  private async spawnProcess(projectPath: string): Promise<void> {
    const typeDefsPath = getResourcePath("type-defs", "globalTypes.d.luau")

    // Broadcast "starting" phase so the StatusBar can show a pulsing dot +
    // elapsed time while the luau-lsp process boots.
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send("sidecar:lsp-status", { status: "starting", port: this.port })
    )

    let proc: ChildProcess | null = null
    try {
      // --sourcemap is an `analyze` subcommand flag, not an `lsp` flag.
      // Sourcemap content gets pushed via the luau-lsp/updateSourceMap LSP
      // notification once the client connects (TODO: not yet implemented).
      const sidecar = spawnSidecar(
        "luau-lsp",
        ["lsp", `--definitions=${typeDefsPath}`],
        {
          cwd: projectPath,
          // luau-lsp emits diagnostics on stderr; without this listener exit
          // code 1 arrives with no explanation.
          onError: (data) => {
            const trimmed = data.trim()
            if (trimmed) log.warn("[lsp stderr]", trimmed)
          }
        }
      )

      proc = sidecar.process
      this.proc = proc

      // Capture proc identity in the closure: a stop() → start() sequence can
      // reassign this.proc before the old proc's queued exit event fires. The
      // identity check ensures the stale exit handler is a no-op.
      const ownProc = proc
      proc.on("exit", (code) => {
        if (this.proc !== ownProc) return
        this.handleExit(code)
      })
      proc.on("error", (err) => {
        log.error("[lsp] process error:", err.message)
        BrowserWindow.getAllWindows().forEach((win) =>
          win.webContents.send("sidecar:error", { tool: "luau-lsp", message: err.message })
        )
      })

      this.bridge = new LspBridge(proc, this.port)
      await this.bridge.start()
      log.info(`[lsp] spawned PID=${proc.pid}`)

      // Announce "running" so the StatusBar transitions out of the pulsing
      // "starting" state. Fire regardless of retry count — the renderer
      // tracks both phase (status) and reconnection hook (lsp-ready).
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send("sidecar:lsp-status", { status: "running", port: this.port })
      )

      // After a crash recovery, tell the renderer to re-attach its
      // MonacoLanguageClient. The initial start is already handled by the
      // openProject IPC return value, so only fire on retries.
      if (this.retryCount > 0) {
        BrowserWindow.getAllWindows().forEach((win) =>
          win.webContents.send("sidecar:lsp-ready", { port: this.port })
        )
      }
    } catch (err) {
      log.error("[lsp] failed to start luau-lsp:", err)
      // Bridge or spawn failed — clean up the proc so we don't leak it.
      if (proc && !proc.killed) {
        try { proc.kill() } catch (killErr) { log.debug("[lsp] cleanup kill failed:", killErr) }
      }
      this.proc = null
      this.bridge = null
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("sidecar:lsp-status", { status: "error", port: null })
        win.webContents.send("sidecar:error", { tool: "luau-lsp", message: String(err) })
      })
      throw err
    }
  }

  private handleExit(code: number | null): void {
    // teardown nulled this.proc — exit is user-initiated, do not auto-retry.
    if (this.proc === null) return
    this.proc = null
    this.bridge?.stop()
    this.bridge = null

    const path = this.projectPath
    const shouldRetry = code !== 0 && code !== null && path !== null && this.retryCount < MAX_AUTO_RETRIES

    if (!shouldRetry) {
      log.warn(`[lsp] giving up after exit code=${code} retries=${this.retryCount}`)
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("sidecar:lsp-status", { status: "error", port: null })
        win.webContents.send("sidecar:error", { tool: "luau-lsp", message: `luau-lsp exited (code ${code}) after ${this.retryCount} retries` })
      })
      return
    }

    this.retryCount++
    const delay = Math.min(BASE_DELAY_MS * Math.pow(1.5, this.retryCount - 1), MAX_DELAY_MS)
    log.info(`[lsp] auto-retry ${this.retryCount}/${MAX_AUTO_RETRIES} in ${delay}ms`)
    // Pre-announce "starting" so the renderer shows the pulsing dot
    // during the backoff window, not just when the spawn actually fires.
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send("sidecar:lsp-status", { status: "starting", port: this.port })
    )
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.projectPath === path) {
        this.spawnProcess(path).catch((e) => log.error("[lsp] retry failed:", e))
      }
    }, delay)
  }

  async stop(): Promise<void> {
    const proc = this.proc
    const bridge = this.bridge
    this.proc = null
    this.bridge = null
    this.projectPath = null
    this.retryCount = 0

    // Cancel any pending retry timer. Without this, a user who stops then
    // reopens the same project within the backoff window could see the
    // stale timer still fire and spawn a duplicate luau-lsp → EADDRINUSE
    // on port 6008.
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    bridge?.stop()
    if (proc && !proc.killed) {
      try { proc.kill() } catch (err) { log.debug("[lsp] stop kill failed:", err) }
    }

    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send("sidecar:lsp-status", { status: "stopped", port: null })
    )
  }

  getPort(): number {
    return this.port
  }
}
