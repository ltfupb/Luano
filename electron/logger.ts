import { app } from "electron"
import { join } from "path"
import { appendFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "fs"

const MAX_LOG_FILES = 5
const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5 MB

let logDir: string
let logFile: string

function ensureLogDir(): void {
  if (logDir) return
  logDir = join(app.getPath("userData"), "logs")
  mkdirSync(logDir, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  logFile = join(logDir, `luano-${date}.log`)
  rotateOldLogs()
}

function rotateOldLogs(): void {
  try {
    const files = readdirSync(logDir)
      .filter((f) => f.startsWith("luano-") && f.endsWith(".log"))
      .map((f) => ({ name: f, path: join(logDir, f), mtime: statSync(join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    // Remove old files beyond MAX_LOG_FILES
    for (const f of files.slice(MAX_LOG_FILES)) {
      try { unlinkSync(f.path) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

function format(a: unknown): string {
  if (typeof a === "string") return a
  if (a instanceof Error) return a.stack ? a.stack : `${a.name}: ${a.message}`
  // Some thrown values are plain objects with message/stack but aren't Error instances
  if (a && typeof a === "object") {
    const o = a as { message?: unknown; stack?: unknown }
    if (typeof o.stack === "string") return o.stack
    if (typeof o.message === "string") return o.message
    try { return JSON.stringify(a) } catch { return String(a) }
  }
  return String(a)
}

function write(level: string, ...args: unknown[]): void {
  ensureLogDir()
  const ts = new Date().toISOString()
  const msg = args.map(format).join(" ")
  const line = `[${ts}] [${level}] ${msg}\n`

  // In dev, mirror to stdout/stderr so logs show up in the terminal running `npm run dev`.
  // Packaged builds stay file-only to avoid polluting the user's shell.
  if (!app.isPackaged) {
    const out = level === "ERROR" || level === "WARN" ? process.stderr : process.stdout
    out.write(line)
  }

  try {
    // Skip if file too large
    if (existsSync(logFile) && statSync(logFile).size > MAX_LOG_SIZE) return
    appendFileSync(logFile, line, "utf-8")
  } catch { /* disk full or locked — skip silently */ }
}

export const log = {
  info: (...args: unknown[]) => write("INFO", ...args),
  warn: (...args: unknown[]) => write("WARN", ...args),
  error: (...args: unknown[]) => write("ERROR", ...args),
  debug: (...args: unknown[]) => write("DEBUG", ...args)
}
