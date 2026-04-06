/**
 * electron/toolchain/sync-manager.ts — Unified sync tool facade
 *
 * Delegates to RojoManager or ArgonManager based on the active tool config.
 */

import { RojoManager, type RojoStatus } from "../sidecar/rojo"
import { ArgonManager, type SyncStatus } from "./argon-manager"
import { getActiveTool } from "./config"

export class SyncManager {
  private rojoManager = new RojoManager()
  private argonManager = new ArgonManager()
  private activeManager: "rojo" | "argon" = "rojo"

  serve(projectPath: string): void {
    this.stopAll()
    const tool = getActiveTool("sync", projectPath) ?? "rojo"
    this.activeManager = tool as "rojo" | "argon"

    if (tool === "argon") {
      this.argonManager.serve(projectPath)
    } else {
      this.rojoManager.serve(projectPath)
    }
  }

  stop(): void {
    this.stopAll()
  }

  getStatus(): RojoStatus | SyncStatus {
    if (this.activeManager === "argon") return this.argonManager.getStatus()
    return this.rojoManager.getStatus()
  }

  getPort(): number | null {
    if (this.activeManager === "argon") return this.argonManager.getPort()
    return this.rojoManager.getPort()
  }

  getActiveTool(): string {
    return this.activeManager
  }

  private stopAll(): void {
    this.rojoManager.stop()
    this.argonManager.stop()
  }
}
