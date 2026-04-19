import { app, safeStorage, dialog } from "electron"
import { join } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, fsyncSync, unlinkSync } from "fs"
import { randomUUID } from "node:crypto"
import { log } from "./logger"

// Keys that contain secrets and should be encrypted at rest.
// Supports both string values (apiKey etc.) and object values (license).
const ENCRYPTED_KEYS = new Set(["apiKey", "openaiKey", "geminiKey", "license"])

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
      log.warn("Config file corrupted or unreadable, starting fresh", err)
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
      dialog.showErrorBox(
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
    const raw = this.data[key]
    if (ENCRYPTED_KEYS.has(key) && typeof raw === "string" && raw) {
      const decrypted = this.decrypt(raw)
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
      this.set(key, raw)
    }
    return raw as T | undefined
  }

  set(key: string, value: unknown): void {
    if (ENCRYPTED_KEYS.has(key) && value != null) {
      const serialized = typeof value === "string" ? value : JSON.stringify(value)
      this.data[key] = this.encrypt(serialized)
    } else {
      this.data[key] = value
    }
    this.save()
  }

  delete(key: string): void {
    delete this.data[key]
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
