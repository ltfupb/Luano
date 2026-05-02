import { app, safeStorage, dialog } from "electron"
import { join, dirname, basename } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, fsyncSync, unlinkSync, readdirSync } from "fs"
import { randomUUID } from "node:crypto"
import { log } from "./logger"

// Keys that contain secrets and should be encrypted at rest.
// Supports both string values (apiKey etc.) and object values (license).
const ENCRYPTED_KEYS = new Set(["apiKey", "openaiKey", "geminiKey", "license"])

// Secret-shaped key-name matcher for defense in depth. Any `set()` for a key
// matching this pattern refuses to persist plaintext to disk if the OS
// keychain is unavailable — the value goes to an in-memory fallback instead.
const SECRET_KEY_PATTERN = /key|token|secret|password|credential/i

// In-memory fallback for secrets when OS keychain is unavailable. Scope is
// the lifetime of the process — the user loses the value on restart, which
// is strictly better than leaking it to disk in plaintext.
const memorySecrets = new Map<string, unknown>()

// Simple JSON file-based store with safeStorage encryption (replaces electron-store)
class SimpleStore {
  private data: Record<string, unknown> = {}
  private filePath: string
  private tmpPath: string
  private encryptionWarned = false

  constructor(name = "config") {
    const userDataPath = app.getPath("userData")
    mkdirSync(userDataPath, { recursive: true })
    this.filePath = join(userDataPath, `${name}.json`)
    this.tmpPath = `${this.filePath}.tmp`
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        this.data = JSON.parse(readFileSync(this.filePath, "utf-8"))
      }
    } catch (err) {
      // M7: back up the corrupted config before resetting so the user has a
      // recovery path. Use a timestamped suffix and prune to the most recent
      // 3 backups — a corrupt-config-on-startup loop would otherwise overwrite
      // a single .bak with each successive corrupt version, eventually
      // destroying the original good copy.
      log.warn("Config file corrupted or unreadable, backing up and starting fresh", err)
      try {
        if (existsSync(this.filePath)) {
          const backupPath = `${this.filePath}.bak.${Date.now()}`
          writeFileSync(backupPath, readFileSync(this.filePath))
          log.info(`Config backup written to ${backupPath}`)
          // Retain only the 3 most recent backups for this config file.
          const dir = dirname(this.filePath)
          const prefix = `${basename(this.filePath)}.bak.`
          const backups = readdirSync(dir)
            .filter((n) => n.startsWith(prefix))
            .map((n) => ({ name: n, ts: Number(n.slice(prefix.length)) }))
            .filter((b) => Number.isFinite(b.ts))
            .sort((a, b) => b.ts - a.ts)
          for (const stale of backups.slice(3)) {
            try { unlinkSync(join(dir, stale.name)) } catch { /* ignore */ }
          }
        }
      } catch (backupErr) {
        log.warn("Config backup failed", backupErr)
      }
      this.data = {}
    }
  }

  /**
   * Atomic write: tmp file + fsync + rename. If the process crashes mid-write,
   * the main config file is either the previous version (rename didn't happen)
   * or the new version (rename completed), never a half-written blob. On
   * Windows, rename over an existing file is atomic via ReplaceFile.
   */
  private save(): void {
    try {
      const payload = JSON.stringify(this.data, null, 2)
      writeFileSync(this.tmpPath, payload, "utf-8")
      // Force the tmp file's bytes to disk before the rename — otherwise a
      // power loss between write and rename can leave an empty tmp file that
      // wins the rename and loses settings.
      const fd = openSync(this.tmpPath, "r+")
      try { fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(this.tmpPath, this.filePath)
    } catch (err) {
      log.error("Failed to save config", err)
      // Clean up orphaned tmp file so the next save doesn't fail trying to
      // open the same name with a dirty handle.
      try { if (existsSync(this.tmpPath)) unlinkSync(this.tmpPath) } catch { /* noop */ }
      // Optional-chain dialog so a missing mock (tests) or a headless context
      // can't turn a recoverable save failure into a hard TypeError crash.
      dialog?.showErrorBox?.(
        "Settings Save Failed",
        `Could not save settings to ${this.filePath}. Changes may be lost on restart.`
      )
    }
  }

  /** Warn once if the OS keychain isn't available. Common on headless Linux
   *  without a keyring; unusual (worth investigating) on macOS/Windows. Stored
   *  secrets silently fall back to plaintext in that case. */
  private warnIfEncryptionMissing(): void {
    if (this.encryptionWarned) return
    if (!safeStorage.isEncryptionAvailable()) {
      this.encryptionWarned = true
      log.warn(
        "[store] OS keychain unavailable — API keys and license info will be " +
        "stored in plaintext in config.json. Expected on headless Linux " +
        "without a keyring; unusual on macOS/Windows (investigate)."
      )
    }
  }

  /** Encrypt a string using OS keychain via safeStorage */
  private encrypt(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(value).toString("base64")
    }
    this.warnIfEncryptionMissing()
    return value // fallback: plaintext if OS keychain unavailable
  }

  /** Decrypt a string. Handles both encrypted (base64) and legacy plaintext values */
  private decrypt(stored: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      this.warnIfEncryptionMissing()
      return stored
    }
    try {
      const buf = Buffer.from(stored, "base64")
      return safeStorage.decryptString(buf)
    } catch {
      // Legacy plaintext value — return as-is, will be re-encrypted on next set()
      return stored
    }
  }

  get<T>(key: string): T | undefined {
    // In-memory fallback takes priority — a secret that went to memory in
    // this session should be visible to the rest of the process.
    if (memorySecrets.has(key)) return memorySecrets.get(key) as T | undefined

    const raw = this.data[key]
    if (ENCRYPTED_KEYS.has(key) && typeof raw === "string" && raw) {
      const decrypted = this.decrypt(raw)
      // If the stored value equals the decrypted value, the value was stored
      // in plaintext (decrypt() returns the input on failure). Attempt to
      // re-encrypt, but do NOT swallow errors — if set() throws we still want
      // to return the decrypted value to the caller while surfacing the
      // migration failure.
      if (decrypted === raw && safeStorage.isEncryptionAvailable()) {
        try {
          this.set(key, this.tryParseJson(decrypted))
        } catch (err) {
          log.warn(`[store] Failed to migrate legacy plaintext value for "${key}" to encrypted form`, err)
        }
      }
      try {
        return JSON.parse(decrypted) as T
      } catch {
        // Legacy or plain string value (not JSON-serialized)
        return decrypted as unknown as T
      }
    }
    // Legacy unencrypted object (e.g. license stored before this fix) — re-encrypt immediately.
    // Only trigger for non-string values; a plain string that's already encrypted
    // would have been handled by the branch above (decrypt+return), so reaching
    // here with a string means it was somehow stored unencrypted as a string.
    if (ENCRYPTED_KEYS.has(key) && raw != null && typeof raw !== "string") {
      try {
        this.set(key, raw)
      } catch (err) {
        log.warn(`[store] Failed to migrate legacy unencrypted value for "${key}"`, err)
      }
    }
    return raw as T | undefined
  }

  private tryParseJson(s: string): unknown {
    try { return JSON.parse(s) } catch { return s }
  }

  set(key: string, value: unknown): void {
    const isSecretShaped = ENCRYPTED_KEYS.has(key) || SECRET_KEY_PATTERN.test(key)
    if (isSecretShaped && value != null) {
      if (!safeStorage.isEncryptionAvailable()) {
        // Refuse to write secrets to disk in plaintext. Hold them in memory
        // for this session instead. Caller-visible behavior: get() returns
        // the value while the process is alive, but it's gone on restart.
        this.warnIfEncryptionMissing()
        log.warn(`[store] Refusing to persist secret "${key}" to disk without OS keychain; kept in memory only`)
        memorySecrets.set(key, value)
        // Also purge any legacy on-disk copy to avoid leaking stale secret.
        if (key in this.data) {
          delete this.data[key]
          this.save()
        }
        return
      }
      const serialized = typeof value === "string" ? value : JSON.stringify(value)
      this.data[key] = this.encrypt(serialized)
      // Drop any in-memory fallback now that we have a real encrypted copy.
      memorySecrets.delete(key)
    } else {
      this.data[key] = value
    }
    this.save()
  }

  delete(key: string): void {
    delete this.data[key]
    memorySecrets.delete(key)
    this.save()
  }
}

export const store = new SimpleStore()

/**
 * Returns a stable anonymous ID for this install. Generated once and persisted.
 * Used as Sentry `user.id` so the dashboard reports unique-user counts without
 * collecting PII. Same ID is shared between main and renderer.
 */
export function getAnonymousId(): string {
  let id = store.get<string>("anonymousId")
  if (!id || typeof id !== "string") {
    id = randomUUID()
    store.set("anonymousId", id)
  }
  return id
}
