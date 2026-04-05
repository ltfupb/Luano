import { ipcMain, app } from "electron"
import { join } from "path"
import { existsSync, copyFileSync, mkdirSync } from "fs"
import { is } from "@electron-toolkit/utils"
import { hasFeature } from "../pro"
import {
  getBridgeToken, getBridgeTree, getBridgeLogs, isBridgeConnected,
  clearBridgeLogs, queueScript, getCommandResult,
  getConsoleOutput, isStudioConnected
} from "../pro/modules"
import { PRO_REQUIRED } from "./shared"

export function registerBridgeHandlers(): void {
  // ── Studio Bridge (legacy MCP) [Pro] ───────────────────────────────────────
  ipcMain.handle("studio:get-console", async () => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    return getConsoleOutput()
  })

  ipcMain.handle("studio:is-connected", async () => {
    if (!hasFeature("studio-bridge")) return false
    return isStudioConnected()
  })

  // ── Live Bridge [Pro] ─────────────────────────────────────────────────────
  ipcMain.handle("bridge:get-token", () => {
    return getBridgeToken()
  })
  ipcMain.handle("bridge:get-tree", () => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    return getBridgeTree()
  })
  ipcMain.handle("bridge:get-logs", () => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    return getBridgeLogs()
  })
  ipcMain.handle("bridge:is-connected", () => {
    return isBridgeConnected()
  })
  ipcMain.handle("bridge:clear-logs", () => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    clearBridgeLogs(); return { success: true }
  })
  ipcMain.handle("bridge:run-script", (_, code: string) => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    const id = queueScript(code)
    return { id }
  })
  ipcMain.handle("bridge:get-command-result", (_, id: string) => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    return getCommandResult(id)
  })

  // ── Plugin Install ─────────────────────────────────────────────────────────
  function getPluginsDir(): string | null {
    if (process.platform === "win32") {
      const localAppData = process.env["LOCALAPPDATA"] ?? join(app.getPath("home"), "AppData", "Local")
      return join(localAppData, "Roblox", "Plugins")
    }
    if (process.platform === "darwin") {
      return join(app.getPath("home"), "Library", "Application Support", "Roblox", "Plugins")
    }
    return null
  }

  ipcMain.handle("bridge:is-plugin-installed", () => {
    const dir = getPluginsDir()
    if (!dir) return false
    return existsSync(join(dir, "LuanoPlugin.lua"))
  })

  ipcMain.handle("bridge:install-plugin", () => {
    try {
      const pluginsDir = getPluginsDir()
      if (!pluginsDir) return { success: false, error: "Roblox Studio plugins not supported on this platform" }

      const resourcesDir = is.dev
        ? join(app.getAppPath(), "resources")
        : process.resourcesPath
      const srcPath = join(resourcesDir, "studio-plugin/LuanoPlugin.lua")

      if (!existsSync(pluginsDir)) {
        mkdirSync(pluginsDir, { recursive: true })
      }

      const destPath = join(pluginsDir, "LuanoPlugin.lua")
      copyFileSync(srcPath, destPath)
      return { success: true, path: destPath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
