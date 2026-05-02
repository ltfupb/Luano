import { ipcMain, WebContents } from "electron"
import { randomUUID } from "crypto"
import { delimiter } from "path"
import * as pty from "node-pty"
import { getCurrentProject, requireInProject } from "./shared"
import { getUserBinDir } from "../sidecar"

interface PtyEntry {
  proc: pty.IPty
  sender: WebContents
  senderId: number
}
const ptyMap = new Map<string, PtyEntry>()

// Max concurrent PTYs a single WebContents can own. 4 covers an ambitious
// split-pane terminal layout; beyond that the renderer is probably leaking
// or being driven by a compromised pane. Counting by sender.id keeps other
// windows unaffected.
const MAX_PTYS_PER_SENDER = 4
// Max bytes a single terminal:write may carry. 64 KB is >> any interactive
// shell command; large pastes are usually a sign of runaway scripted input
// (AI tool output, etc.).
const MAX_WRITE_BYTES = 64 * 1024
// Terminal geometry bounds. Negative / zero values are invalid for the PTY;
// a 1023×1023 grid is already an absurd upper bound for a real terminal
// (xterm.js on a 4K monitor is maybe 200 cols × 100 rows). A huge value
// could trigger pathological allocations in node-pty's ConPTY backing.
const MAX_COLS = 1024
const MAX_ROWS = 1024

/**
 * Whitelist of environment variables the PTY inherits. Passing the full
 * `process.env` leaks Luano-internal secrets (API keys read from keychain,
 * Sentry DSN, etc.) into any subprocess the user starts. Only pass the
 * minimum needed for a usable shell.
 */
const ENV_WHITELIST = [
  "PATH", "HOME", "USERPROFILE", "TMP", "TEMP", "LANG", "LC_ALL", "TERM",
  "USER", "USERNAME", "SHELL", "COMSPEC", "SYSTEMROOT", "WINDIR",
  "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"
] as const

function buildPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ENV_WHITELIST) {
    const v = process.env[key]
    if (typeof v === "string") env[key] = v
  }
  // Prepend the toolchain bin dir to PATH so the user can invoke tools (rojo,
  // wally, pesde, selene, stylua, luau-lsp) from the integrated terminal —
  // otherwise the binaries Luano fetched on demand would only be reachable
  // through the IPC handlers, not by typing the command name.
  const toolBin = getUserBinDir()
  env["PATH"] = env["PATH"] ? `${toolBin}${delimiter}${env["PATH"]}` : toolBin
  return env
}

/** Kill all active PTY processes (called on app quit) */
export function cleanupPtys(): void {
  for (const [id, entry] of ptyMap) {
    try { entry.proc.kill() } catch { /* already dead */ }
    ptyMap.delete(id)
  }
}

function spawnPty(id: string, sender: WebContents, cwd: string): void {
  const shell = process.platform === "win32" ? "powershell.exe" : (process.env["SHELL"] ?? "bash")
  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: buildPtyEnv()
  })

  ptyMap.set(id, { proc, sender, senderId: sender.id })

  proc.onData((data) => {
    if (!sender.isDestroyed()) {
      sender.send(`terminal:data:${id}`, data)
    }
  })

  proc.onExit(() => {
    ptyMap.delete(id)
    if (!sender.isDestroyed()) {
      sender.send(`terminal:exit:${id}`)
    }
  })
}

export function registerTerminalHandlers(): void {
  ipcMain.handle("terminal:create", (event, cwd?: string) => {
    try {
      const project = getCurrentProject()
      if (!project) {
        return { id: "", error: "No project open — terminal requires an open project" }
      }
      // Per-sender quota: count how many PTYs this WebContents already owns.
      // Over-limit → refuse without spawning. Keeps a compromised renderer
      // from exhausting process handles / memory by opening PTYs in a loop.
      const senderId = event.sender.id
      let owned = 0
      for (const entry of ptyMap.values()) {
        if (entry.senderId === senderId) owned++
      }
      if (owned >= MAX_PTYS_PER_SENDER) {
        return { id: "", error: `terminal limit reached (${MAX_PTYS_PER_SENDER} per window)` }
      }
      // Default to the project root if no cwd supplied or the renderer sent
      // an empty string. Any caller-supplied cwd must resolve inside the
      // project — blocks renderer-side attempts to spawn a shell at /,
      // $HOME, or any other unrelated filesystem location.
      //
      // `requireInProject` returns the canonical (symlink-resolved) path so
      // the PTY's cwd is referentially identical to what we validated — a
      // raw renderer string could still contain symlink segments that
      // resolve outside after we'd already approved it.
      const rawCwd = typeof cwd === "string" && cwd.length > 0 ? cwd : project
      let safeCwd: string
      try {
        safeCwd = requireInProject(rawCwd)
      } catch (err) {
        return { id: "", error: (err as Error).message }
      }
      const id = `term-${randomUUID()}`
      spawnPty(id, event.sender, safeCwd)
      return { id }
    } catch (err) {
      return { id: "", error: String(err) }
    }
  })

  ipcMain.handle("terminal:write", (event, id: string, data: string) => {
    // Drop writes from a destroyed sender outright — the renderer is gone,
    // we can't deliver `terminal:data` events back, and a destroyed sender
    // shouldn't be able to push commands into a live PTY.
    if (event.sender.isDestroyed()) return { success: false, error: "sender destroyed" }
    const entry = ptyMap.get(id)
    if (!entry) return { success: false, error: "unknown terminal" }
    // Sender-id reuse defense-in-depth: numeric WebContents ids can in theory
    // be reclaimed by a future renderer if the original was destroyed without
    // its PTY being reaped. Treat a stored sender that's now destroyed as
    // an orphaned slot — clean it up and refuse the write. The legitimate
    // owner can no longer be the caller (they're destroyed), so a new sender
    // claiming the same numeric id must NOT inherit the PTY.
    if (entry.sender.isDestroyed()) {
      try { entry.proc.kill() } catch { /* already dead */ }
      ptyMap.delete(id)
      return { success: false, error: "terminal owner gone" }
    }
    if (entry.senderId !== event.sender.id) {
      return { success: false, error: "sender mismatch" }
    }
    if (typeof data !== "string") {
      return { success: false, error: "invalid data" }
    }
    // Size cap: reject any single write larger than MAX_WRITE_BYTES.
    // Measured in UTF-8 bytes (Buffer.byteLength) so multi-byte chars count
    // accurately.
    if (Buffer.byteLength(data, "utf8") > MAX_WRITE_BYTES) {
      return { success: false, error: "write too large" }
    }
    entry.proc.write(data)
    return { success: true }
  })

  ipcMain.handle("terminal:resize", (event, id: string, cols: number, rows: number) => {
    if (event.sender.isDestroyed()) return { success: false, error: "sender destroyed" }
    const entry = ptyMap.get(id)
    if (!entry) return { success: false, error: "unknown terminal" }
    if (entry.sender.isDestroyed()) {
      try { entry.proc.kill() } catch { /* already dead */ }
      ptyMap.delete(id)
      return { success: false, error: "terminal owner gone" }
    }
    if (entry.senderId !== event.sender.id) {
      return { success: false, error: "sender mismatch" }
    }
    // Bound the geometry: positive integers only, both dimensions under
    // MAX_COLS/MAX_ROWS. Non-finite / NaN / negative / zero all rejected.
    if (
      typeof cols !== "number" || typeof rows !== "number" ||
      !Number.isFinite(cols) || !Number.isFinite(rows) ||
      cols <= 0 || rows <= 0 ||
      cols >= MAX_COLS || rows >= MAX_ROWS
    ) {
      return { success: false, error: "invalid size" }
    }
    entry.proc.resize(Math.floor(cols), Math.floor(rows))
    return { success: true }
  })

  ipcMain.handle("terminal:kill", (event, id: string) => {
    if (event.sender.isDestroyed()) return { success: false, error: "sender destroyed" }
    const entry = ptyMap.get(id)
    if (!entry) return { success: false, error: "unknown terminal" }
    if (entry.sender.isDestroyed()) {
      try { entry.proc.kill() } catch { /* already dead */ }
      ptyMap.delete(id)
      return { success: true }
    }
    if (entry.senderId !== event.sender.id) {
      return { success: false, error: "sender mismatch" }
    }
    entry.proc.kill()
    ptyMap.delete(id)
    return { success: true }
  })
}
