import { ChildProcess } from "child_process"
import { BrowserWindow } from "electron"
import { join } from "path"
import { spawnSidecar, getResourcePath } from "../sidecar/index"
import { LspBridge } from "./bridge"
import { log } from "../logger"

const MAX_AUTO_RETRIES = 5
const BASE_DELAY_MS = 2000
const MAX_DELAY_MS = 30000

export class LspManager {
  private proc: ChildProcess | null = null
  private bridge: LspBridge | null = null
  private projectPath: string | null = null
  private retryCount = 0
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
    const sourcemapPath = join(projectPath, "sourcemap.json")

    let proc: ChildProcess | null = null
    try {
      const sidecar = spawnSidecar(
        "luau-lsp",
        ["lsp", `--definitions=${typeDefsPath}`, `--sourcemap=${sourcemapPath}`],
        { cwd: projectPath }
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
        try { proc.kill() } catch { /* ignore */ }
      }
      this.proc = null
      this.bridge = null
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send("sidecar:error", { tool: "luau-lsp", message: String(err) })
      )
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
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send("sidecar:error", { tool: "luau-lsp", message: `luau-lsp exited (code ${code}) after ${this.retryCount} retries` })
      )
      return
    }

    this.retryCount++
    const delay = Math.min(BASE_DELAY_MS * Math.pow(1.5, this.retryCount - 1), MAX_DELAY_MS)
    log.info(`[lsp] auto-retry ${this.retryCount}/${MAX_AUTO_RETRIES} in ${delay}ms`)
    setTimeout(() => {
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

    bridge?.stop()
    if (proc && !proc.killed) {
      try { proc.kill() } catch { /* ignore */ }
    }
  }

  getPort(): number {
    return this.port
  }
}
