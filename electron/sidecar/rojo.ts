import { ChildProcess } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { spawnSidecar } from "./index"
import { BrowserWindow } from "electron"
import { log } from "../logger"

export type RojoStatus = "stopped" | "starting" | "running" | "error"

export class RojoManager {
  private proc: ChildProcess | null = null
  private sourcemapProc: ChildProcess | null = null
  private status: RojoStatus = "stopped"
  private projectPath: string | null = null
  private port: number | null = null
  private restartCount = 0
  private lastError: string | null = null

  serve(projectPath: string): void {
    log.info("[rojo] serve requested", projectPath)
    // Reset restartCount when the user explicitly serves a (potentially
    // different) path, so a fresh attempt isn't blocked by exhausted retries
    // from a previous corrupted-project-json loop.
    if (projectPath !== this.projectPath) this.restartCount = 0
    this.stop()
    this.projectPath = projectPath
    this.lastError = null

    // Skip if no default.project.json. Surface as error so the sync panel
    // tells the user "this isn't a Rojo project" instead of silently
    // sitting idle (see argon-manager for the same fix).
    if (!existsSync(join(projectPath, "default.project.json"))) {
      this.lastError = "No default.project.json — this folder isn't a Rojo project. Run `rojo init` in the terminal or open a project folder that has one."
      this.status = "error"
      log.warn(`[rojo] ${this.lastError}`)
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("sync:notice", this.lastError, "error")
      })
      this.notifyStatus()
      return
    }

    this.status = "starting"
    this.notifyStatus()

    // Capture the path locally so the exit-handler closure is scoped to
    // THIS serve() invocation. Prevents a stale exit event from a previous
    // proc (arriving after a stop()/serve() switch) from restarting the
    // wrong project.
    const path = projectPath

    try {
      const sidecar = spawnSidecar("rojo", ["serve", "default.project.json", "--address", "127.0.0.1"], {
        cwd: projectPath,
        onData: (data) => {
          this.restartCount = 0
          // Parse port from Rojo output (e.g. "Listening on port 34872")
          const portMatch = data.match(/(?:port|localhost:|:)(\d{4,5})/i)
          if (portMatch) this.port = parseInt(portMatch[1], 10)
          if (this.status !== "running") {
            this.status = "running"
            this.lastError = null
            log.info(`[rojo] ready on port ${this.port ?? "?"}`)
          }
          this.notifyStatus()
          this.startSourcemapWatch(projectPath)
        },
        onError: (data) => {
          const trimmed = data.trim()
          if (!trimmed) return
          log.debug("[rojo stderr]", trimmed)
          if (/error|fail|panic/i.test(trimmed)) {
            this.lastError = trimmed
          }
        }
      })
      log.info(`[rojo] spawned PID=${sidecar.process.pid ?? "?"}`)

      this.proc = sidecar.process
      const ownProc = this.proc

      this.proc.on("exit", (code) => {
        // Identity guard: ignore exit events from a proc we already replaced.
        if (this.proc !== ownProc) return
        // Also ignore if the projectPath has since changed (stop() or switch
        // to a different folder).
        if (path !== this.projectPath) return
        this.status = code === 0 ? "stopped" : "error"
        log.info(`[rojo] proc exited (code=${code})`)
        this.notifyStatus()
        // M4: use exponential backoff (1.5^retryCount, cap 30s) matching the
        // LSP manager's restart strategy. A corrupt default.project.json was
        // previously causing 6s of rapid thrashing with a fixed 2s delay.
        const MAX_ROJO_RESTARTS = 5
        if (code !== 0 && code !== null && this.restartCount < MAX_ROJO_RESTARTS) {
          const delay = Math.min(1000 * Math.pow(1.5, this.restartCount), 30_000)
          this.restartCount++
          log.warn(`[rojo] auto-restart in ${Math.round(delay)}ms (attempt ${this.restartCount}/${MAX_ROJO_RESTARTS})`)
          setTimeout(() => { if (this.projectPath === path) this.serve(path) }, delay)
        }
      })

      this.proc.on("error", (err) => {
        // Same identity guard as the exit handler: a stale error event from
        // a previous proc (fast A→B project switch where A's spawn failed)
        // must not mutate B's state.
        if (this.proc !== ownProc) return
        if (path !== this.projectPath) return
        this.status = "error"
        log.error("[rojo] proc error:", err)
        this.notifyStatus()
      })
    } catch (err) {
      // Without this log, a missing rojo binary or other spawn failure is
      // invisible — status flips to "error" but the cause never reaches
      // disk, so post-mortem debugging from a packaged build is impossible.
      log.error("[rojo] spawn failed:", err)
      this.status = "error"
      this.lastError = err instanceof Error ? err.message : String(err)
      this.notifyStatus()
    }
  }

  private startSourcemapWatch(projectPath: string): void {
    if (this.sourcemapProc) return

    const sidecar = spawnSidecar("rojo", ["sourcemap", "default.project.json", "--watch", "--output", "sourcemap.json"], {
      cwd: projectPath
    })
    this.sourcemapProc = sidecar.process
    const ownProc = this.sourcemapProc

    // Without these handlers, a crashed sourcemap proc (bad project JSON,
    // missing rojo binary, etc.) leaves `this.sourcemapProc` non-null →
    // the early-return at the top blocks respawn for the rest of the
    // session. Null the field on exit/error so the next serve() onData
    // can restart the watcher.
    if (ownProc) {
      ownProc.on("exit", (code) => {
        if (this.sourcemapProc !== ownProc) return
        this.sourcemapProc = null
        log.warn(`[rojo] sourcemap watcher exited (code ${code})`)
      })
      ownProc.on("error", (err) => {
        if (this.sourcemapProc !== ownProc) return
        this.sourcemapProc = null
        log.warn(`[rojo] sourcemap watcher error: ${err.message}`)
      })
    }
  }

  stop(): void {
    const proc = this.proc
    const sourcemapProc = this.sourcemapProc
    if (proc || sourcemapProc) log.info("[rojo] stop requested")
    this.proc = null
    this.sourcemapProc = null
    this.projectPath = null

    if (proc && !proc.killed) proc.kill()
    if (sourcemapProc && !sourcemapProc.killed) sourcemapProc.kill()

    this.status = "stopped"
    this.notifyStatus()
  }

  getStatus(): RojoStatus {
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
      win.webContents.send("sync:status-changed", this.status, this.port, err)
    })
  }

}
