import chokidar, { FSWatcher } from "chokidar"
import { BrowserWindow } from "electron"
import { lintFile } from "../sidecar/selene"
import { formatFile } from "../sidecar/stylua"
import { isBinaryAvailable } from "../sidecar"
import { join } from "path"
import { getActiveTool } from "../toolchain/config"
import { log } from "../logger"

let watcher: FSWatcher | null = null
const debounceTimers: Map<string, NodeJS.Timeout> = new Map()

// Per-tool sidecar:error coalescing. If the linter/formatter crashes on
// every save (e.g. bad config file), we'd otherwise flood the renderer
// with one IPC event per save. Collapse bursts into one event every 2s
// per tool name, keeping the latest message.
const SIDECAR_ERROR_DEBOUNCE_MS = 2000
interface PendingSidecarError { message: string; timer: NodeJS.Timeout }
const sidecarErrorTimers: Map<string, PendingSidecarError> = new Map()

export function emitSidecarError(tool: string, message: string): void {
  const existing = sidecarErrorTimers.get(tool)
  if (existing) {
    // Collapse: just update the stored message. Do NOT reset the timer —
    // we want the flush to happen on a predictable cadence.
    existing.message = message
    return
  }
  const pending: PendingSidecarError = {
    message,
    timer: setTimeout(() => {
      const final = sidecarErrorTimers.get(tool)
      sidecarErrorTimers.delete(tool)
      if (!final) return
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send("sidecar:error", { tool, message: final.message })
      )
    }, SIDECAR_ERROR_DEBOUNCE_MS)
  }
  sidecarErrorTimers.set(tool, pending)
}

export function watchProject(projectPath: string): void {
  stopWatcher()

  watcher = chokidar.watch(join(projectPath, "src"), {
    ignored: /(^|[/\\])\../, // Ignore dotfiles
    persistent: true,
    ignoreInitial: true
  })

  watcher.on("change", (filePath) => {
    if (!filePath.match(/\.(lua|luau)$/)) return

    // 300ms debounce
    const existing = debounceTimers.get(filePath)
    if (existing) clearTimeout(existing)

    debounceTimers.set(
      filePath,
      setTimeout(async () => {
        debounceTimers.delete(filePath)
        await handleFileChange(filePath, projectPath)
      }, 300)
    )
  })

  watcher.on("add", (filePath) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("file:added", filePath)
    })
  })

  watcher.on("unlink", (filePath) => {
    // Clear any pending debounce for the deleted file
    const pending = debounceTimers.get(filePath)
    if (pending) {
      clearTimeout(pending)
      debounceTimers.delete(filePath)
    }
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("file:deleted", filePath)
    })
  })

  watcher.on("error", (err) => {
    log.warn("[Watcher] FSWatcher error:", err)
  })
}

async function handleFileChange(filePath: string, projectRoot: string): Promise<void> {
  // Gate on binary availability — without this, every save on a project with
  // the formatter/linter selected but the binary not yet downloaded throws
  // "Binary not found" through spawnSidecar, spamming the log and the
  // renderer's sidecar-error toast on every keystroke save.
  const formatter = getActiveTool("formatter", projectRoot)
  if (formatter === "stylua" && isBinaryAvailable("stylua")) {
    try {
      await formatFile(filePath)
    } catch (err) {
      log.warn("[Watcher] StyLua format failed:", err)
      emitSidecarError("stylua", String(err))
    }
  }

  const linter = getActiveTool("linter", projectRoot)
  if (linter === "selene" && isBinaryAvailable("selene")) {
    try {
      const diagnostics = await lintFile(filePath, projectRoot)
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("lint:diagnostics", { file: filePath, diagnostics })
      })
    } catch (err) {
      log.warn("[Watcher] Selene lint failed:", err)
      emitSidecarError("selene", String(err))
    }
  }
}

export function stopWatcher(): void {
  debounceTimers.forEach((t) => clearTimeout(t))
  debounceTimers.clear()
  sidecarErrorTimers.forEach((p) => clearTimeout(p.timer))
  sidecarErrorTimers.clear()
  watcher?.close()
  watcher = null
}
