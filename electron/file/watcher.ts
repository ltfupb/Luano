import chokidar, { FSWatcher } from "chokidar"
import { BrowserWindow } from "electron"
import { lintFile } from "../sidecar/selene"
import { formatFile } from "../sidecar/stylua"
import { join } from "path"

let watcher: FSWatcher | null = null
const debounceTimers: Map<string, NodeJS.Timeout> = new Map()

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
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("file:deleted", filePath)
    })
  })
}

async function handleFileChange(filePath: string, projectRoot: string): Promise<void> {
  try {
    // StyLua format
    await formatFile(filePath)
  } catch (err) {
    console.warn("[Watcher] StyLua format failed:", err)
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send("sidecar:error", { tool: "stylua", message: String(err) })
    )
  }

  try {
    // Selene lint
    const diagnostics = await lintFile(filePath, projectRoot)

    // Send results to renderer
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("lint:diagnostics", { file: filePath, diagnostics })
    })
  } catch (err) {
    console.warn("[Watcher] Selene lint failed:", err)
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send("sidecar:error", { tool: "selene", message: String(err) })
    )
  }
}

export function stopWatcher(): void {
  debounceTimers.forEach((t) => clearTimeout(t))
  debounceTimers.clear()
  watcher?.close()
  watcher = null
}
