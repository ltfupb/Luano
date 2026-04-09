/**
 * electron/telemetry/collector.ts — Local telemetry collection (opt-in)
 *
 * Collects anonymous AI improvement data to a local SQLite database.
 * Nothing is sent to any server — all data stays on the user's machine.
 * Collection only happens when the user explicitly enables it in Settings.
 */

import Database from "better-sqlite3"
import { join } from "path"
import { app } from "electron"
import { store } from "../store"

let db: Database.Database | null = null

function getDb(): Database.Database | null {
  if (!isEnabled()) return null
  if (db) return db

  try {
    const dbPath = join(app.getPath("userData"), "telemetry.db")
    db = new Database(dbPath)
    db.pragma("journal_mode = WAL")
    initSchema(db)
    return db
  } catch {
    return null
  }
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS diff_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ai_generated TEXT NOT NULL,
      user_edited TEXT NOT NULL,
      file_type TEXT NOT NULL,
      apis_used TEXT,
      lint_errors_before INTEGER,
      lint_errors_after INTEGER,
      accepted INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS query_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_query TEXT NOT NULL,
      apis_referenced TEXT,
      rag_hit INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS error_fix_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      error_message TEXT NOT NULL,
      fix_applied TEXT NOT NULL,
      fix_worked INTEGER,
      created_at INTEGER NOT NULL
    );
  `)
}

// ── Public API ──────────────────────────────────────────────────────────────

export function isEnabled(): boolean {
  return (store.get("telemetryEnabled") as boolean | undefined) === true
}

export function setEnabled(enabled: boolean): void {
  store.set("telemetryEnabled", enabled)
  if (!enabled && db) {
    db.close()
    db = null
  }
}

export interface DiffEntry {
  aiGenerated: string
  userEdited: string
  fileType: string
  apisUsed: string[]
  lintErrorsBefore: number
  lintErrorsAfter: number
  accepted: boolean
}

export function recordDiff(entry: DiffEntry): void {
  const database = getDb()
  if (!database) return
  try {
    database.prepare(`
      INSERT INTO diff_entries (ai_generated, user_edited, file_type, apis_used, lint_errors_before, lint_errors_after, accepted, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.aiGenerated,
      entry.userEdited,
      entry.fileType,
      JSON.stringify(entry.apisUsed),
      entry.lintErrorsBefore,
      entry.lintErrorsAfter,
      entry.accepted ? 1 : 0,
      Date.now()
    )
  } catch { /* silent — telemetry must never break the app */ }
}

export interface QueryEntry {
  userQuery: string
  apisReferenced: string[]
  ragHit: boolean
}

export function recordQuery(entry: QueryEntry): void {
  const database = getDb()
  if (!database) return
  try {
    database.prepare(`
      INSERT INTO query_entries (user_query, apis_referenced, rag_hit, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      entry.userQuery,
      JSON.stringify(entry.apisReferenced),
      entry.ragHit ? 1 : 0,
      Date.now()
    )
  } catch { /* silent */ }
}

export interface ErrorFixEntry {
  errorMessage: string
  fixApplied: string
  fixWorked: boolean
}

export function recordErrorFix(entry: ErrorFixEntry): void {
  const database = getDb()
  if (!database) return
  try {
    database.prepare(`
      INSERT INTO error_fix_entries (error_message, fix_applied, fix_worked, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      entry.errorMessage,
      entry.fixApplied,
      entry.fixWorked ? 1 : 0,
      Date.now()
    )
  } catch { /* silent */ }
}

export function getStats(): { diffs: number; queries: number; errorFixes: number } | null {
  const database = getDb()
  if (!database) return null
  try {
    const diffs = (database.prepare("SELECT COUNT(*) as c FROM diff_entries").get() as { c: number }).c
    const queries = (database.prepare("SELECT COUNT(*) as c FROM query_entries").get() as { c: number }).c
    const errorFixes = (database.prepare("SELECT COUNT(*) as c FROM error_fix_entries").get() as { c: number }).c
    return { diffs, queries, errorFixes }
  } catch {
    return null
  }
}
