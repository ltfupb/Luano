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

export function initProject(dirPath: string, resourcesDir: string): void {
  const projectFile = join(dirPath, "default.project.json")
  const seleneFile = join(dirPath, "selene.toml")
  const srcDir = join(dirPath, "src")

  if (!existsSync(projectFile)) {
    const templateJson = readFileSync(join(resourcesDir, "templates/empty/default.project.json"), "utf-8")
    const projectName = dirPath.split(/[/\\]/).pop() ?? "MyGame"
    writeFileSync(projectFile, templateJson.replace('"MyGame"', JSON.stringify(projectName)), "utf-8")
  }

  if (!existsSync(seleneFile)) {
    const templateToml = readFileSync(join(resourcesDir, "templates/empty/selene.toml"), "utf-8")
    writeFileSync(seleneFile, templateToml, "utf-8")
  }

  for (const sub of ["server", "shared", "client"]) {
    const subDir = join(srcDir, sub)
    if (!existsSync(subDir)) mkdirSync(subDir, { recursive: true })
  }
}

