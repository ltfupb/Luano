import { ChildProcess } from "child_process"
import { spawnSidecar } from "../sidecar/index"
import { LspBridge } from "./bridge"
import { join } from "path"
import { is } from "@electron-toolkit/utils"

export class LspManager {
  private proc: ChildProcess | null = null
  private bridge: LspBridge | null = null
  private projectPath: string | null = null
  readonly port = 6008

  async start(projectPath: string): Promise<void> {
    await this.stop()
    this.projectPath = projectPath

    const typeDefsPath = is.dev
      ? join(__dirname, "../../resources/type-defs/globalTypes.d.luau")
      : join(process.resourcesPath, "type-defs/globalTypes.d.luau")

    const sourcemapPath = join(projectPath, "sourcemap.json")

    try {
      const sidecar = spawnSidecar(
        "luau-lsp",
        ["lsp", `--definitions=${typeDefsPath}`, `--sourcemap=${sourcemapPath}`],
        { cwd: projectPath }
      )

      this.proc = sidecar.process

      // stdio ↔ WebSocket 브릿지 시작
      this.bridge = new LspBridge(this.proc, this.port)
      await this.bridge.start()

      this.proc.on("exit", (code) => {
        if (code !== 0 && code !== null && this.projectPath) {
          setTimeout(() => this.start(this.projectPath!).catch(console.error), 2000)
        }
      })

      this.proc.on("error", (err) => {
        console.error("[LspManager] Process error:", err.message)
        if (this.projectPath) {
          setTimeout(() => this.start(this.projectPath!).catch(console.error), 2000)
        }
      })
    } catch (err) {
      console.error("[LspManager] Failed to start luau-lsp:", err)
      throw err
    }
  }

  async stop(): Promise<void> {
    this.bridge?.stop()
    if (this.proc && !this.proc.killed) {
      this.proc.kill()
    }
    this.proc = null
    this.bridge = null
  }

  getPort(): number {
    return this.port
  }
}
