import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync, rmSync, renameSync, openSync, closeSync, fsyncSync, unlinkSync } from "fs"
import { join, extname, dirname } from "path"
import { randomBytes } from "crypto"
import { validatePath } from "./sandbox"
import { log } from "../logger"

export interface FileEntry {
  name: string
  path: string
  type: "file" | "directory"
  ext?: string
  children?: FileEntry[]
}

/**
 * Reject a renderer-supplied filename that could escape its parent directory
 * once joined. Validates the parent separately — this only validates the leaf.
 *
 * Blocks:
 *   - path separators (`/`, `\`) — collapses join boundary
 *   - traversal segments (`..`, `.`) — escape via `parent/..`
 *   - leading dot + separator (e.g. `../evil` slipped through as `..`, or `./x`)
 *   - Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) —
 *     even with an extension, Windows resolves these to the device
 *   - NUL byte — filesystem layer usually truncates silently
 *   - empty name, whitespace-only name
 *   - names > 255 chars (exceeds common FS NAME_MAX)
 *
 * Callers must also call validatePath() on the joined result so a symlinked
 * parent can't re-escape.
 */
export function assertBasename(name: string): void {
  if (typeof name !== "string") throw new Error("Invalid name: must be a string")
  if (name.length === 0) throw new Error("Invalid name: empty")
  if (name.length > 255) throw new Error(`Invalid name: exceeds 255 characters (${name.length})`)
  if (name.trim().length === 0) throw new Error("Invalid name: whitespace only")
  if (name.includes("\0")) throw new Error("Invalid name: contains NUL byte")
  if (name.includes("/") || name.includes("\\")) {
    throw new Error(`Invalid name: path separators not allowed ("${name}")`)
  }
  if (name === "." || name === "..") {
    throw new Error(`Invalid name: traversal segment ("${name}")`)
  }
  // Windows reserved device names — case-insensitive, with or without extension.
  // CON.txt still resolves to the CON device on Windows.
  const base = name.split(".")[0].toUpperCase()
  const WIN_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/
  if (WIN_RESERVED.test(base)) {
    throw new Error(`Invalid name: "${name}" is a reserved Windows device name`)
  }
  // Disallow trailing space/dot — Windows silently strips these, so a user-visible
  // "foo " and "foo" collide on disk which lets an attacker forge a "different" name.
  if (/[ .]$/.test(name)) {
    throw new Error(`Invalid name: trailing space or dot not allowed ("${name}")`)
  }
}

export function readDir(dirPath: string, depth = 0): FileEntry[] {
  if (depth > 5) return []

  try {
    const entries = readdirSync(dirPath)
    return entries
      .map((name): FileEntry => {
        const fullPath = join(dirPath, name)
        try {
          const stat = statSync(fullPath)
          if (stat.isDirectory()) {
            return {
              name,
              path: fullPath,
              type: "directory",
              children: readDir(fullPath, depth + 1)
            }
          }
          return {
            name,
            path: fullPath,
            type: "file",
            ext: extname(name).slice(1)
          }
        } catch (err) {
          log.debug("[readDir] stat failed for entry, treating as file:", fullPath, err)
          return { name, path: fullPath, type: "file" }
        }
      })
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  } catch (err) {
    log.debug("[readDir] readdir failed:", dirPath, err)
    return []
  }
}

export function readFile(filePath: string): string {
  const content = readFileSync(filePath, "utf-8")
  // M10: detect silent UTF-8 replacement characters (U+FFFD) that Node inserts
  // for invalid byte sequences. If present, the file is binary or corrupted —
  // editing and saving it would silently destroy the original binary content.
  if (content.includes("�")) {
    throw Object.assign(
      new Error(`File appears to be binary or contains invalid UTF-8 — editing would corrupt it`),
      { code: "EBINARY" }
    )
  }
  return content
}

/**
 * Atomic file write: write to a randomly-named temp file, fsync, then rename.
 * H12: prevents partial-write corruption when AV / OneDrive locks the file
 * mid-write. The rename is atomic on Windows (ReplaceFile) and POSIX.
 */
export function writeFile(filePath: string, content: string): void {
  const tmpPath = filePath + ".luano-tmp-" + randomBytes(8).toString("hex")
  try {
    writeFileSync(tmpPath, content, "utf-8")
    const fd = openSync(tmpPath, "r+")
    try { fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmpPath, filePath)
  } catch (err) {
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath) } catch (cleanupErr) {
      log.debug("[writeFile] failed to clean up tmp file after write error:", tmpPath, cleanupErr)
    }
    throw err
  }
}

/**
 * Create a new empty file at `dirPath/name`. `name` is validated as a safe
 * basename (no separators, no traversal, etc). Caller should have validated
 * `dirPath` via validatePath() first; we re-validate the joined path with
 * `projectRoot` if supplied so a symlinked parent can't escape.
 */
export function createFile(dirPath: string, name: string, projectRoot?: string): string {
  assertBasename(name)
  const fullPath = join(dirPath, name)
  const finalPath = projectRoot ? validatePath(fullPath, projectRoot) : fullPath
  if (!existsSync(finalPath)) writeFileSync(finalPath, "", "utf-8")
  return finalPath
}

export function createFolder(dirPath: string, name: string, projectRoot?: string): string {
  assertBasename(name)
  const fullPath = join(dirPath, name)
  const finalPath = projectRoot ? validatePath(fullPath, projectRoot) : fullPath
  if (!existsSync(finalPath)) mkdirSync(finalPath, { recursive: true })
  return finalPath
}

export function renameEntry(oldPath: string, newName: string, projectRoot?: string): string {
  assertBasename(newName)
  const newPath = join(dirname(oldPath), newName)
  const finalPath = projectRoot ? validatePath(newPath, projectRoot) : newPath
  renameSync(oldPath, finalPath)
  return finalPath
}

export function deleteEntry(entryPath: string): void {
  rmSync(entryPath, { recursive: true, force: true })
}

export function moveEntry(srcPath: string, destDir: string, projectRoot?: string): string {
  const name = srcPath.split(/[/\\]/).pop() ?? "untitled"
  // `name` is derived from a path we already validated, but run assertBasename
  // anyway so a caller that reconstructs srcPath from renderer input stays safe.
  assertBasename(name)
  const destPath = join(destDir, name)
  // `destDir` comes from the OS dialog (user-picked), not the renderer, so we
  // don't re-validate it against projectRoot — moving files out of the project
  // via dialog is a legitimate user action. If projectRoot is passed we still
  // re-check the joined path as a backstop.
  const finalPath = projectRoot ? validatePath(destPath, projectRoot) : destPath
  renameSync(srcPath, finalPath)
  return finalPath
}

/**
 * Strip `$className` from any node that also has `$path`. Argon rejects
 * the combo ("$className and $path cannot be set at the same time") while
 * standard Rojo supports both patterns, so removing `$className` is
 * strictly an Argon-compat fix that keeps Rojo working unchanged.
 *
 * Returns true if the file was modified on disk.
 */
export function migrateProjectForArgon(projectPath: string): boolean {
  const projectFile = join(projectPath, "default.project.json")
  if (!existsSync(projectFile)) return false

  let raw: string
  try {
    raw = readFileSync(projectFile, "utf-8")
  } catch (err) {
    log.warn("[migrateProjectForArgon] read failed:", projectFile, err)
    return false
  }

  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch (err) {
    // Malformed JSON — leave it alone. Argon will surface the parse error
    // itself and the user can fix it by hand.
    log.warn("[migrateProjectForArgon] JSON parse failed:", projectFile, err)
    return false
  }

  const root = (doc as { tree?: unknown } | null)?.tree
  if (!root || typeof root !== "object") return false

  let changed = false
  const walk = (node: Record<string, unknown>): void => {
    if ("$className" in node && "$path" in node) {
      delete node.$className
      changed = true
    }
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("$")) continue
      if (value && typeof value === "object" && !Array.isArray(value)) {
        walk(value as Record<string, unknown>)
      }
    }
  }
  walk(root as Record<string, unknown>)

  if (!changed) return false

  try {
    // Preserve 2-space indent convention used by every Rojo/Argon project
    // file out there. JSON.stringify with 2 matches what Luano's own
    // template emits.
    writeFileSync(projectFile, JSON.stringify(doc, null, 2) + "\n", "utf-8")
    return true
  } catch (err) {
    log.warn("[migrateProjectForArgon] write failed:", projectFile, err)
    return false
  }
}

/**
 * Idempotent: writes selene.toml with `std = "roblox"` only if it doesn't
 * exist. Without this, Selene defaults to the Lua stdlib and flags every
 * `game:GetService()` / `script` / `Instance` reference as an error, which
 * makes the AI agent "fix" valid Roblox code during its verify phase.
 *
 * Must run on every project-open, not just initProject — existing Rojo
 * projects without selene.toml were the common case that hit this bug.
 */
export function ensureLintConfig(dirPath: string, resourcesDir: string): void {
  const seleneFile = join(dirPath, "selene.toml")
  if (existsSync(seleneFile)) return
  try {
    const templateToml = readFileSync(join(resourcesDir, "templates/empty/selene.toml"), "utf-8")
    writeFileSync(seleneFile, templateToml, "utf-8")
  } catch (err) {
    log.warn("[ensureLintConfig] failed to write selene.toml (non-fatal):", err)
  }
}

export function initProject(dirPath: string, resourcesDir: string): void {
  const projectFile = join(dirPath, "default.project.json")
  const srcDir = join(dirPath, "src")

  if (!existsSync(projectFile)) {
    const templateJson = readFileSync(join(resourcesDir, "templates/empty/default.project.json"), "utf-8")
    const projectName = dirPath.split(/[/\\]/).pop() ?? "MyGame"
    writeFileSync(projectFile, templateJson.replace('"MyGame"', JSON.stringify(projectName)), "utf-8")
  }

  ensureLintConfig(dirPath, resourcesDir)

  for (const sub of ["server", "shared", "client"]) {
    const subDir = join(srcDir, sub)
    if (!existsSync(subDir)) mkdirSync(subDir, { recursive: true })
  }
}

