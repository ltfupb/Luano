import { ChildProcess } from "child_process"
import { spawnSidecar } from "./index"
import { BrowserWindow } from "electron"

export type RojoStatus = "stopped" | "starting" | "serving" | "error"

export class RojoManager {
  private proc: ChildProcess | null = null
  private sourcemapProc: ChildProcess | null = null
  private status: RojoStatus = "stopped"
  private projectPath: string | null = null

  serve(projectPath: string): void {
    this.stop()
    this.projectPath = projectPath
    this.status = "starting"
    this.notifyStatus()

    try {
      const sidecar = spawnSidecar("rojo", ["serve", "--address", "0.0.0.0"], {
        cwd: projectPath,
        onData: (data) => {
          this.status = "serving"
          this.notifyStatus()
          this.notifyLog(data)
          // 소스맵 watch 시작 (처음 serve 성공 시)
          this.startSourcemapWatch(projectPath)
        },
        onError: (data) => {
          this.notifyLog(`[stderr] ${data}`)
        }
      })

      this.proc = sidecar.process

      this.proc.on("exit", (code) => {
        // this.proc이 null이면 stop()이 의도적으로 호출된 것 — 무시
        if (this.proc === null) return
        this.status = code === 0 ? "stopped" : "error"
        this.notifyStatus()
        // 비정상 종료 시 2초 후 재시작
        if (code !== 0 && code !== null && this.projectPath) {
          setTimeout(() => this.serve(this.projectPath!), 2000)
        }
      })

      this.proc.on("error", (err) => {
        this.status = "error"
        this.notifyStatus()
        this.notifyLog(`[error] Rojo process error: ${err.message}`)
      })
    } catch (err) {
      this.status = "error"
      this.notifyStatus()
      const msg = err instanceof Error ? err.message : String(err)
      this.notifyLog(`[error] Failed to start Rojo: ${msg}`)
    }
  }

  private startSourcemapWatch(projectPath: string): void {
    if (this.sourcemapProc) return

    const sidecar = spawnSidecar("rojo", ["sourcemap", "--watch", "--output", "sourcemap.json"], {
      cwd: projectPath
    })
    this.sourcemapProc = sidecar.process
  }

  stop(): void {
    // null로 먼저 해제해서 exit 이벤트 핸들러가 재시작/error 처리 안 하도록
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

  private notifyStatus(): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("rojo:status-changed", this.status)
    })
  }

  private notifyLog(data: string): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("rojo:log", data)
    })
  }
}
