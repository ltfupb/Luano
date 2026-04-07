/**
 * electron/toolchain/argon-manager.ts — Argon sync tool manager
 *
 * Same interface as RojoManager but drives the Argon CLI.
 * Argon serves on a configurable address and generates sourcemaps.
 *
 * NOTE: Argon uses Rust's log framework, so all output (including
 * "Serving on: ..." messages) goes to stderr, not stdout.
 */

import { ChildProcess } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { spawnSidecar } from "../sidecar"
import { BrowserWindow } from "electron"

export type SyncStatus = "stopped" | "starting" | "running" | "error"

export class ArgonManager {
  private proc: ChildProcess | null = null
  private status: SyncStatus = "stopped"
  private projectPath: string | null = null
  private port: number | null = null
  private restartCount = 0
  private lastError: string | null = null

  serve(projectPath: string): void {
    this.stop()
    this.projectPath = projectPath

    if (!existsSync(join(projectPath, "default.project.json"))) {
      this.status = "stopped"
      this.notifyStatus()
      return
    }

    this.status = "starting"
    this.lastError = null
    this.notifyStatus()

    try {
      const sidecar = spawnSidecar("argon", ["serve", "--host", "127.0.0.1"], {
        cwd: projectPath,
        onData: (data) => this.handleOutput(data),
        onError: (data) => this.handleOutput(data)
      })

      this.proc = sidecar.process

      this.proc.on("exit", (code) => {
        if (this.proc === null) return
        this.status = code === 0 ? "stopped" : "error"
        this.notifyStatus()
        if (code !== 0 && code !== null && this.projectPath && this.restartCount < 3) {
          this.restartCount++
          const path = this.projectPath
          setTimeout(() => { if (this.projectPath === path) this.serve(path) }, 2000)
        }
      })

      this.proc.on("error", (err) => {
        this.status = "error"
        this.lastError = err.message
        this.notifyStatus()
      })
    } catch {
      this.status = "error"
      this.notifyStatus()
    }
  }

  private handleOutput(data: string): void {
    this.restartCount = 0
    const portMatch = data.match(/(?:port|localhost:|Serving on:\s*\S+:|:)(\d{4,5})/i)
    if (portMatch) this.port = parseInt(portMatch[1], 10)
    if (this.status !== "running") {
      this.status = "running"
    }
    this.notifyStatus()
  }

  stop(): void {
    const proc = this.proc
    this.proc = null
    this.projectPath = null

    if (proc && !proc.killed) proc.kill()

    this.status = "stopped"
    this.notifyStatus()
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
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("rojo:status-changed", this.status, this.port)
    })
  }
}
