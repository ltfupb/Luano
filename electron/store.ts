import { app, safeStorage, dialog } from "electron"
import { join } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { log } from "./logger"

// Keys that contain secrets and should be encrypted at rest.
// Supports both string values (apiKey etc.) and object values (license).
const ENCRYPTED_KEYS = new Set(["apiKey", "openaiKey", "geminiKey", "license"])

// Simple JSON file-based store with safeStorage encryption (replaces electron-store)
class SimpleStore {
  private data: Record<string, unknown> = {}
  private filePath: string

  constructor(name = "config") {
    const userDataPath = app.getPath("userData")
    mkdirSync(userDataPath, { recursive: true })
    this.filePath = join(userDataPath, `${name}.json`)
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

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8")
    } catch (err) {
      log.error("Failed to save config", err)
      dialog.showErrorBox(
        "Settings Save Failed",
        `Could not save settings to ${this.filePath}. Changes may be lost on restart.`
      )
    }
  }

  /** Encrypt a string using OS keychain via safeStorage */
  private encrypt(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(value).toString("base64")
    }
    return value // fallback: plaintext if OS keychain unavailable
  }

  /** Decrypt a string. Handles both encrypted (base64) and legacy plaintext values */
  private decrypt(stored: string): string {
    if (!safeStorage.isEncryptionAvailable()) return stored
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
    // Legacy unencrypted object (e.g. license stored before this fix) — re-encrypt immediately
    if (ENCRYPTED_KEYS.has(key) && raw != null) {
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
