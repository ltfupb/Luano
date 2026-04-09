import { existsSync } from "fs"
import { join } from "path"
import { app } from "electron"

interface DocChunk {
  title: string
  content: string
  url?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null

function getDb(): unknown | null {
  if (db) return db

  const devPath = join(app.getAppPath(), "resources", "roblox-docs", "roblox_docs.db")
  const prodPath = join(process.resourcesPath ?? app.getAppPath(), "roblox-docs", "roblox_docs.db")
  const dbPath = existsSync(devPath) ? devPath : existsSync(prodPath) ? prodPath : null
  if (!dbPath) return null

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3")
    db = new Database(dbPath, { readonly: true })
    return db
  } catch {
    return null
  }
}

export function searchDocs(query: string, limit = 3): DocChunk[] {
  const database = getDb() as {
    prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] }
  } | null
  if (!database) return []

  // FTS5 MATCH — escape double-quotes in query
  const safeQuery = query.replace(/"/g, '""').split(/\s+/).join(" OR ")

  try {
    const stmt = database.prepare(`
      SELECT title, content, url
      FROM docs_fts
      WHERE docs_fts MATCH ?
      ORDER BY bm25(docs_fts)
      LIMIT ?
    `)
    return stmt.all(safeQuery, limit) as DocChunk[]
  } catch {
    // fallback: LIKE search on docs table if FTS fails
    try {
      const fallback = database.prepare(`
        SELECT title, content, url FROM docs
        WHERE title LIKE ? OR content LIKE ?
        LIMIT ?
      `)
      const term = `%${query}%`
      return fallback.all(term, term, limit) as DocChunk[]
    } catch {
      return []
    }
  }
}

export function formatDocsForPrompt(chunks: DocChunk[]): string {
  if (chunks.length === 0) return ""
  return chunks.map((c) => `### ${c.title}\n${c.content}${c.url ? `\n(${c.url})` : ""}`).join("\n\n---\n\n")
}
