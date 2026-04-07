import { ChildProcess } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { spawnSidecar } from "./index"
import { BrowserWindow } from "electron"

export type RojoStatus = "stopped" | "starting" | "running" | "error"

export class RojoManager {
  private proc: ChildProcess | null = null
  private sourcemapProc: ChildProcess | null = null
  private status: RojoStatus = "stopped"
  private projectPath: string | null = null
  private port: number | null = null
  private restartCount = 0

  serve(projectPath: string): void {
    this.stop()
    this.projectPath = projectPath

    // Skip if no default.project.json
    if (!existsSync(join(projectPath, "default.project.json"))) {
      this.status = "stopped"
      this.notifyStatus()
      return
    }

    this.status = "starting"
    this.notifyStatus()

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
          }
          this.notifyStatus()
          this.startSourcemapWatch(projectPath)
        },
        onError: () => {}
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

      this.proc.on("error", () => {
        this.status = "error"
        this.notifyStatus()
      })
    } catch {
      this.status = "error"
      this.notifyStatus()
    }
  }

  private startSourcemapWatch(projectPath: string): void {
    if (this.sourcemapProc) return

    const sidecar = spawnSidecar("rojo", ["sourcemap", "default.project.json", "--watch", "--output", "sourcemap.json"], {
      cwd: projectPath
    })
    this.sourcemapProc = sidecar.process
  }

  stop(): void {
    const proc = this.proc
    const sourcemapProc = this.sourcemapProc
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

  private notifyStatus(): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("rojo:status-changed", this.status, this.port)
    })
  }

}
