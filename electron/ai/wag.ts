/**
 * electron/ai/wag.ts — WAG (Wiki-Augmented Generation) core engine
 *
 * Phase 0: readWagFile + buildWagIndex only.
 * Subsequent phases add search, validate, rebuildWagIndex, auto-backlinks.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs"
import { join, basename } from "path"

/** Check whether a wag/ directory exists for a project. */
export function wagExists(projectPath: string): boolean {
  return existsSync(join(projectPath, "wag"))
}

/**
 * Read a WAG entity file.
 * @param entityPath  Relative to wag/ — e.g. "monsters/grade-1/slime" (no .md)
 * @returns File content, or null if not found.
 */
export function readWagFile(projectPath: string, entityPath: string): string | null {
  const normalized = entityPath.replace(/\.md$/, "").replace(/\\/g, "/")
  const wagDir = join(projectPath, "wag")
  const filePath = join(wagDir, `${normalized}.md`)
  // Path traversal guard — resolved path must stay within wag/
  if (!filePath.startsWith(wagDir + "/") && !filePath.startsWith(wagDir + "\\")) return null
  if (!existsSync(filePath)) return null
  try {
    return readFileSync(filePath, "utf-8")
  } catch {
    return null
  }
}

/**
 * List sibling entities in the same category as the given entityPath.
 * Used in wag_read error messages to guide the agent toward valid entities.
 */
export function listSiblings(projectPath: string, entityPath: string): string[] {
  const parts = entityPath.replace(/\.md$/, "").split("/")
  // Use the first path segment (category) as the directory to list
  const categoryDir = join(projectPath, "wag", parts[0] ?? "")
  if (!existsSync(categoryDir)) return []
  try {
    const results: string[] = []
    const walkDir = (dir: string, prefix: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith("_")) continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name)
        } else if (entry.name.endsWith(".md") && entry.name !== "INDEX.md") {
          const rel = prefix ? `${prefix}/${basename(entry.name, ".md")}` : basename(entry.name, ".md")
          results.push(`${parts[0]}/${rel}`)
        }
      }
    }
    walkDir(categoryDir, "")
    return results.slice(0, 10)
  } catch {
    return []
  }
}

export interface WagSearchResult {
  path: string       // relative to wag/, no .md
  snippet: string    // first matching line or frontmatter summary
}

export interface WagValidationResult {
  brokenLinks: Array<{ file: string; link: string }>   // links pointing to nonexistent files
  orphans: string[]                                     // files with no incoming links
  missingBacklinks: Array<{ source: string; target: string }> // A→B but B has no link to A
}

/**
 * Search WAG entities by name, tag, or content.
 */
export function searchWag(projectPath: string, query: string, limit = 5): WagSearchResult[] {
  const wagDir = join(projectPath, "wag")
  if (!existsSync(wagDir)) return []

  const q = query.toLowerCase().trim()
  if (!q) return []

  const scored: Array<WagSearchResult & { score: number }> = []

  const walkDir = (dir: string, relPrefix: string): void => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith("_") || entry.name === "INDEX.md") continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath, relPrefix ? `${relPrefix}/${entry.name}` : entry.name)
        } else if (entry.name.endsWith(".md")) {
          const entityPath = relPrefix
            ? `${relPrefix}/${basename(entry.name, ".md")}`
            : basename(entry.name, ".md")

          try {
            const content = readFileSync(fullPath, "utf-8")
            const lines = content.split("\n")

            // Score: name match > tag match > content match
            const nameLower = entityPath.toLowerCase()
            let score = 0
            let snippet = lines.find(l => l.startsWith("# "))?.slice(2).trim() ?? entityPath

            if (nameLower.includes(q)) score += 10
            // Check tags in frontmatter
            const tagLine = lines.find(l => l.startsWith("tags:"))
            if (tagLine?.toLowerCase().includes(q)) score += 7
            // Content match — find first matching line
            const matchLine = lines.find(l => l.toLowerCase().includes(q) && !l.startsWith("---"))
            if (matchLine) { score += 3; snippet = matchLine.trim() }

            if (score > 0) {
              scored.push({ path: entityPath, snippet: snippet.slice(0, 120), score })
            }
          } catch { /* skip unreadable */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walkDir(wagDir, "")

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ path, snippet }) => ({ path, snippet }))
}

/**
 * Validate WAG link consistency.
 * - brokenLinks: [[link]] pointing to a file that doesn't exist
 * - orphans: files with no incoming links from other WAG files
 * - missingBacklinks: A has [[B]] but B has no [[A]] link
 */
export function validateWag(projectPath: string): WagValidationResult {
  const wagDir = join(projectPath, "wag")
  const result: WagValidationResult = { brokenLinks: [], orphans: [], missingBacklinks: [] }
  if (!existsSync(wagDir)) return result

  // Collect all entity files and their wikilinks
  const allFiles = new Set<string>()
  const fileLinks = new Map<string, string[]>() // entityPath → [linked paths]

  const walkDir = (dir: string, relPrefix: string): void => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith("_") || entry.name === "INDEX.md") continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath, relPrefix ? `${relPrefix}/${entry.name}` : entry.name)
        } else if (entry.name.endsWith(".md")) {
          const entityPath = relPrefix
            ? `${relPrefix}/${basename(entry.name, ".md")}`
            : basename(entry.name, ".md")
          allFiles.add(entityPath)

          try {
            const content = readFileSync(fullPath, "utf-8")
            const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)]
              .map(m => m[1].replace(/\.md$/, ""))
            fileLinks.set(entityPath, links)
          } catch { fileLinks.set(entityPath, []) }
        }
      }
    } catch { /* skip */ }
  }
  walkDir(wagDir, "")

  // Build incoming links map
  const incomingLinks = new Map<string, Set<string>>()
  for (const file of allFiles) incomingLinks.set(file, new Set())

  for (const [source, links] of fileLinks) {
    for (const link of links) {
      if (!allFiles.has(link)) {
        result.brokenLinks.push({ file: source, link })
      } else {
        incomingLinks.get(link)?.add(source)
      }
    }
  }

  // Orphans: files with no incoming links (excluding INDEX.md)
  for (const [file, incoming] of incomingLinks) {
    if (incoming.size === 0) result.orphans.push(file)
  }

  // Missing backlinks: A→B but B has no link back to A
  for (const [source, links] of fileLinks) {
    for (const target of links) {
      if (!allFiles.has(target)) continue
      const targetLinks = fileLinks.get(target) ?? []
      if (!targetLinks.some(l => l === source || source.endsWith(`/${l}`) || l.endsWith(`/${source.split("/").pop()}`))) {
        result.missingBacklinks.push({ source, target })
      }
    }
  }

  return result
}

/**
 * Rebuild INDEX.md and _meta.json from the wag/ directory.
 * Returns validation result so the agent can report broken links.
 */
export function rebuildWagIndex(projectPath: string): WagValidationResult {
  const wagDir = join(projectPath, "wag")
  if (!existsSync(wagDir)) return { brokenLinks: [], orphans: [], missingBacklinks: [] }

  // Collect all entities
  const categories: Record<string, Array<{ path: string; title: string }>> = {}

  const walkDir = (dir: string, relPrefix: string): void => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith("_") || entry.name === "INDEX.md") continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath, relPrefix ? `${relPrefix}/${entry.name}` : entry.name)
        } else if (entry.name.endsWith(".md")) {
          const entityPath = relPrefix
            ? `${relPrefix}/${basename(entry.name, ".md")}`
            : basename(entry.name, ".md")
          const category = entityPath.split("/")[0]

          let title = entityPath
          try {
            const lines = readFileSync(fullPath, "utf-8").split("\n")
            const h1 = lines.find(l => l.startsWith("# "))
            if (h1) title = h1.slice(2).trim()
          } catch { /* use path as title */ }

          if (!categories[category]) categories[category] = []
          categories[category].push({ path: entityPath, title })
        }
      }
    } catch { /* skip */ }
  }
  walkDir(wagDir, "")

  // Write INDEX.md
  const indexLines = ["# Game Wiki\n"]
  let totalEntities = 0
  for (const [cat, entities] of Object.entries(categories)) {
    indexLines.push(`## ${cat} (${entities.length})`)
    for (const e of entities) {
      indexLines.push(`- [[${e.path}]] — ${e.title}`)
    }
    indexLines.push("")
    totalEntities += entities.length
  }
  writeFileSync(join(wagDir, "INDEX.md"), indexLines.join("\n"), "utf-8")

  // Write _meta.json
  const meta = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entityCount: totalEntities,
    categories: Object.keys(categories)
  }
  writeFileSync(join(wagDir, "_meta.json"), JSON.stringify(meta, null, 2), "utf-8")

  return validateWag(projectPath)
}

/**
 * Build a compact WAG index for system prompt injection (~500 tokens).
 * Reads INDEX.md if present, otherwise scans the wag/ directory.
 */
export function buildWagIndex(projectPath: string): string {
  const wagDir = join(projectPath, "wag")
  if (!existsSync(wagDir)) return ""

  // Prefer INDEX.md — it has human-readable descriptions
  const indexPath = join(wagDir, "INDEX.md")
  if (existsSync(indexPath)) {
    try {
      const content = readFileSync(indexPath, "utf-8").trim()
      // Cap at ~2000 chars to stay within ~500 token budget
      if (content.length > 2000) {
        return content.slice(0, 1900) + "\n…(index truncated — use wag_search for details)"
      }
      return content
    } catch { /* fall through to directory scan */ }
  }

  // Fallback: scan directory structure
  const categories: Record<string, string[]> = {}
  const walkDir = (dir: string, relPrefix: string): void => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith("_") || entry.name === "INDEX.md") continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath, relPrefix ? `${relPrefix}/${entry.name}` : entry.name)
        } else if (entry.name.endsWith(".md")) {
          const category = (relPrefix || "misc").split("/")[0]
          const entityName = basename(entry.name, ".md")
          if (!categories[category]) categories[category] = []
          categories[category].push(entityName)
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  walkDir(wagDir, "")

  if (Object.keys(categories).length === 0) return ""

  const lines = ["[Game Wiki]"]
  for (const [cat, entities] of Object.entries(categories)) {
    const shown = entities.slice(0, 12)
    const suffix = entities.length > 12 ? ` …+${entities.length - 12}` : ""
    lines.push(`${cat}: ${shown.join(", ")}${suffix}`)
  }
  return lines.join("\n")
}
