import { ipcMain, dialog, app, shell } from "electron"
import { join, basename, extname } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, statSync, realpathSync, unlinkSync, renameSync } from "fs"
import { homedir } from "os"
import { resolve as pathResolve, normalize } from "path"
import { is } from "@electron-toolkit/utils"
import { syncManager, lspManager } from "../main"
import { readDir, readFile, writeFile, createFile, createFolder, renameEntry, deleteEntry, moveEntry, initProject, ensureLintConfig } from "../file/project"
import { watchProject, stopWatcher } from "../file/watcher"
import { cleanupPtys } from "./terminal-handlers"
import { lintFile } from "../sidecar/selene"
import { formatFile } from "../sidecar/stylua"
import { runWally } from "../sidecar/wally"
import { runPesde } from "../sidecar/pesde"
import { isBinaryAvailable } from "../sidecar"
import { parseWallyToml, buildPesdeToml } from "../file/wally-migration"
import { hasFeature } from "../pro"
import {
  analyzeTopology, analyzeCrossScript,
  performanceLint, performanceLintFile,
  loadSchemas, addSchema, deleteSchema, generateDataModule, generateMigration,
  recordDiff,
  telemetryEnabled, setTelemetry, telemetryStats,
  type DataStoreSchema,
  clearLastCheckpoint,
  forceResetSessionState
} from "../pro/modules"
import { aiGeneratedFiles, PRO_REQUIRED, collectLuauFiles, setCurrentProject, getCurrentProject, requireInProject, requireMatchesCurrentProject, canonicalizeProjectRoot } from "./shared"
import { validateSchemaIdentifiers } from "../datastore/schema"
import { log } from "../logger"
import { store } from "../store"
import { isPro } from "../pro"
import { activateLicense, deactivateLicense, getLicenseInfo, validateLicense as revalidateLicense } from "../pro/license"
import { getToolchainConfig, getActiveTool, setProjectTool, setGlobalDefault, isMinimumToolchainReady, hasProjectConfig, initProjectConfig } from "../toolchain/config"
// C2 + M11: abortAgent to cancel any running session on project switch.
// clearLastCheckpoint is exported from pro/modules (wraps agent._lastCheckpoint).
import { abortAgent } from "../ai/provider"
import { downloadTool, downloadMultiple, getDownloadStatus, removeTool, checkToolUpdates, updateTool, fetchToolMetadata } from "../toolchain/downloader"
import { TOOL_REGISTRY, CATEGORIES, type ToolCategory } from "../toolchain/registry"

/**
 * Parse a CC-style skill .md file:
 *   ---
 *   name: Refactor
 *   description: Refactor selected code
 *   ---
 *   Prompt body, with {selection} and {file} templating.
 *
 * Missing fields fall back to the filename (minus .md) for the command.
 * Returns null only if the file is completely empty.
 * Tolerates CRLF line endings — authored on Windows is common.
 */
function parseMarkdownSkill(raw: string, filename: string): {
  command: string
  label: string
  description: string
  prompt: string
  custom: boolean
} | null {
  // Normalize CRLF so the frontmatter regex matches Windows-authored files.
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const base = basename(filename, extname(filename))
  const meta: Record<string, string> = {}
  let body = normalized
  if (fmMatch) {
    body = fmMatch[2]
    for (const line of fmMatch[1].split("\n")) {
      const idx = line.indexOf(":")
      if (idx <= 0) continue
      const k = line.slice(0, idx).trim().toLowerCase()
      const v = line.slice(idx + 1).trim()
      if (k) meta[k] = v
    }
  }
  body = body.trim()
  if (!body) return null
  const name = meta.name || base
  return {
    command: "/" + (meta.command || base).replace(/^\//, ""),
    label: name,
    description: meta.description || "",
    prompt: body,
    custom: true
  }
}

export function registerProjectHandlers(): void {
  // ── Pro Status ──────────────────────────────────────────────────────────────
  ipcMain.handle("pro:status", () => ({
    isPro: isPro(),
    features: {
      agent: hasFeature("agent"),
      inlineEdit: hasFeature("inline-edit"),
      rag: hasFeature("rag"),
      studioBridge: hasFeature("studio-bridge"),
      crossScript: hasFeature("cross-script"),
      perfLint: hasFeature("perf-lint"),
      datastoreSchema: hasFeature("datastore-schema"),
      skills: hasFeature("skills")
    }
  }))

  // ── License ──────────────────────────────────────────────────────────────
  ipcMain.handle("license:activate", async (_, key: string) => {
    const result = await activateLicense(key)
    const { clearManagedClient } = await import("../ai/provider")
    clearManagedClient()
    return result
  })
  ipcMain.handle("license:deactivate", async () => {
    const result = await deactivateLicense()
    const { clearManagedClient } = await import("../ai/provider")
    clearManagedClient()
    return result
  })
  ipcMain.handle("license:info", () => getLicenseInfo())
  ipcMain.handle("license:validate", async () => ({ valid: await revalidateLicense() }))

  // ── Project ──────────────────────────────────────────────────────────────
  // Paths returned by `project:open-folder` are user-picked (OS dialog) and
  // therefore trusted to be used as a new project root. We record the
  // *canonical* (realpath'd) path so `project:open`/`project:init` can confirm
  // their argument resolves to the same real directory — not a forged path or
  // a symlink swapped in between the picker closing and the follow-up call.
  //
  // Implementation note: stored as a `Map<canonical, insertedAt>` so we can
  // (a) cap the size with FIFO eviction (renderer crashes / cancelled flows
  // would otherwise grow the set unboundedly), and (b) preserve the existing
  // one-shot consume semantics. Iterating insertion order on Map is part of
  // the JS spec, so the oldest entry is always Map.keys().next().
  const DIALOG_PATHS_MAX = 32
  const dialogConfirmedPaths = new Map<string, number>()

  function recordDialogPath(canonical: string): void {
    // Refresh insertion order so a re-pick of the same path moves to "newest".
    if (dialogConfirmedPaths.has(canonical)) dialogConfirmedPaths.delete(canonical)
    dialogConfirmedPaths.set(canonical, Date.now())
    while (dialogConfirmedPaths.size > DIALOG_PATHS_MAX) {
      const oldest = dialogConfirmedPaths.keys().next().value
      if (oldest === undefined) break
      dialogConfirmedPaths.delete(oldest)
    }
  }

  /**
   * Atomic check-and-consume: if `canonical` is in the confirmed set, remove
   * it (one-shot) and return true. If not, return false. The remove-on-lookup
   * pattern means a failed `project:open` can't leave a replayable entry —
   * see `project:open` for the rollback flow that re-records on failure.
   */
  function consumeDialogPath(canonical: string): boolean {
    return dialogConfirmedPaths.delete(canonical)
  }

  // Persistent trust allowlist: canonical paths the user has previously
  // opened legitimately (via the OS dialog flow). Recent-projects clicks
  // resolve to a path that's no longer in dialogConfirmedPaths (that set
  // is one-shot, in-memory) and isn't the current project either, so
  // without this third gate every recent-list click would be refused.
  //
  // Security property preserved: only paths a previous successful
  // project:open recorded land here. A compromised renderer cannot forge
  // entries — populating this set requires going through the full open
  // path, which itself requires a dialog-confirmed entry the first time.
  // Subsequent re-opens are then trusted indefinitely (until the user
  // explicitly clears it via removeRecent on the renderer, or until FIFO
  // eviction at the cap).
  const TRUSTED_PROJECTS_KEY = "trustedProjectPaths"
  const TRUSTED_PROJECTS_MAX = 50
  // Populated below after canonicalizeDialogPath is defined, so that store
  // entries can be validated (canonicalizeDialogPath rejects non-existent
  // dirs, symlinks, and UNC paths — preventing a tampered config.json from
  // auto-trusting bogus roots).
  const trustedProjectPaths: string[] = []

  function isTrustedProject(canonical: string): boolean {
    return trustedProjectPaths.includes(canonical)
  }

  function recordTrustedProject(canonical: string): void {
    // Move-to-end semantics: a re-open refreshes recency so the FIFO
    // eviction at the cap drops genuinely-stale entries first.
    const idx = trustedProjectPaths.indexOf(canonical)
    if (idx !== -1) trustedProjectPaths.splice(idx, 1)
    trustedProjectPaths.push(canonical)
    while (trustedProjectPaths.length > TRUSTED_PROJECTS_MAX) {
      trustedProjectPaths.shift()
    }
    try { store.set(TRUSTED_PROJECTS_KEY, trustedProjectPaths) } catch (err) {
      log.warn("[project:trust] persistence failed", err)
    }
  }

  /** Remove a canonical path from the persistent trust allowlist. */
  function removeTrustedProject(canonical: string): void {
    const idx = trustedProjectPaths.indexOf(canonical)
    if (idx !== -1) {
      trustedProjectPaths.splice(idx, 1)
      try { store.set(TRUSTED_PROJECTS_KEY, trustedProjectPaths) } catch (err) {
        log.warn("[project:trust] persistence failed on remove", err)
      }
    }
  }

  /**
   * Canonicalize a path for dialog comparison. Rejects symlinks / reparse
   * points at the leaf AND at every ancestor so a local attacker can't swap
   * a confirmed directory (or any of its parents) for a symlink pointing at
   * `/` or `~/.ssh` after the picker closes. Returns null if the path
   * doesn't exist, isn't a real directory, contains a symlinked ancestor,
   * or can't be realpath'd.
   *
   * Pass-4 finding HIGH #6: previous version only lstat'd the leaf.
   * `C:\Users\me\projs\proj` where `projs` is a symlink to elsewhere passed
   * the leaf check then realpath rewrote the project root to the linked
   * target — silent sandbox redirect.
   */
  function canonicalizeDialogPath(p: string): string | null {
    try {
      if (typeof p !== "string" || p.length === 0) return null
      // Reject UNC paths (\\server\share) on Windows. The ancestor walk below
      // terminates at pathResolve(cursor, "..") === cursor, which happens at
      // the UNC root (\\server\share) rather than at a true drive root — the
      // share component itself is skipped. Rather than adding a fragile
      // component-by-component realpath comparison for UNC, we simply refuse
      // them. Network share projects are unsupported; document the limitation.
      // Note: on non-Windows platforms this check is a no-op (no UNC paths).
      if (process.platform === "win32" && p.startsWith("\\\\")) return null
      // lstat the leaf first — fast reject for a symlinked target.
      const st = lstatSync(p)
      if (st.isSymbolicLink() || !st.isDirectory()) return null
      // Walk every ancestor. If any one is a symlink (whose realpath would
      // diverge from the input components), refuse. We could instead compare
      // realpath-component-by-component, but rejecting any symlinked ancestor
      // is a stricter, simpler invariant that also matches the
      // `assertNoEscapingSymlink` defense in file/sandbox.ts.
      let cursor = p
      while (true) {
        const parent = pathResolve(cursor, "..")
        if (parent === cursor) break  // hit filesystem root
        try {
          const ps = lstatSync(parent)
          if (ps.isSymbolicLink()) return null
        } catch {
          // Ancestor doesn't exist or is unreadable — stop walking. We've
          // already lstat'd every existing ancestor below this point.
          break
        }
        cursor = parent
      }
      const realp = realpathSync.native(p)
      // C1: NTFS junctions (and macOS firmlinks) resolve through realpathSync
      // but lstatSync().isSymbolicLink() returns false for them. Detect by
      // comparing the realpath against the normalized-resolved input. If they
      // differ (case-insensitive on Windows), the path contains a junction or
      // similar reparse point — reject to prevent sandbox root redirection.
      const normalized = normalize(pathResolve(p))
      const same = process.platform === "win32"
        ? realp.toLowerCase() === normalized.toLowerCase()
        : realp === normalized
      if (!same) return null
      return realp
    } catch {
      return null
    }
  }

  // Load persisted trust allowlist now that canonicalizeDialogPath is
  // available. Each stored path is re-validated: entries that no longer
  // exist, are symlinks, or are UNC paths are silently dropped. This
  // prevents a tampered config.json with bogus roots (e.g. "/etc", "C:\\")
  // from auto-trusting arbitrary filesystem locations.
  void (() => {
    const raw = store.get<unknown>(TRUSTED_PROJECTS_KEY)
    if (!Array.isArray(raw)) return
    const seen = new Set<string>()
    for (const v of raw) {
      if (typeof v !== "string" || !v) continue
      const canonical = canonicalizeDialogPath(v)
      if (canonical && !seen.has(canonical)) {
        seen.add(canonical)
        trustedProjectPaths.push(canonical)
      }
    }
    // Apply FIFO cap (keep most-recent MAX entries).
    while (trustedProjectPaths.length > TRUSTED_PROJECTS_MAX) {
      trustedProjectPaths.shift()
    }
  })()

  ipcMain.handle("project:open-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] })
    if (result.canceled || result.filePaths.length === 0) return null
    const picked = result.filePaths[0]
    // Store the canonical realpath so forged retries with a symlink swapped in
    // compare unequal. If the picked path can't be canonicalized (user picked
    // a deleted/inaccessible dir, or a symlink), refuse — treat as no pick.
    const canonical = canonicalizeDialogPath(picked)
    if (!canonical) return null
    recordDialogPath(canonical)
    return picked
  })

  ipcMain.handle("project:open", async (_, projectPath: string) => {
    // Foundational sandbox gate: `setCurrentProject` defines the trust boundary
    // that every `requireInProject`/`requireMatchesCurrentProject` call above
    // depends on. If a compromised renderer could hand in an arbitrary
    // `projectPath` here, it could redefine the project root to `C:\` or
    // `/home/user` and then reach every "in-project" handler for arbitrary
    // disk access.
    //
    // Three legitimate entry points, matching `project:init`:
    //   (1) path was just returned by `project:open-folder` (OS dialog), OR
    //   (2) path equals the currently-open project (re-open / reload), OR
    //   (3) path is in the persistent trusted-projects allowlist (a path
    //       this user has previously opened successfully — the recent-list
    //       click flow). The list is populated only by successful past opens;
    //       a compromised renderer cannot insert arbitrary entries.
    // Everything else is refused.
    //
    // TOCTOU hardening: re-canonicalize the incoming path via realpath + lstat
    // and compare against the stored canonical. A local attacker who replaced
    // `projectPath` (or a component of it) with a symlink after the picker
    // closed will fail this check — the stored canonical was captured before
    // the race window, and the fresh realpath resolves through the new link.
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      return { success: false, error: "Invalid path" }
    }
    // M11 + C2: abort any running agent session and clear its checkpoint BEFORE
    // switching the project root. Without this, the old session continues writing
    // to files that are now outside the new sandbox, and reverts after the switch
    // operate on the previous project's paths.
    abortAgent()
    // M1: forceResetSessionState clears _agentRunning / sender-id / abort
    // controller synchronously so a rapid project switch doesn't leave the
    // session flagged as "already running" until the async finally resolves.
    forceResetSessionState()
    clearLastCheckpoint()

    const canonicalTarget = canonicalizeDialogPath(projectPath)
    const current = getCurrentProject()
    const canonicalCurrent = current ? canonicalizeDialogPath(current) : null
    const isCurrent = canonicalCurrent !== null && canonicalTarget === canonicalCurrent
    const isTrusted = canonicalTarget !== null && isTrustedProject(canonicalTarget)

    // Atomic consume: removes the entry from the confirmed set on lookup so a
    // failed open below can't leave a replayable entry. If the open succeeds
    // we keep it consumed; if it fails (and the path was dialog-confirmed) we
    // re-record it so the user's *next* `project:open` call still works
    // without forcing them through the picker again.
    //
    // Skip consume when isCurrent OR isTrusted: a legitimate re-open of the
    // current project or a recent-list click must not silently exhaust the
    // dialog entry. Rollback re-records only on error, so consuming early
    // on those paths would lose the entry for free.
    const wasFromDialog = !isCurrent && !isTrusted && canonicalTarget !== null && consumeDialogPath(canonicalTarget)
    if (!wasFromDialog && !isCurrent && !isTrusted) {
      return { success: false, error: "Path was not confirmed via folder picker" }
    }

    // Capture the canonical path once and use it for ALL subsystems inside the
    // try block. On Windows, case variance between the renderer-supplied path
    // and the canonicalized form (e.g. "C:\Proj" vs "C:\proj") means the
    // watcher, LSP, and sync could run on a different casing than the gates
    // that compare against getCurrentProject(). Using the canonical form for
    // all subsystems eliminates this class of race on Windows.
    const canonicalProjectPath = canonicalTarget ?? projectPath

    // Snapshot prior state so we can roll back if any step throws after we've
    // already mutated `setCurrentProject`. Without this rollback, a partial
    // failure in lspManager.start / watchProject left _currentProjectPath
    // pointing at a half-open project — every subsequent IPC gate then
    // accepted that path and operated on a project that wasn't fully open.
    const priorProject = current
    setCurrentProject(canonicalProjectPath)
    try {
      const resourcesDir = is.dev
        ? join(app.getAppPath(), "resources")
        : process.resourcesPath
      // Detect Rojo membership ONCE — gates both the selene.toml seed AND the
      // auto-sync start. Folders opened via the "Open As-Is" path (no
      // default.project.json) are not Roblox projects from Luano's perspective:
      //   - selene.toml would write a Roblox-stdlib config the user didn't ask
      //     for and isn't going to lint with, leaving an unwanted file behind
      //   - syncManager.serve would fail with a 'No default.project.json'
      //     error toast every time the project re-opens
      // Both cost nothing to skip and save the user from confusion.
      const isRojoProject = existsSync(join(canonicalProjectPath, "default.project.json"))
      if (isRojoProject) {
        // Seed selene.toml with the Roblox stdlib config before the LSP/linter
        // starts — otherwise Selene flags every game:GetService/script/Instance
        // usage as an error and the AI agent "fixes" valid code.
        ensureLintConfig(canonicalProjectPath, resourcesDir)
      }
      // M8: sweep orphaned .luano-tmp-* files left behind by killed sessions.
      // Best-effort: skip on any error so a locked file doesn't block project open.
      try {
        const entries = readdirSync(canonicalProjectPath)
        for (const name of entries) {
          if (/\.luano-tmp-[0-9a-f]+$/.test(name)) {
            try { unlinkSync(join(canonicalProjectPath, name)) } catch (err) {
              log.debug("[project:open] failed to sweep tmp file:", name, err)
            }
          }
        }
      } catch (err) {
        log.debug("[project:open] tmp sweep readdir failed:", err)
      }

      watchProject(canonicalProjectPath)
      await lspManager.start(canonicalProjectPath)
      if (isRojoProject) {
        syncManager.serve(canonicalProjectPath)
      }
      // Record the canonical path as trusted so future recent-list clicks
      // can re-open it without going through the dialog. Only reached on
      // a fully-successful open — the catch below skips this.
      recordTrustedProject(canonicalProjectPath)
      return { success: true, lspPort: lspManager.getPort() }
    } catch (err) {
      // Roll back: restore prior project state (or null) AND re-record the
      // dialog confirmation so the user can retry with the same picker click.
      try { stopWatcher() } catch (cleanupErr) { log.warn("[project:open] rollback stopWatcher failed:", cleanupErr) }
      try { syncManager.stop() } catch (cleanupErr) { log.warn("[project:open] rollback syncManager.stop failed:", cleanupErr) }
      try { await lspManager.stop() } catch (cleanupErr) { log.warn("[project:open] rollback lspManager.stop failed:", cleanupErr) }
      setCurrentProject(priorProject)
      if (wasFromDialog && canonicalTarget) recordDialogPath(canonicalTarget)
      log.warn("[project:open] failed, rolled back to prior project", err)
      return { success: false, error: (err as Error).message }
    }
  })

  // Release all main-process holds on the current project folder
  // (watcher / LSP cwd / sync cwd) so the user can delete or move it.
  ipcMain.handle("project:close", async () => {
    stopWatcher()
    syncManager.stop()
    await lspManager.stop()
    cleanupPtys()
    setCurrentProject(null)
    return { success: true }
  })

  // Remove a path from the persistent trust allowlist. Called when the user
  // removes a project from their recent-list — ensures the allowlist stays
  // clean. No security gate needed: a user can only de-trust their own paths,
  // and de-trusting a path never grants additional capabilities.
  //
  // Two-stage match. Folder still exists → canonicalize via realpath (catches
  // symlink/case differences between the renderer arg and the stored form).
  // Folder is gone (auto-removed missing project flow, the common case here)
  // → canonicalizeDialogPath returns null, so fall back to a normalized
  // string match. Without the fallback, dead paths stay in the trust list
  // and silently auto-trust if the user later recreates the folder.
  ipcMain.handle("project:untrust", (_, projectPath: string) => {
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      return { success: false, error: "Invalid path" }
    }
    const canonical = canonicalizeDialogPath(projectPath)
    if (canonical) {
      removeTrustedProject(canonical)
      return { success: true }
    }
    // Fallback: normalize the input and remove any case-insensitive (Windows)
    // / case-sensitive (Unix) match. Mirrors the resolve-only branch of
    // canonicalizeProjectRoot for missing dirs.
    const normalized = normalize(pathResolve(projectPath))
    const eq = (a: string, b: string): boolean =>
      process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
    for (let i = trustedProjectPaths.length - 1; i >= 0; i--) {
      if (eq(trustedProjectPaths[i], normalized)) {
        removeTrustedProject(trustedProjectPaths[i])
      }
    }
    return { success: true }
  })

  // ── File ──────────────────────────────────────────────────────────────────
  // Every file handler MUST sandbox paths to the current project via
  // `requireInProject` (shared.ts). Without this, a compromised renderer
  // (XSS in markdown/deps) or malicious AI tool output could read
  // ~/.ssh/id_rsa, overwrite Windows startup scripts, etc.

  ipcMain.handle("file:read", (_, filePath: string) => {
    try {
      const safePath = requireInProject(filePath)
      return readFile(safePath)
    } catch (err) {
      // ENOENT → return null (file deleted between reads is a normal race).
      const e = err as NodeJS.ErrnoException
      if (e.code === "ENOENT") return null
      // Other errors (EACCES, EISDIR, sandbox traversal blocks, etc.):
      // log original main-side then re-throw a sanitized error so the
      // renderer's error UI / clipboard / telemetry never sees the raw
      // path. `readFileSync`'s default message embeds the absolute path
      // (`"EACCES: permission denied, open '/Users/aiden/...'"`), and
      // sandbox-violation errors embed the renderer-supplied path too —
      // both leak the local username + project layout.
      log.warn("[file:read] failed", { code: e.code, name: (err as Error).name })
      const sanitized = new Error("read_failed") as Error & { code?: string }
      if (e.code) sanitized.code = e.code
      throw sanitized
    }
  })
  // C3: 10 MB write limit — prevents a renderer from OOM-crashing the main
  // process by sending a huge string over IPC. file:search already has a 2 MB
  // read cap; this is the complementary write-side guard.
  const MAX_WRITE_BYTES = 10 * 1024 * 1024
  ipcMain.handle("file:write", (_, filePath: string, content: string) => {
    // Reject non-string content — without this guard, arrays/objects/numbers
    // fall through to writeFile() which coerces them ("[object Object]") and
    // silently corrupts the file.
    if (typeof content !== "string") {
      return { success: false, error: "Content must be a string" }
    }
    if (Buffer.byteLength(content, "utf-8") > MAX_WRITE_BYTES) {
      return { success: false, error: `Content exceeds maximum write size of ${MAX_WRITE_BYTES} bytes` }
    }
    const safePath = requireInProject(filePath)
    const aiContent = aiGeneratedFiles.get(safePath)
    if (aiContent && content !== aiContent) {
      const fileType = safePath.includes(".server.") ? "server"
        : safePath.includes(".client.") ? "client" : "module"
      recordDiff({
        aiGenerated: aiContent,
        userEdited: content,
        fileType,
        apisUsed: [],
        lintErrorsBefore: 0,
        lintErrorsAfter: 0,
        accepted: true
      })
      aiGeneratedFiles.delete(safePath)
    }
    writeFile(safePath, content)
    return { success: true }
  })
  ipcMain.handle("file:read-dir", (_, dirPath: string) => {
    const safePath = requireInProject(dirPath)
    return readDir(safePath)
  })
  ipcMain.handle("file:watch", (_, projectPath: string) => {
    // file:watch must target the currently-open project — renderer can't point
    // the watcher at arbitrary filesystem paths. `project:open` sets the
    // project root first; this handler only re-arms the watcher.
    const current = requireMatchesCurrentProject(projectPath)
    watchProject(current)
    return { success: true }
  })
  ipcMain.handle("file:create-file", (_, dirPath: string, name: string) => {
    const safeDir = requireInProject(dirPath)
    const project = getCurrentProject()
    if (!project) throw new Error("No project is open")
    // Pass projectRoot so assertBasename + validatePath run on the joined path —
    // prevents `name` containing "../../evil.lua" from escaping a validated parent.
    try {
      const fullPath = createFile(safeDir, name, project)
      return { success: true, path: fullPath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
  ipcMain.handle("file:create-folder", (_, dirPath: string, name: string) => {
    const safeDir = requireInProject(dirPath)
    const project = getCurrentProject()
    if (!project) throw new Error("No project is open")
    try {
      const fullPath = createFolder(safeDir, name, project)
      return { success: true, path: fullPath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
  ipcMain.handle("file:rename", (_, oldPath: string, newName: string) => {
    const safeOld = requireInProject(oldPath)
    const project = getCurrentProject()
    if (!project) throw new Error("No project is open")
    try {
      const newPath = renameEntry(safeOld, newName, project)
      return { success: true, path: newPath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
  ipcMain.handle("file:delete", (_, entryPath: string) => {
    const safeEntry = requireInProject(entryPath)
    deleteEntry(safeEntry)
    return { success: true }
  })
  // Used by drag-drop: verify a dropped path is a real directory (not a file,
  // not a symlink, not a missing path) before passing to project open.
  // lstatSync so symlinks report as symlinks instead of chasing to the target.
  ipcMain.handle("file:is-directory", (_, p: string) => {
    try {
      if (typeof p !== "string" || p.length === 0) return false
      const st = lstatSync(p)
      return st.isDirectory() && !st.isSymbolicLink()
    } catch (err) {
      log.debug("[file:is-directory] probe failed:", p, err)
      return false
    }
  })

  // Pre-open probe: does this folder have a default.project.json (= Rojo
  // project)? Runs BEFORE project:open, so the sandboxed file:read handler
  // can't answer — no project is set yet. Unsandboxed by design, but scoped
  // to one specific filename so it can't be used to read arbitrary files.
  // Lightweight existence probe used by recent-project / session-restore flows
  // to detect deleted or moved folders BEFORE the open pipeline runs. Same
  // unsandboxed-but-scoped pattern as project:probe-rojo: read-only check on
  // a single path, no fs walk, no project sandbox dependency. The renderer
  // uses the result to auto-remove dead recents and surface a toast instead
  // of cascading into "Path was not confirmed" / setup-panel fallbacks that
  // would confuse the user.
  ipcMain.handle("project:exists", (_, folderPath: string) => {
    try {
      if (typeof folderPath !== "string" || folderPath.length === 0) return false
      return existsSync(folderPath) && lstatSync(folderPath).isDirectory()
    } catch (err) {
      log.debug("[project:exists] probe failed:", folderPath, err)
      return false
    }
  })

  ipcMain.handle("project:probe-rojo", (_, folderPath: string) => {
    try {
      if (typeof folderPath !== "string" || folderPath.length === 0) return false
      return existsSync(join(folderPath, "default.project.json"))
    } catch (err) {
      log.debug("[project:probe-rojo] probe failed:", folderPath, err)
      return false
    }
  })

  ipcMain.handle("file:move", async (_, srcPath: string) => {
    const safeSrc = requireInProject(srcPath)
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select destination folder"
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true }
    // The destination came from the OS file dialog (user-picked), not the
    // renderer — trusted input. Still enforce it ends up inside the project
    // so "move to /tmp" is refused. moveEntry may fail if user picks outside;
    // we don't require dest-in-project because rename-out-of-project is a
    // legitimate user choice via dialog.
    const destPath = moveEntry(safeSrc, result.filePaths[0])
    return { success: true, path: destPath }
  })

  ipcMain.handle("project:init", (_, projectPath: string) => {
    // Three legitimate entry points:
    //   (1) the path was just returned by project:open-folder (dialog-confirmed), OR
    //   (2) the path matches the currently-open project, OR
    //   (3) the path is in the persistent trusted-projects allowlist
    //       (previously opened by this user). See project:open for the
    //       security argument — only successful past opens populate the list.
    // Anything else is a renderer-forged path — refuse so a compromised
    // renderer can't scaffold default.project.json into arbitrary directories
    // (including Windows Startup, ~/.ssh, etc.).
    //
    // TOCTOU: re-canonicalize via realpath + lstat so a symlink swapped in
    // after the picker closed fails the comparison.
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      return { success: false, error: "Invalid path" }
    }
    const canonicalTarget = canonicalizeDialogPath(projectPath)
    const current = getCurrentProject()
    const canonicalCurrent = current ? canonicalizeDialogPath(current) : null
    const isCurrent = canonicalCurrent !== null && canonicalTarget === canonicalCurrent
    const isTrusted = canonicalTarget !== null && isTrustedProject(canonicalTarget)
    // Atomic consume — finally-style: even if initProject throws, the entry is
    // gone (replay-resistant). On legitimate failure we re-record so the user
    // can retry with the same dialog click. Skip consume when current/trusted
    // so a re-init or recent-list init doesn't lose the dialog entry.
    const wasFromDialog = !isCurrent && !isTrusted && canonicalTarget !== null && consumeDialogPath(canonicalTarget)
    if (!wasFromDialog && !isCurrent && !isTrusted) {
      return { success: false, error: "Path was not confirmed via folder picker" }
    }
    const resourcesDir = is.dev
      ? join(app.getAppPath(), "resources")
      : process.resourcesPath
    try {
      // Use canonical path for parity with project:open's canonicalProjectPath
      // pattern — prevents cosmetic project-name mis-derivation from `..`-style
      // input paths that canonicalize differently than their basename implies.
      initProject(canonicalTarget ?? projectPath, resourcesDir)
      // Record as trusted on a fresh init too — completing init means the
      // user just stamped this directory as a project, so subsequent
      // recent-list opens of the same path should not re-prompt the dialog.
      if (canonicalTarget) recordTrustedProject(canonicalTarget)
      return { success: true }
    } catch (err) {
      if (wasFromDialog && canonicalTarget) recordDialogPath(canonicalTarget)
      return { success: false, error: (err as Error).message }
    }
  })

  // ── Sync (Rojo / Argon) ──────────────────────────────────────────────────
  ipcMain.handle("sync:serve", (_, projectPath: string) => {
    // Only serve the currently-open project. Renderer cannot point the sync
    // tool at an arbitrary directory. Use requireMatchesCurrentProject for
    // canonical-to-canonical comparison (Windows case-variance + symlink).
    let current: string
    try {
      current = requireMatchesCurrentProject(projectPath)
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
    syncManager.serve(current)
    return { success: true }
  })
  ipcMain.handle("sync:stop", () => {
    syncManager.stop()
    return { success: true }
  })
  ipcMain.handle("sync:status", () => syncManager.getStatus())

  // ── Lint/Format ─────────────────────────────────────────────────────────────
  // Tools must be both selected AND installed. The selected-tool gate alone
  // isn't enough: a user can have "selene" / "stylua" persisted as the active
  // tool from an earlier session without ever downloading the binary, and
  // spawnSidecar would throw "Binary not found" on every save. Gate on
  // isBinaryAvailable so a missing toolchain is a silent no-op (the toolchain
  // panel handles the install prompt) instead of a thrown IPC rejection that
  // surfaces as a phantom error in the editor / problems panel.
  ipcMain.handle("lint:format", async (_, filePath: string) => {
    const safePath = requireInProject(filePath)
    const activeFmt = getActiveTool("formatter", getCurrentProject() ?? undefined)
    if (activeFmt !== "stylua") return { success: false }
    if (!isBinaryAvailable("stylua")) return { success: false }
    const success = await formatFile(safePath)
    return { success }
  })
  ipcMain.handle("lint:check", async (_, filePath: string) => {
    const safePath = requireInProject(filePath)
    const activeLint = getActiveTool("linter", getCurrentProject() ?? undefined)
    if (activeLint !== "selene") return []
    if (!isBinaryAvailable("selene")) return []
    return lintFile(safePath)
  })

  // ── File Search ─────────────────────────────────────────────────────────────
  // Bounded by time, file size, and result count so a malformed query on a
  // large repo (or a compromised renderer pointing at a huge tree) can't
  // freeze the main process. Also scoped to the currently-open project so
  // renderer input can't walk arbitrary filesystem paths.
  ipcMain.handle("file:search", async (_, projectPath: string, query: string) => {
    if (!query.trim()) return []
    const current = getCurrentProject()
    if (!current) return []
    // Canonicalize the renderer-supplied path the same way `current` was
    // canonicalized in setCurrentProject (realpath-equality). Without the
    // realpath leg, `C:\Proj` vs `C:\proj` (Windows case-variance) and
    // symlinked aliases would compare unequal and silently return [].
    let canonicalProject: string
    try {
      canonicalProject = canonicalizeProjectRoot(projectPath)
      if (canonicalProject !== current) return []
    } catch (err) {
      log.debug("[file:search] canonicalize failed:", projectPath, err)
      return []
    }
    // Walk on the canonical path, NOT the raw renderer arg. Even though the
    // strings now compare equal, the raw arg may contain redundant `..` or
    // case differences that subtly affect downstream `join` semantics.
    const walkRoot = canonicalProject

    const MAX_FILE_BYTES = 2 * 1024 * 1024  // skip > 2MB files (logs, minified bundles)
    const TIMEOUT_MS = 5_000
    const MAX_RESULTS = 500
    const YIELD_EVERY = 200
    const startedAt = Date.now()

    const results: Array<{ file: string; line: number; text: string }> = []
    const lowerQuery = query.toLowerCase()

    const SEARCH_EXTS = /\.(lua|luau|json|md|toml|txt)$/i
    const SKIP_DIRS = new Set(["node_modules", ".git", "Packages", "DevPackages"])

    // Count of entries visited across the whole walk — used to yield to the
    // event loop every YIELD_EVERY entries so the main process stays
    // responsive on large projects. readFileSync is still sync inside the
    // tight file-read path; the yield is between directory entries.
    let entriesSeen = 0

    const walk = async (dir: string): Promise<void> => {
      if (results.length >= MAX_RESULTS) return
      if (Date.now() - startedAt > TIMEOUT_MS) return
      if (!existsSync(dir)) return
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch (err) {
        log.debug("[project:search] readdir failed, skipping subtree:", dir, err)
        return
      }

      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return
        if (Date.now() - startedAt > TIMEOUT_MS) return
        entriesSeen++
        if (entriesSeen % YIELD_EVERY === 0) {
          await new Promise((r) => setImmediate(r))
        }
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue
        const fullPath = join(dir, entry.name)
        // Defense-in-depth: refuse to follow ANY symlink in-walk. A symlink
        // inside the project that points to /etc would otherwise be opened
        // by readFileSync below. lstat per entry — `entry.isDirectory()` /
        // `isFile()` from withFileTypes already follows links on some
        // platforms (Windows reparse points in particular), so we re-stat.
        try {
          const ls = lstatSync(fullPath)
          if (ls.isSymbolicLink()) continue
        } catch { continue }
        // Windows directory JUNCTIONS are reparse points with a different tag
        // than symlinks — lstat().isSymbolicLink() returns false for them, so
        // the check above does NOT catch junctions. A junction inside the
        // project could point outside the project root (e.g. to C:\).
        // Defense: call realpathSync.native() and verify the resolved path
        // stays under the canonical project root. Skip on any realpath error
        // (inaccessible / deleted) rather than crashing the walk.
        try {
          const resolved = realpathSync.native(fullPath)
          // H7: on Windows startsWith is case-sensitive but the filesystem is
          // not — junction traversal can produce a casing mismatch between the
          // resolved path and walkRoot, causing in-project files to be wrongly
          // excluded. Normalise both sides to lowercase on Windows.
          const resolvedCmp = process.platform === "win32" ? resolved.toLowerCase() : resolved
          const walkRootCmp = process.platform === "win32" ? walkRoot.toLowerCase() : walkRoot
          if (!resolvedCmp.startsWith(walkRootCmp + "/") &&
              !resolvedCmp.startsWith(walkRootCmp + "\\") &&
              resolvedCmp !== walkRootCmp) continue
        } catch { continue }
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (SEARCH_EXTS.test(entry.name)) {
          try {
            const st = statSync(fullPath)
            if (st.size > MAX_FILE_BYTES) continue
            const lines = readFileSync(fullPath, "utf-8").split("\n")
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                results.push({ file: fullPath, line: i + 1, text: lines[i].trim() })
                if (results.length >= MAX_RESULTS) return
              }
            }
          } catch (err) {
            log.debug("[project:search] skipping unreadable file:", fullPath, err)
          }
        }
      }
    }

    await walk(walkRoot)
    return results
  })

  // Handlers below that accept a `projectPath` argument gate it with
  // `requireMatchesCurrentProject` (shared.ts). Without this, a compromised
  // renderer could ask us to analyze/index/write-into arbitrary filesystem
  // paths — every `.luano/*` write is rooted at `projectPath`.

  // ── Topology ──────────────────────────────────────────────────────────────
  ipcMain.handle("topology:analyze", (_, projectPath: string) => {
    const safe = requireMatchesCurrentProject(projectPath)
    return analyzeTopology(safe)
  })

  // ── Cross-Script Analysis [Pro] ─────────────────────────────────────────────
  ipcMain.handle("analysis:cross-script", (_, projectPath: string) => {
    if (!hasFeature("cross-script")) return PRO_REQUIRED("cross-script")
    const safe = requireMatchesCurrentProject(projectPath)
    return analyzeCrossScript(safe)
  })

  ipcMain.handle("analysis:perf-lint", (_, projectPath: string) => {
    if (!hasFeature("perf-lint")) return PRO_REQUIRED("perf-lint")
    const safe = requireMatchesCurrentProject(projectPath)
    return performanceLint(safe)
  })

  ipcMain.handle("analysis:perf-lint-file", (_, filePath: string, content: string) => {
    if (!hasFeature("perf-lint")) return PRO_REQUIRED("perf-lint")
    const safePath = requireInProject(filePath)
    return performanceLintFile(safePath, content)
  })

  // ── DataStore Schema [Pro] ────────────────────────────────────────────────
  ipcMain.handle("datastore:load-schemas", (_, projectPath: string) => {
    if (!hasFeature("datastore-schema")) return PRO_REQUIRED("datastore-schema")
    const safe = requireMatchesCurrentProject(projectPath)
    return loadSchemas(safe)
  })

  ipcMain.handle("datastore:save-schema", (_, projectPath: string, schema: DataStoreSchema) => {
    if (!hasFeature("datastore-schema")) return PRO_REQUIRED("datastore-schema")
    // H2: server-side identifier validation — renderer validation is client-only
    // and can be bypassed. Reject before persisting to disk.
    try { validateSchemaIdentifiers(schema) } catch (e) {
      return { error: (e as Error).message }
    }
    const safe = requireMatchesCurrentProject(projectPath)
    return addSchema(safe, schema)
  })

  ipcMain.handle("datastore:delete-schema", (_, projectPath: string, name: string) => {
    if (!hasFeature("datastore-schema")) return PRO_REQUIRED("datastore-schema")
    const safe = requireMatchesCurrentProject(projectPath)
    return deleteSchema(safe, name)
  })

  ipcMain.handle("datastore:generate-code", (_, schema: DataStoreSchema) => {
    if (!hasFeature("datastore-schema")) return PRO_REQUIRED("datastore-schema")
    // H2: server-side identifier validation before code generation
    try { validateSchemaIdentifiers(schema) } catch (e) {
      return { error: (e as Error).message }
    }
    return generateDataModule(schema)
  })

  ipcMain.handle("datastore:generate-migration", (_, oldSchema: DataStoreSchema, newSchema: DataStoreSchema) => {
    if (!hasFeature("datastore-schema")) return PRO_REQUIRED("datastore-schema")
    // H2: validate both schemas before generating migration code
    try {
      validateSchemaIdentifiers(oldSchema)
      validateSchemaIdentifiers(newSchema)
    } catch (e) {
      return { error: (e as Error).message }
    }
    // H1: version-ordering guard — inverted/equal versions would emit a
    // downgrade migration, causing an infinite re-migration loop at runtime.
    if (oldSchema.version >= newSchema.version) {
      return { error: "newSchema.version must be greater than oldSchema.version" }
    }
    return generateMigration(oldSchema, newSchema)
  })

  // ── Custom Skills (Free) ────────────────────────────────────────────────────
  // Two formats supported, both merged:
  //   (1) Legacy JSON: `.luano/skills.json` — array of Skill objects.
  //   (2) Markdown: `.luano/skills/*.md` (project) AND `~/.luano/skills/*.md` (global)
  //       Matches Claude Code's format — frontmatter (name, description) + body is the prompt.
  ipcMain.handle("skills:load", (_, projectPath: string) => {
    // Must match the currently-open project — renderer can't point this at
    // an arbitrary filesystem location. Use the canonical-aware gate so
    // case-variant retries don't silently return empty.
    let current: string
    try { current = requireMatchesCurrentProject(projectPath) } catch { return [] }
    const skills: Array<Record<string, unknown>> = []

    // (1) Legacy JSON — read from canonical path so a case-variant
    // renderer arg doesn't silently miss the file on case-sensitive FS.
    const jsonPath = join(current, ".luano", "skills.json")
    if (existsSync(jsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(jsonPath, "utf-8"))
        if (Array.isArray(parsed)) skills.push(...parsed)
      } catch (err) {
        log.warn("[skills:load] skills.json parse failed:", err)
      }
    }

    // (2) Markdown, per-project then global. Project skills override global on name conflict.
    const globalDir = join(homedir(), ".luano", "skills")
    const projectDir = join(current, ".luano", "skills")
    const seen = new Set<string>(skills.map((s) => String(s.command ?? "")).filter(Boolean))

    for (const dir of [globalDir, projectDir]) {
      if (!existsSync(dir)) continue
      let entries: string[] = []
      try { entries = readdirSync(dir).filter((f) => f.endsWith(".md")) } catch (err) {
        log.debug("[skills:load] readdir failed:", dir, err)
        continue
      }
      for (const fname of entries) {
        const full = join(dir, fname)
        let raw: string
        try {
          // H1: reject symlinks and cap file size to 8000 chars to prevent
          // DoS via oversized or redirected skill files.
          const lst = lstatSync(full)
          if (lst.isSymbolicLink()) continue
          if (lst.size > 8000) continue
          raw = readFileSync(full, "utf-8").slice(0, 8000)
        } catch (err) {
          log.debug("[skills:load] skill file read failed:", full, err)
          continue
        }
        const parsed = parseMarkdownSkill(raw, fname)
        if (!parsed) continue
        // Project dir runs after global, so duplicates (same command) override.
        const existing = skills.findIndex((s) => s.command === parsed.command)
        if (existing >= 0) skills[existing] = parsed
        else if (!seen.has(parsed.command)) { skills.push(parsed); seen.add(parsed.command) }
      }
    }
    return skills
  })

  ipcMain.handle("skills:save", (_, projectPath: string, skills: unknown[]) => {
    let current: string
    try { current = requireMatchesCurrentProject(projectPath) } catch (err) {
      return { success: false, error: (err as Error).message }
    }
    const dir = join(current, ".luano")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "skills.json"), JSON.stringify(skills, null, 2), "utf-8")
    return { success: true }
  })

  // ── Telemetry (AI sqlite, local only) ─────────────────────────────────────
  ipcMain.handle("telemetry:is-enabled", () => telemetryEnabled())
  ipcMain.handle("telemetry:set-enabled", (_, enabled: unknown) => {
    setTelemetry(enabled === true)
    return { success: true }
  })
  ipcMain.handle("telemetry:stats", () => telemetryStats())

  // ── Crash Reports (Sentry, separate consent) ──────────────────────────────
  // `crashReports` is a distinct store key from `telemetryEnabled` so users
  // can opt into crash reports without sharing AI training data, and vice
  // versa. Sentry SDK is only initialised if `crashReports === true` at app
  // launch, so toggling ON here takes effect on next launch (told via a
  // restart hint in the renderer dialog). Toggling OFF takes effect
  // immediately — `beforeSend` re-checks the store every event.
  ipcMain.handle("crash-reports:is-enabled", () => store.get("crashReports") === true)
  ipcMain.handle("crash-reports:set-enabled", (_, enabled: unknown) => {
    // Coerce so a buggy/compromised renderer can't poison the store with
    // strings, objects, etc. Only true ever enables; everything else is off.
    store.set("crashReports", enabled === true)
    return { success: true }
  })
  ipcMain.handle("crash-reports:is-prompted", () => store.get("crashReportsPrompted") === true)
  ipcMain.handle("crash-reports:mark-prompted", () => {
    store.set("crashReportsPrompted", true)
    return { success: true }
  })

  // ── Third-Party Licenses ──────────────────────────────────────────────────
  // Hands the bundled THIRD_PARTY_LICENSES.txt to the user's default text
  // viewer. File lives under process.resourcesPath in packaged builds and
  // under the repo's resources/ folder in dev so either environment works.
  ipcMain.handle("licenses:open", async () => {
    const prodPath = join(process.resourcesPath ?? app.getAppPath(), "THIRD_PARTY_LICENSES.txt")
    const devPath = join(app.getAppPath(), "resources", "THIRD_PARTY_LICENSES.txt")
    const target = existsSync(prodPath) ? prodPath : existsSync(devPath) ? devPath : null
    if (!target) return { success: false, error: "licenses file not found" }
    const err = await shell.openPath(target)
    return err ? { success: false, error: err } : { success: true }
  })

  // ── Batch Operations ─────────────────────────────────────────────────────
  ipcMain.handle("batch:format-all", async (_, projectPath: string) => {
    const safe = requireMatchesCurrentProject(projectPath)
    const activeFmt = getActiveTool("formatter", safe)
    if (activeFmt !== "stylua") return { formatted: 0, failed: 0, total: 0 }
    if (!isBinaryAvailable("stylua")) return { formatted: 0, failed: 0, total: 0 }
    const files = collectLuauFiles(safe)
    let formatted = 0
    let failed = 0
    for (const f of files) {
      try {
        const ok = await formatFile(f)
        if (ok) formatted++; else failed++
      } catch (err) {
        log.warn("[batch:format-all] formatFile threw:", f, err)
        failed++
      }
    }
    return { formatted, failed, total: files.length }
  })

  ipcMain.handle("batch:lint-all", async (_, projectPath: string) => {
    const safe = requireMatchesCurrentProject(projectPath)
    const activeLint = getActiveTool("linter", safe)
    if (activeLint !== "selene") return { results: [], total: 0 }
    if (!isBinaryAvailable("selene")) return { results: [], total: 0 }
    const files = collectLuauFiles(safe)
    const results: Array<{ file: string; diagnostics: unknown }> = []
    for (const f of files) {
      try {
        const diag = await lintFile(f)
        results.push({ file: f, diagnostics: diag })
      } catch (err) {
        log.debug("[batch:lint-all] lintFile threw:", f, err)
      }
    }
    return { results, total: files.length }
  })

  // ── Performance Monitoring ───────────────────────────────────────────────
  ipcMain.handle("perf:stats", () => {
    const mem = process.memoryUsage()
    return {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
      uptime: Math.round(process.uptime())
    }
  })

  // ── Toolchain ───────────────────────────────────────────────────────────
  ipcMain.handle("toolchain:registry", () => ({
    tools: TOOL_REGISTRY,
    categories: CATEGORIES
  }))

  ipcMain.handle("toolchain:get-config", (_, projectPath?: string, projectOnly?: boolean) => {
    // When a projectPath is supplied, it must be a path the user has expressed
    // intent to open (dialog-confirmed / current / trusted) — the call reads
    // `.luano/toolchain.json` from that directory, and an arbitrary path would
    // let a renderer probe the filesystem (existsSync + readFileSync) at any
    // location.
    //
    // Race-safe degrade: pathSafeToProbe instead of requireMatchesCurrentProject.
    // The renderer's openPath does Promise.all([readDir, buildContext,
    // toolchainGetConfig]) right after project:open returns success; in some
    // race / dev-hot-reload scenarios the main-side current project can be
    // momentarily null even when the renderer thinks the open succeeded. Throwing
    // there breaks the Promise.all chain. Falling back to global defaults gives
    // the renderer a usable result instead and avoids the unhandled rejection.
    if (!projectPath) return getToolchainConfig(undefined, projectOnly)
    const safeProject = pathSafeToProbe(projectPath)
    if (!safeProject) {
      // Log so a silent stale-projectPath / race scenario is visible — without
      // this, the renderer sees empty selections (looks like "my toolchain
      // settings disappeared") with no signal to retry or diagnose.
      log.warn("[toolchain:get-config] pathSafeToProbe rejected, returning global defaults", {
        projectPath,
        currentProject: getCurrentProject()
      })
      return getToolchainConfig(undefined, projectOnly)
    }
    return getToolchainConfig(safeProject, projectOnly)
  })

  ipcMain.handle("toolchain:set-tool", (_, category: ToolCategory, toolId: string | null, projectPath?: string) => {
    if (projectPath) {
      // Write path: `setProjectTool` writes `{projectPath}/.luano/toolchain.json`.
      // pathSafeToProbe accepts dialog-confirmed (setup panel context) /
      // current (active project tool change) / trusted (re-opened project) —
      // all the legitimate cases where set-tool fires from the UI.
      const safeProject = pathSafeToProbe(projectPath)
      if (!safeProject) return { success: false, error: "Path was not confirmed via folder picker" }
      setProjectTool(safeProject, category, toolId)

      // Restart sync ONLY when the targeted project is the currently-open one.
      // Without this guard, a trusted-but-closed project could be reactivated
      // via a forged set-tool("sync", ...) call — `serve()` would spawn rojo
      // against a project the user already closed. setProjectTool itself is
      // safe (write-only on a path the user already trusted), but a live sync
      // process is a side effect that must not span project boundaries.
      if (category === "sync" && toolId) {
        const current = getCurrentProject()
        const canonicalCurrent = current ? canonicalizeDialogPath(current) : null
        if (canonicalCurrent !== null && safeProject === canonicalCurrent) {
          try {
            syncManager.serve(safeProject)
          } catch (err) {
            return { success: false, error: (err as Error).message }
          }
        }
      }
    } else {
      setGlobalDefault(category, toolId)
    }

    return { success: true }
  })

  ipcMain.handle("toolchain:download", async (_, toolId: string) => {
    return downloadTool(toolId)
  })

  ipcMain.handle("toolchain:remove", (_, toolId: string) => {
    return removeTool(toolId)
  })

  ipcMain.handle("toolchain:download-status", (_, toolId: string) => {
    return { status: getDownloadStatus(toolId) }
  })

  ipcMain.handle("toolchain:check-updates", (_, installedIds: string[]) =>
    checkToolUpdates(installedIds)
  )

  ipcMain.handle("toolchain:fetch-metadata", () =>
    fetchToolMetadata()
  )

  // M1: removed downloadUrl parameter from IPC surface — it was already ignored
  // by updateTool() but its presence would allow a future refactor to
  // accidentally enable arbitrary-URL downloads from the renderer.
  ipcMain.handle("toolchain:update-tool", (_, toolId: string, latestVersion?: string) =>
    updateTool(toolId, undefined, latestVersion)
  )

  ipcMain.handle("toolchain:download-multiple", async (_, toolIds: string[]) =>
    downloadMultiple(toolIds)
  )

  ipcMain.handle("toolchain:is-minimum-ready", () =>
    isMinimumToolchainReady()
  )

  // Pre-open probe gate: returns the canonical path if the renderer-supplied
  // arg refers to a path the user has expressed intent to open as a project,
  // or null otherwise. Three accepted sources (peek-only on dialog set —
  // probing must NOT consume the one-shot entry that project:open relies on):
  //   (1) currently-open project (re-probe / setup panel re-entry)
  //   (2) dialog-confirmed path (just picked from project:open-folder, before
  //       project:open runs — this is the chicken-and-egg case for
  //       has-project-config / init-project-config in the setup flow)
  //   (3) trusted-projects allowlist (recent-list re-open)
  //
  // Read scope is bounded to `<canonical>/.luano/toolchain.json`, so even a
  // false-positive accept can only `existsSync` / write that single subfile —
  // not arbitrary disk. Acceptable risk for the UX of allowing pre-open
  // probes from the setup panel.
  function pathSafeToProbe(projectPath: string): string | null {
    if (typeof projectPath !== "string" || projectPath.length === 0) return null
    const canonical = canonicalizeDialogPath(projectPath)
    if (!canonical) return null
    const current = getCurrentProject()
    const canonicalCurrent = current ? canonicalizeDialogPath(current) : null
    const isCurrent = canonicalCurrent !== null && canonical === canonicalCurrent
    // Peek (Map.has), do NOT consume — project:open's atomic consume must
    // still find the entry when the open actually fires.
    const isInDialog = dialogConfirmedPaths.has(canonical)
    const isTrusted = isTrustedProject(canonical)
    return (isCurrent || isInDialog || isTrusted) ? canonical : null
  }

  ipcMain.handle("toolchain:has-project-config", (_, projectPath: string) => {
    // Pre-open probe — called from switchToProject before project:open runs,
    // so the requireMatchesCurrentProject gate (which throws on no-current)
    // is too strict. Use the wider pathSafeToProbe gate. Read-only,
    // scoped to .luano/toolchain.json — no escape on false-positive accept.
    const safeProject = pathSafeToProbe(projectPath)
    if (!safeProject) return false
    return hasProjectConfig(safeProject)
  })

  ipcMain.handle("toolchain:init-project-config", (_, projectPath: string) => {
    // Pre-open scaffolding — called from the setup panel before project:open
    // runs. Same widened gate as has-project-config: dialog-confirmed paths
    // are the user's expressed intent to open this folder as a project, so
    // writing .luano/toolchain.json under it is part of that intent.
    const safeProject = pathSafeToProbe(projectPath)
    if (!safeProject) return { success: false, error: "Path was not confirmed via folder picker" }
    initProjectConfig(safeProject)
    return { success: true }
  })

  // Package manager: dispatch `init` / `install` / `update` / `add` to the
  // tool that owns this project. Manifest on disk is the source of truth —
  // wally.toml / pesde.toml are independent files, so switching the active
  // toolchain selection back and forth does NOT lose packages, but it CAN
  // misroute install if we dispatched by active selection instead of by
  // manifest. For `init` (no manifest yet by definition), fall back to the
  // active toolchain selection.
  const PKG_COMMANDS = new Set(["init", "install", "update", "add"])
  // Allow only safe characters in a package name passed to `wally add` /
  // `pesde add`. spawn() runs without a shell so injection isn't possible,
  // but a leading `-` would otherwise be parsed by the package manager as a
  // CLI flag rather than a package name — reject explicitly. Inner characters
  // include the semver range syntax used by Wally / pesde (`^`, `~`, `*`,
  // `<`, `>`, `=`).
  const PKG_NAME_RE = /^[A-Za-z0-9._/@][A-Za-z0-9._/@^~*+=<>-]*$/

  function resolvePackageManager(
    safeProject: string,
    command: "init" | "install" | "update" | "add"
  ): { tool: "wally" | "pesde" | null; error?: string } {
    const hasWally = existsSync(join(safeProject, "wally.toml"))
    const hasPesde = existsSync(join(safeProject, "pesde.toml"))
    if (hasWally && hasPesde) {
      // Both manifests present — let the active selection break the tie so
      // users can keep both files around (e.g., during a migration) without
      // a coin flip deciding which CLI runs.
      const sel = getActiveTool("package-manager", safeProject)
      if (sel === "wally" || sel === "pesde") return { tool: sel }
      return {
        tool: null,
        error: "Both wally.toml and pesde.toml are present — set one as the active package manager in the Toolchain panel."
      }
    }
    if (hasWally) return { tool: "wally" }
    if (hasPesde) return { tool: "pesde" }
    // No manifest — only `init` is sensible without one. Use the active
    // selection to decide which scaffold to create.
    if (command !== "init") {
      return { tool: null, error: "No package manifest found. Run `init` first to create wally.toml or pesde.toml." }
    }
    const sel = getActiveTool("package-manager", safeProject)
    if (sel === "wally" || sel === "pesde") return { tool: sel }
    return { tool: null, error: "No package manager configured for this project. Select one in the Toolchain panel before running init." }
  }

  ipcMain.handle("package-manager:run", async (
    _,
    projectPath: string,
    command: "init" | "install" | "update" | "add",
    packageName?: string
  ): Promise<{ success: boolean; output?: string; error?: string; tool?: string }> => {
    let safeProject: string
    try {
      safeProject = requireMatchesCurrentProject(projectPath)
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }

    if (!PKG_COMMANDS.has(command)) {
      return { success: false, error: `Unsupported command: ${command}` }
    }

    if (command === "add") {
      if (typeof packageName !== "string" || !PKG_NAME_RE.test(packageName) || packageName.length > 200) {
        return { success: false, error: "Invalid package name" }
      }
    }

    const resolved = resolvePackageManager(safeProject, command)
    if (!resolved.tool) {
      return { success: false, error: resolved.error ?? "No package manager configured for this project" }
    }
    const tool = resolved.tool

    const def = TOOL_REGISTRY[tool]
    if (!def || def.category !== "package-manager") {
      return { success: false, error: `Unknown package manager: ${tool}` }
    }

    if (!isBinaryAvailable(def.binaryName)) {
      return { success: false, error: `${def.name} is not installed. Install it from the Toolchain panel.`, tool }
    }

    const runCli = tool === "pesde" ? runPesde : runWally
    const runArgs = command === "add" ? [command, packageName!] : [command]
    try {
      const result = await runCli(runArgs, safeProject)
      if (result.exitCode !== 0) {
        return { success: false, output: result.output, error: `${def.name} ${command} exited with code ${result.exitCode}`, tool }
      }
      // `add` modifies the manifest but doesn't fetch — chain `install` so
      // the user gets the package in Packages/ from a single click. Surface
      // the install failure but keep the manifest change (already on disk).
      if (command === "add") {
        const installResult = await runCli(["install"], safeProject)
        const combinedOutput = `${result.output}\n${installResult.output}`
        if (installResult.exitCode !== 0) {
          return {
            success: false,
            output: combinedOutput,
            error: `${def.name}: added ${packageName} to manifest but install failed (exit ${installResult.exitCode})`,
            tool
          }
        }
        return { success: true, output: combinedOutput, tool }
      }
      return { success: true, output: result.output, tool }
    } catch (err) {
      return { success: false, error: (err as Error).message, tool }
    }
  })

  // Wally → pesde migration. Reads wally.toml, generates a pesde.toml that
  // routes the same dependencies through pesde's Wally adapter. wally.toml
  // is renamed to wally.toml.bak so the user can revert if pesde's Wally
  // resolver doesn't behave the way they expect; refusing to overwrite an
  // existing pesde.toml prevents accidental loss when the project is
  // already mid-migration.
  ipcMain.handle("package-manager:migrate-to-pesde", async (
    _,
    projectPath: string
  ): Promise<{
    success: boolean
    error?: string
    migratedCount?: number
    unmappedCount?: number
    pesdeTomlPath?: string
    backupPath?: string
  }> => {
    let safeProject: string
    try {
      safeProject = requireMatchesCurrentProject(projectPath)
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }

    const wallyPath = join(safeProject, "wally.toml")
    const pesdePath = join(safeProject, "pesde.toml")
    if (!existsSync(wallyPath)) {
      return { success: false, error: "No wally.toml found in this project." }
    }
    if (existsSync(pesdePath)) {
      return { success: false, error: "pesde.toml already exists — remove or rename it before migrating." }
    }

    // Cap the read so a hostile cloned repo with a multi-GB wally.toml can't
    // OOM the main process the moment the user clicks Migrate. Real wally.toml
    // files are kilobytes; 1 MB is generous and still safe.
    const MAX_MANIFEST_BYTES = 1 * 1024 * 1024
    try {
      const stat = statSync(wallyPath)
      if (stat.size > MAX_MANIFEST_BYTES) {
        return { success: false, error: `wally.toml is too large (${stat.size} bytes) — refusing to migrate.` }
      }
    } catch (err) {
      return { success: false, error: `Failed to stat wally.toml: ${(err as Error).message}` }
    }

    let source: string
    try {
      source = readFileSync(wallyPath, "utf-8")
    } catch (err) {
      return { success: false, error: `Failed to read wally.toml: ${(err as Error).message}` }
    }

    const manifest = parseWallyToml(source)
    const result = buildPesdeToml(manifest)

    try {
      writeFileSync(pesdePath, result.pesdeToml, "utf-8")
    } catch (err) {
      return { success: false, error: `Failed to write pesde.toml: ${(err as Error).message}` }
    }

    // Move the original wally.toml aside so the manifest detection logic
    // doesn't see both files (which would force a tie-break dialog) and the
    // user has an obvious revert path.
    const backupPath = `${wallyPath}.bak`
    try {
      // If a previous backup exists, timestamp the new one to avoid clobber.
      const finalBackup = existsSync(backupPath) ? `${wallyPath}.bak.${Date.now()}` : backupPath
      renameSync(wallyPath, finalBackup)
      return {
        success: true,
        migratedCount: result.migratedCount,
        unmappedCount: result.unmappedDependencies.length,
        pesdeTomlPath: pesdePath,
        backupPath: finalBackup
      }
    } catch (err) {
      // pesde.toml is on disk but we couldn't move wally.toml — leaving both
      // files would trip the resolveTool tie-break ("Both wally.toml and
      // pesde.toml are present") next time the project opens. Roll back the
      // pesde.toml write so the project returns to a clean wally-only state.
      // If even the rollback fails, point the user at the leftover file.
      let rollbackErr: string | null = null
      try { unlinkSync(pesdePath) } catch (e) { rollbackErr = (e as Error).message }
      return {
        success: false,
        error: rollbackErr
          ? `Failed to move wally.toml aside (${(err as Error).message}) and rollback failed (${rollbackErr}). Manually delete ${pesdePath}.`
          : `Failed to move wally.toml aside: ${(err as Error).message}. pesde.toml has been rolled back.`,
        migratedCount: result.migratedCount,
        unmappedCount: result.unmappedDependencies.length
      }
    }
  })

  // pesde → wally migration. There's no clean automated converter the other
  // direction — pesde manifests can use indices, target qualifiers, and
  // git/path sources that have no wally equivalent — so this only handles
  // the round-trip case: a project that was wally first, got migrated to
  // pesde, and now wants to revert. The original wally.toml is restored
  // from the `.bak` we wrote during wally→pesde, and the current pesde.toml
  // is moved to pesde.toml.bak so the user can revert again or recover any
  // pesde-only edits manually. Projects without a wally.toml.bak are
  // pesde-native and surface a `notSupported` flag instead of erroring —
  // the toolchain selection still flips, the manifest just stays as-is.
  ipcMain.handle("package-manager:migrate-to-wally", async (
    _,
    projectPath: string,
    options?: { force?: boolean }
  ): Promise<{
    success: boolean
    notSupported?: boolean
    staleBackup?: { backupPath: string; backupAgeDays: number; pesdeAgeDays: number }
    error?: string
    wallyTomlPath?: string
    backupPath?: string
  }> => {
    let safeProject: string
    try {
      safeProject = requireMatchesCurrentProject(projectPath)
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }

    const wallyPath = join(safeProject, "wally.toml")
    const pesdePath = join(safeProject, "pesde.toml")

    if (!existsSync(pesdePath)) {
      return { success: false, error: "No pesde.toml found in this project." }
    }
    if (existsSync(wallyPath)) {
      return { success: false, error: "wally.toml already exists — remove or rename it before reverting." }
    }

    // Pick the freshest wally.toml.bak* — the original wally→pesde writes
    // wally.toml.bak, but a second wally→pesde→wally→pesde cycle adds
    // wally.toml.bak.<ts>. Without sorting, pesde→wally would silently
    // restore the *first* migration's snapshot and orphan the timestamped
    // backups.
    let candidates: { path: string; mtimeMs: number }[]
    try {
      candidates = readdirSync(safeProject)
        .filter((n) => n === "wally.toml.bak" || n.startsWith("wally.toml.bak."))
        .map((n) => {
          const p = join(safeProject, n)
          try { return { path: p, mtimeMs: statSync(p).mtimeMs } } catch (err) {
            log.debug("[pesde-revert] stat failed for backup candidate:", p, err)
            return null
          }
        })
        .filter((x): x is { path: string; mtimeMs: number } => x !== null)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
    } catch (err) {
      return { success: false, error: `Failed to scan for wally.toml.bak: ${(err as Error).message}` }
    }

    if (candidates.length === 0) {
      // pesde-native project — no automated path back to wally. Caller should
      // treat this as informational, not a hard failure.
      return {
        success: false,
        notSupported: true,
        error: "No wally.toml.bak found — pesde-native projects can't be auto-converted to wally (pesde indices/targets don't translate cleanly)."
      }
    }

    const wallyBackup = candidates[0].path

    // Stale-backup guard: if the user has been editing pesde.toml since the
    // last wally→pesde, restoring blindly throws away every pesde-only edit
    // with no warning. Compare mtimes and surface a confirmation prompt
    // unless the renderer has already shown one and is calling back with
    // force=true.
    if (!options?.force) {
      try {
        const pesdeMtime = statSync(pesdePath).mtimeMs
        const backupMtime = candidates[0].mtimeMs
        if (backupMtime < pesdeMtime) {
          const now = Date.now()
          const dayMs = 24 * 60 * 60 * 1000
          return {
            success: false,
            staleBackup: {
              backupPath: wallyBackup,
              backupAgeDays: Math.round((now - backupMtime) / dayMs),
              pesdeAgeDays: Math.round((now - pesdeMtime) / dayMs)
            }
          }
        }
      } catch (err) {
        return { success: false, error: `Failed to compare backup age: ${(err as Error).message}` }
      }
    }

    const pesdeBackupBase = `${pesdePath}.bak`
    const pesdeBackup = existsSync(pesdeBackupBase) ? `${pesdePath}.bak.${Date.now()}` : pesdeBackupBase

    try {
      renameSync(pesdePath, pesdeBackup)
    } catch (err) {
      return { success: false, error: `Failed to move pesde.toml aside: ${(err as Error).message}` }
    }
    try {
      renameSync(wallyBackup, wallyPath)
    } catch (err) {
      // Try to roll back the pesde rename so we don't leave the project
      // without a manifest at all. If the rollback also fails the project
      // ends up with both .bak files and no live manifest — surface that in
      // the error so the user can recover manually instead of guessing.
      let rolledBack = true
      try { renameSync(pesdeBackup, pesdePath) } catch (rollbackErr) {
        log.error("[pesde-revert] rollback rename failed — project left without manifest:", rollbackErr)
        rolledBack = false
      }
      const base = `Failed to restore wally.toml from .bak: ${(err as Error).message}`
      return {
        success: false,
        error: rolledBack
          ? base
          : `${base}. Additionally, could not roll back pesde.toml — manually rename ${pesdeBackup} back to pesde.toml to recover.`
      }
    }

    return { success: true, wallyTomlPath: wallyPath, backupPath: pesdeBackup }
  })
}
