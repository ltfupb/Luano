/**
 * electron/toolchain/argon-manager.ts — Argon sync tool manager
 *
 * Drives the Argon CLI. Same surface as RojoManager but accounts for a few
 * Argon-specific quirks:
 *
 *  1. `proc.kill()` alone can leave the Argon server/daemon alive holding the
 *     port. `argon stop --all -y` is used as a belt-and-braces cleanup to
 *     tear down any lingering session.
 *
 *  2. Argon prompts for confirmation on some actions. Pass `-y` so it never
 *     blocks waiting for stdin.
 *
 *  3. `argon serve -s` has built-in sourcemap watching that writes
 *     `sourcemap.json` to the project root. No need for a second sidecar.
 *
 *  4. Argon uses Rust's log framework, so all output (including the
 *     "Serving on: http://..." ready line) arrives on stderr.
 */

import { ChildProcess, spawnSync } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { spawnSidecar, getBinaryPath, isBinaryAvailable } from "../sidecar"
import { BrowserWindow } from "electron"
import { log } from "../logger"
import { migrateProjectForArgon } from "../file/project"

export type SyncStatus = "stopped" | "starting" | "running" | "error"

const MAX_AUTO_RETRIES = 2
const RETRY_DELAY_MS = 2000

export class ArgonManager {
  private proc: ChildProcess | null = null
  private status: SyncStatus = "stopped"
  private projectPath: string | null = null
  private port: number | null = null
  private retryCount = 0
  private lastError: string | null = null

  /** User-initiated start. Resets retry budget. */
  serve(projectPath: string): void {
    log.info("[argon] serve requested", projectPath)
    this.teardown()
    this.retryCount = 0
    this.projectPath = projectPath

    if (!existsSync(join(projectPath, "default.project.json"))) {
      log.warn("[argon] no default.project.json found; refusing to serve")
      this.status = "stopped"
      this.notifyStatus()
      return
    }

    // Legacy Rojo projects often ship $className + $path on the same node,
    // which Argon rejects. The fix is lossless for Rojo too, so apply it
    // silently and notify the renderer with a toast.
    if (migrateProjectForArgon(projectPath)) {
      log.info("[argon] migrated default.project.json to Argon-compatible format")
      this.notifyUser("default.project.json updated for Argon compatibility", "info")
    }

    this.status = "starting"
    this.lastError = null
    this.notifyStatus()
    this.spawnProcess(projectPath)
  }

  private notifyUser(message: string, type: "info" | "warn" | "error"): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("rojo:notice", message, type)
    })
  }

  /** User-initiated stop. Zeroes retry budget so in-flight retries abort. */
  stop(): void {
    log.info("[argon] stop requested")
    this.projectPath = null
    this.retryCount = 0
    this.teardown()
    this.status = "stopped"
    this.notifyStatus()
  }

  /**
   * Spawn a new Argon process. Called from `serve()` (user intent) and from
   * the exit handler's auto-retry path. Retry budget is NOT touched here —
   * only the caller decides whether this attempt counts against the budget.
   */
  private spawnProcess(projectPath: string): void {
    try {
      const sidecar = spawnSidecar(
        "argon",
        ["serve", "-y", "-s", "--host", "127.0.0.1", "default.project.json"],
        {
          cwd: projectPath,
          onData: (data) => this.handleOutput(data),
          onError: (data) => this.handleOutput(data)
        }
      )

      const proc = sidecar.process
      this.proc = proc
      log.info(`[argon] spawned PID=${proc.pid}`)

      // Capture proc identity in the closure: a teardown() → spawnProcess()
      // sequence (auto-retry, or stop+serve from the user) can reassign
      // this.proc before the old proc's queued exit event fires. Without
      // this guard the stale exit handler would tear down the new proc.
      proc.on("exit", (code, signal) => {
        if (this.proc !== proc) {
          log.info(`[argon] stale exit ignored (code=${code} signal=${signal})`)
          return
        }
        this.handleExit(code, signal)
      })
      proc.on("error", (err) => {
        if (this.proc !== proc) return
        log.error("[argon] spawn error:", err.message)
        this.status = "error"
        this.lastError = err.message
        this.notifyStatus()
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error("[argon] spawn threw:", msg)
      this.status = "error"
      this.lastError = msg
      this.notifyStatus()
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    // teardown() nulled this.proc before killing — if so, the exit is
    // user-requested and we must not auto-retry.
    if (this.proc === null) {
      log.info(`[argon] proc exited after teardown (code=${code} signal=${signal})`)
      return
    }
    this.proc = null

    log.warn(`[argon] unexpected exit code=${code} signal=${signal} lastError=${this.lastError}`)

    const path = this.projectPath
    const shouldRetry = code !== 0 && path !== null && this.retryCount < MAX_AUTO_RETRIES

    if (!shouldRetry) {
      this.status = code === 0 ? "stopped" : "error"
      this.notifyStatus()
      return
    }

    this.retryCount++
    log.info(`[argon] auto-retry ${this.retryCount}/${MAX_AUTO_RETRIES} in ${RETRY_DELAY_MS}ms`)
    this.status = "starting"
    this.notifyStatus()
    setTimeout(() => {
      if (this.projectPath === path) this.spawnProcess(path)
    }, RETRY_DELAY_MS)
  }

  private handleOutput(data: string): void {
    const readyMatch = data.match(/(?:Serving on|listening on)[\s\S]*?:(\d{4,5})(?:\D|$)/i)
    if (readyMatch) {
      this.port = parseInt(readyMatch[1], 10)
      if (this.status !== "running") {
        this.status = "running"
        log.info(`[argon] ready on port ${this.port}`)
        this.notifyStatus()
      }
      return
    }

    const trimmed = data.trim()
    if (!trimmed) return
    // Log every stderr line so we can diagnose why argon might be dying.
    log.debug("[argon stderr]", trimmed)
    if (/ERROR|error:|panicked/i.test(trimmed)) {
      this.lastError = trimmed
    }
  }

  /**
   * Kill current proc + any lingering Argon daemon. Does NOT touch status,
   * retryCount, or projectPath — caller controls those.
   */
  private teardown(): void {
    const proc = this.proc
    this.proc = null
    if (proc && !proc.killed) {
      try { proc.kill() } catch { /* ignore */ }
    }
    this.killStaleSessions()
  }

  private killStaleSessions(): void {
    if (!isBinaryAvailable("argon")) return
    try {
      const res = spawnSync(getBinaryPath("argon"), ["stop", "--all", "-y"], {
        timeout: 3000,
        windowsHide: true,
        encoding: "utf-8"
      })
      if (res.stdout && res.stdout.includes("Stopped")) {
        log.info("[argon] killed stale session:", res.stdout.trim())
      }
    } catch {
      // Best-effort cleanup.
    }
  }

  getStatus(): SyncStatus {
    return this.status
  }

  getPort(): number | null {
    return this.port
  }

  getLastError(): string | null {
    return this.lastError
  }

  private notifyStatus(): void {
    const err = this.status === "error" ? this.lastError : null
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("rojo:status-changed", this.status, this.port, err)
    })
  }
}
