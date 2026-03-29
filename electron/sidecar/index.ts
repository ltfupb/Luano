import { spawn, ChildProcess } from "child_process"
import { join } from "path"
import { existsSync } from "fs"
import { app } from "electron"
import { is } from "@electron-toolkit/utils"

export function getBinaryPath(name: string): string {
  const platform = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux"
  const ext = process.platform === "win32" ? ".exe" : ""

  if (is.dev) {
    return join(__dirname, "../../resources/binaries", platform, `${name}${ext}`)
  }
  return join(process.resourcesPath, "binaries", `${name}${ext}`)
}

export function validateBinary(name: string): void {
  const binPath = getBinaryPath(name)
  if (!existsSync(binPath)) {
    throw new Error(
      `Binary not found: ${name}\n` +
      `Path: ${binPath}\n` +
      `Ensure the binary for platform "${process.platform}" exists in resources/binaries/.`
    )
  }
}

export interface SidecarProcess {
  process: ChildProcess
  kill: () => void
}

export function spawnSidecar(
  binary: string,
  args: string[],
  options?: { cwd?: string; onData?: (data: string) => void; onError?: (data: string) => void }
): SidecarProcess {
  validateBinary(binary)
  const binPath = getBinaryPath(binary)
  const proc = spawn(binPath, args, {
    cwd: options?.cwd,
    stdio: ["pipe", "pipe", "pipe"]
  })

  proc.stdout?.on("data", (data) => options?.onData?.(data.toString()))
  proc.stderr?.on("data", (data) => options?.onError?.(data.toString()))

  return {
    process: proc,
    kill: () => {
      if (!proc.killed) proc.kill()
    }
  }
}
