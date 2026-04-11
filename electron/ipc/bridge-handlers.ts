import { ipcMain, app } from "electron"
import { join } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { is } from "@electron-toolkit/utils"
import { hasFeature } from "../pro"
import {
  getBridgeToken, getBridgeTree, getBridgeLogs, isBridgeConnected,
  clearBridgeLogs, queueScript, getCommandResult,
  getConsoleOutput, isStudioConnected
} from "../pro/modules"
import { log } from "../logger"
import { PRO_REQUIRED } from "./shared"

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

function getPluginSourcePath(): string {
  const resourcesDir = is.dev
    ? join(app.getAppPath(), "resources")
    : process.resourcesPath
  return join(resourcesDir, "studio-plugin/LuanoPlugin.lua")
}

function buildPluginSource(token: string): string {
  const src = readFileSync(getPluginSourcePath(), "utf8")
  // Replace the placeholder line so re-running the install never double-substitutes.
  return src.replace(
    /local LUANO_TOKEN\s*=\s*"[^"]*"/,
    `local LUANO_TOKEN    = "${token}"`
  )
}

/**
 * Rewrite the installed plugin file so it carries the current bridge token.
 * The token is persisted, but a plugin installed under a previous build (or
 * after userData was wiped) can hold a stale value and 403 on every report.
 * Studio hot-reloads plugin files on change, so this is transparent.
 * No-op if the plugin was never installed.
 */
export function refreshInstalledPluginToken(): void {
  try {
    const dir = getPluginsDir()
    if (!dir) return
    const dest = join(dir, "LuanoPlugin.lua")
    if (!existsSync(dest)) return
    const token = getBridgeToken()
    if (!token) return
    writeFileSync(dest, buildPluginSource(token), "utf8")
    log.info("[bridge] refreshed Studio plugin token")
  } catch (err) {
    log.warn("[bridge] failed to refresh plugin token", err)
  }
}

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
  ipcMain.handle("bridge:is-plugin-installed", () => {
    const dir = getPluginsDir()
    if (!dir) return false
    return existsSync(join(dir, "LuanoPlugin.lua"))
  })

  ipcMain.handle("bridge:install-plugin", () => {
    try {
      const pluginsDir = getPluginsDir()
      if (!pluginsDir) return { success: false, error: "Roblox Studio plugins not supported on this platform" }

      if (!existsSync(pluginsDir)) {
        mkdirSync(pluginsDir, { recursive: true })
      }

      const destPath = join(pluginsDir, "LuanoPlugin.lua")
      const token = getBridgeToken()
      writeFileSync(destPath, buildPluginSource(token), "utf8")
      return { success: true, path: destPath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
