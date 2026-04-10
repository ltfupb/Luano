import { spawn, ChildProcess } from "child_process"
import { join, dirname } from "path"
import { existsSync } from "fs"
import { is } from "@electron-toolkit/utils"
import { app } from "electron"

/** Walk up from __dirname to find project root (where package.json lives).
 *  Works regardless of output structure (flat bundle or preserveModules). */
function resolveProjectRoot(): string {
  let dir = __dirname
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir
    dir = dirname(dir)
  }
  return __dirname
}

/** Resolve any path under resources/ — works in both dev and production */
export function getResourcePath(...segments: string[]): string {
  if (is.dev) {
    return join(resolveProjectRoot(), "resources", ...segments)
  }
  return join(process.resourcesPath, ...segments)
}

/** Directory for on-demand downloaded binaries (always writable) */
export function getUserBinDir(): string {
  return join(app.getPath("userData"), "binaries")
}

export function getBinaryPath(name: string): string {
  const ext = process.platform === "win32" ? ".exe" : ""
  return join(getUserBinDir(), `${name}${ext}`)
}

export function isBinaryAvailable(name: string): boolean {
  return existsSync(getBinaryPath(name))
}

export function validateBinary(name: string): void {
  const binPath = getBinaryPath(name)
  if (!existsSync(binPath)) {
    throw new Error(
      `Binary not found: ${name}\n` +
      `Path: ${binPath}\n` +
      `Install it via Settings → Toolchain.`
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
