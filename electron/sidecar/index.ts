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

// On Windows, child processes write stdout/stderr in the active console
// codepage (e.g. cp949 on Korean systems), not UTF-8. Decoding raw bytes
// with toString() (default UTF-8) garbles non-ASCII paths in log messages.
// Pick a codepage-aware decoder once at module load.
const decoder = ((): { decode: (b: Buffer) => string } => {
  if (process.platform !== "win32") return { decode: (b) => b.toString("utf-8") }
  // Map common Windows codepages from the LANG/LC_ALL env or system locale.
  // Electron ships full ICU so TextDecoder supports cp949/cp932/cp936/cp1252.
  const locale = (process.env.LANG || process.env.LC_ALL || Intl.DateTimeFormat().resolvedOptions().locale || "").toLowerCase()
  const cp = locale.startsWith("ko") ? "cp949"
    : locale.startsWith("ja") ? "shift_jis"
    : locale.startsWith("zh") ? "gbk"
    : "utf-8"
  try {
    const td = new TextDecoder(cp, { fatal: false })
    return { decode: (b) => td.decode(b) }
  } catch {
    return { decode: (b) => b.toString("utf-8") }
  }
})()

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

  proc.stdout?.on("data", (data: Buffer) => options?.onData?.(decoder.decode(data)))
  proc.stderr?.on("data", (data: Buffer) => options?.onError?.(decoder.decode(data)))

  return {
    process: proc,
    kill: () => {
      if (!proc.killed) proc.kill()
    }
  }
}
