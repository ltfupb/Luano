import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync, rmSync, renameSync } from "fs"
import { join, extname, dirname } from "path"

export interface FileEntry {
  name: string
  path: string
  type: "file" | "directory"
  ext?: string
  children?: FileEntry[]
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
        } catch {
          return { name, path: fullPath, type: "file" }
        }
      })
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  } catch {
    return []
  }
}

export function readFile(filePath: string): string {
  return readFileSync(filePath, "utf-8")
}

export function writeFile(filePath: string, content: string): void {
  writeFileSync(filePath, content, "utf-8")
}

export function createFile(dirPath: string, name: string): string {
  const fullPath = join(dirPath, name)
  if (!existsSync(fullPath)) writeFileSync(fullPath, "", "utf-8")
  return fullPath
}

export function createFolder(dirPath: string, name: string): string {
  const fullPath = join(dirPath, name)
  if (!existsSync(fullPath)) mkdirSync(fullPath, { recursive: true })
  return fullPath
}

export function renameEntry(oldPath: string, newName: string): string {
  const newPath = join(dirname(oldPath), newName)
  renameSync(oldPath, newPath)
  return newPath
}

export function deleteEntry(entryPath: string): void {
  rmSync(entryPath, { recursive: true, force: true })
}

export function moveEntry(srcPath: string, destDir: string): string {
  const name = srcPath.split(/[/\\]/).pop() ?? "untitled"
  const destPath = join(destDir, name)
  renameSync(srcPath, destPath)
  return destPath
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
  } catch {
    return false
  }

  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    // Malformed JSON — leave it alone. Argon will surface the parse error
    // itself and the user can fix it by hand.
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
  } catch {
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
  } catch { /* don't block project open on a missing template */ }
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

