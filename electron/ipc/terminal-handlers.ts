import { ipcMain, WebContents } from "electron"
import * as pty from "node-pty"

interface PtyEntry {
  proc: pty.IPty
  sender: WebContents
}
const ptyMap = new Map<string, PtyEntry>()

/** Kill all active PTY processes (called on app quit) */
export function cleanupPtys(): void {
  for (const [id, entry] of ptyMap) {
    try { entry.proc.kill() } catch { /* already dead */ }
    ptyMap.delete(id)
  }
}

function spawnPty(id: string, sender: WebContents, cwd?: string): void {
  const shell = process.platform === "win32" ? "powershell.exe" : (process.env["SHELL"] ?? "bash")
  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: cwd ?? process.env["HOME"] ?? process.cwd(),
    env: process.env as Record<string, string>
  })

  ptyMap.set(id, { proc, sender })

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
      const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      spawnPty(id, event.sender, cwd)
      return { id }
    } catch (err) {
      return { id: "", error: String(err) }
    }
  })

  ipcMain.handle("terminal:write", (_, id: string, data: string) => {
    ptyMap.get(id)?.proc.write(data)
    return { success: true }
  })

  ipcMain.handle("terminal:resize", (_, id: string, cols: number, rows: number) => {
    ptyMap.get(id)?.proc.resize(cols, rows)
    return { success: true }
  })

  ipcMain.handle("terminal:kill", (_, id: string) => {
    const entry = ptyMap.get(id)
    if (entry) {
      entry.proc.kill()
      ptyMap.delete(id)
    }
    return { success: true }
  })
}
