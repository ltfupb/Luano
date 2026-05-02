import { ipcMain, app, dialog, BrowserWindow } from "electron"
import { join } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { is } from "@electron-toolkit/utils"
import { hasFeature } from "../pro"
import {
  getBridgeToken, getBridgeTree, getBridgeLogs, isBridgeConnected,
  clearBridgeLogs, queueScript, consumeCommandResult
} from "../pro/modules"
import { log } from "../logger"
import { PRO_REQUIRED, getCurrentProject } from "./shared"

// Keep in sync with MAX_SCRIPT_BYTES in electron/bridge/server.ts (1 MB).
// Duplicated here so we can reject oversized scripts BEFORE showing the
// user dialog, avoiding a silent failure when queueScript() throws afterward.
const MAX_SCRIPT_BYTES = 1 * 1024 * 1024 // 1 MB

// Track senders with an in-flight approval dialog. A renderer XSS could
// otherwise spam-flood concurrent bridge:run-script calls, queueing N modal
// dialogs. One per sender at a time.
const inflightApproval = new Set<number>()

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
  // Replace every LUANO_TOKEN assignment line — the /g flag matters because
  // any future plugin build with more than one occurrence (e.g. a comment
  // plus the real declaration) would otherwise leave a stale token in place.
  return src.replace(
    /local LUANO_TOKEN\s*=\s*"[^"]*"/g,
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
  // ── Live Bridge [Pro] ─────────────────────────────────────────────────────
  // Trust model: the bridge auth token gates every Studio plugin <-> app
  // request. The token is normally baked into the plugin source by
  // `bridge:install-plugin` and never needs to cross IPC back to the renderer.
  // This handler exists for the UI's "copy token" affordance (manual install
  // fallback) — display-only. It is therefore:
  //   (1) Gated behind the `studio-bridge` Pro feature, so Free builds never
  //       expose the token even if a buggy renderer asks.
  //   (2) Audit-logged on every call so any unexpected access in production
  //       is visible in logs / Sentry breadcrumbs.
  // If you add a renderer call site, confirm it actually needs the raw token
  // and is not an alternative that can be satisfied by a token hash.
  ipcMain.handle("bridge:get-token", async (event) => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    // H10: require explicit user confirmation before returning the raw token.
    // A renderer XSS or malicious extension calling api.bridgeGetToken() without
    // the user's knowledge could then pollute the bridge command queue or forge results.
    const senderWindow =
      BrowserWindow.fromWebContents(event.sender) ??
      BrowserWindow.getFocusedWindow() ??
      null
    const { response } = await dialog.showMessageBox(senderWindow ?? BrowserWindow.getAllWindows()[0], {
      type: "question",
      title: "Reveal Bridge Token?",
      message: "Show the Studio Bridge authentication token?",
      detail: "The token grants access to your live Roblox Studio session. Only approve if you initiated this action.",
      buttons: ["Show Token", "Cancel"],
      cancelId: 1,
      defaultId: 1,
    })
    if (response !== 0) return null
    log.info("[bridge] token read via IPC (bridge:get-token) — user confirmed")
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
  // bridge:run-script enqueues arbitrary Luau for live Studio execution.
  // Pass-4 finding CRITICAL #3: a compromised renderer (or AI tool output that
  // chains via markdown click into a renderer-side fetch) could enqueue
  // `game:GetService('DataStoreService'):GetDataStore('prod'):RemoveAsync('all')`
  // against the open game. The AI agent's `RunScript` tool routes through
  // requestToolApproval; this raw IPC sibling did not.
  //
  // Defenses (mirroring the AI tool's contract):
  //   1. Sender binding — `event.sender.isDestroyed()` rejected outright.
  //      Tracking the originating window for the confirm dialog parent ties
  //      the prompt to the renderer that asked.
  //   2. Project gate — refuse when no project is open. Without this, the
  //      sandbox identity is undefined and the user sees no clear action.
  //   3. Native confirm dialog — modal, blocking, OS-level. The user must
  //      explicitly approve before the script reaches `queueScript`.
  //      Auto-accept does not bypass this for raw IPC; the AI tool path is
  //      where autoAccept lives. A renderer-driven IPC call MUST get user
  //      consent every time.
  //   4. Code preview cap — clamp the dialog detail to 4 KB so a multi-MB
  //      payload doesn't blow up the dialog renderer or hide a small
  //      malicious tail.
  ipcMain.handle("bridge:run-script", async (event, code: string) => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    if (event.sender.isDestroyed()) {
      return { success: false, error: "sender destroyed" }
    }
    if (typeof code !== "string" || code.length === 0) {
      return { success: false, error: "Invalid script" }
    }
    if (!getCurrentProject()) {
      return { success: false, error: "No project is open" }
    }

    // Reject oversized scripts BEFORE showing the dialog so the user doesn't
    // approve something that queueScript() would silently throw on afterward.
    const codeBytes = Buffer.byteLength(code, "utf8")
    if (codeBytes > MAX_SCRIPT_BYTES) {
      return { success: false, error: `Script too large (${codeBytes} bytes > ${MAX_SCRIPT_BYTES})` }
    }

    // One approval dialog per sender at a time. A compromised renderer (or
    // a renderer XSS) could spam-flood concurrent bridge:run-script calls,
    // queueing N modal dialogs for the user to dismiss. Track the sender id
    // while the dialog is open and reject additional calls from the same sender.
    const senderId = event.sender.id
    if (inflightApproval.has(senderId)) {
      return { success: false, error: "Approval already in progress" }
    }
    inflightApproval.add(senderId)

    // Find the BrowserWindow that owns this sender so the dialog parents to
    // the right window. Falls back to the focused window if the sender is
    // attached but unowned (rare — view contents); falls back to null
    // (system-modal) if no window is found.
    const senderWindow =
      BrowserWindow.fromWebContents(event.sender) ??
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows()[0] ??
      null

    const PREVIEW_MAX = 4096
    const preview = code.length > PREVIEW_MAX
      ? code.slice(0, PREVIEW_MAX) + `\n… (${code.length - PREVIEW_MAX} more chars truncated)`
      : code

    const messageBoxOpts = {
      type: "warning" as const,
      title: "Run Studio script?",
      message: "Luano wants to execute Luau code in the live Roblox Studio session.",
      detail:
        "This runs against the game currently open in Studio and can call DataStore, Workspace, etc. " +
        "Approve only if you initiated this request.\n\n" +
        "--- script preview ---\n" +
        preview,
      buttons: ["Run script", "Cancel"],
      cancelId: 1,
      defaultId: 1,
      noLink: true
    }
    let choice: Awaited<ReturnType<typeof dialog.showMessageBox>>
    try {
      choice = senderWindow
        ? await dialog.showMessageBox(senderWindow, messageBoxOpts)
        : await dialog.showMessageBox(messageBoxOpts)
    } finally {
      inflightApproval.delete(senderId)
    }

    // Re-check sender liveness after the await — the dialog may have been
    // open long enough for the renderer to die. Also re-check Pro feature
    // (license could have lapsed mid-prompt, though unlikely).
    if (event.sender.isDestroyed()) {
      return { success: false, error: "sender destroyed" }
    }
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    if (choice.response !== 0) {
      log.info("[bridge:run-script] user denied")
      return { success: false, error: "User denied" }
    }
    log.info("[bridge:run-script] user approved", { bytes: code.length })
    const id = queueScript(code)
    return { id }
  })
  ipcMain.handle("bridge:get-command-result", (_, id: string) => {
    if (!hasFeature("studio-bridge")) return PRO_REQUIRED("studio-bridge")
    return consumeCommandResult(id)
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
      log.warn("[bridge] plugin install failed:", err)
      return { success: false, error: String(err) }
    }
  })
}
