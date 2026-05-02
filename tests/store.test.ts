import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join } from "path"
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs"

const TEST_DIR = join(__dirname, ".tmp-test-store")

// Mock electron before importing store
vi.mock("electron", () => ({
  app: {
    getPath: () => TEST_DIR
  },
  safeStorage: {
    isEncryptionAvailable: () => false // Test plaintext path
  }
}))

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  vi.resetModules()
})

describe("SimpleStore", () => {
  it("creates store and persists data", async () => {
    const { store } = await import("../electron/store")
    store.set("theme", "dark")
    expect(store.get("theme")).toBe("dark")

    // Check file exists
    const filePath = join(TEST_DIR, "config.json")
    expect(existsSync(filePath)).toBe(true)

    const raw = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(raw.theme).toBe("dark")
  })

  it("deletes keys", async () => {
    const { store } = await import("../electron/store")
    store.set("key1", "value1")
    expect(store.get("key1")).toBe("value1")

    store.delete("key1")
    expect(store.get("key1")).toBeUndefined()
  })

  it("returns undefined for non-existent keys", async () => {
    const { store } = await import("../electron/store")
    expect(store.get("nonexistent")).toBeUndefined()
  })

  it("handles complex objects", async () => {
    const { store } = await import("../electron/store")
    const license = { key: "abc", valid: true, nested: { a: 1 } }
    store.set("license", license)
    expect(store.get("license")).toEqual(license)
  })

  it("refuses to persist API keys to disk when encryption unavailable", async () => {
    const { store } = await import("../electron/store")
    store.set("apiKey", "sk-test-key-123")

    // Secret must NOT hit disk when keychain is unavailable — the previous
    // behavior of plaintext-on-disk was a credential-leak bug. Falls back to
    // an in-memory map so the running process can still read it this session.
    const filePath = join(TEST_DIR, "config.json")
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"))
      expect(raw.apiKey).toBeUndefined()
    }

    // get() still returns the value via memory fallback for this process.
    expect(store.get("apiKey")).toBe("sk-test-key-123")
  })

  it("handles corrupted config file gracefully", async () => {
    const { writeFileSync } = await import("fs")
    writeFileSync(join(TEST_DIR, "config.json"), "not valid json", "utf-8")

    const { store } = await import("../electron/store")
    // Should not throw, should start with empty data
    expect(store.get("anything")).toBeUndefined()
  })

  it("migrates legacy unencrypted object off disk on get() when keychain unavailable", async () => {
    const { mkdirSync: mkdir, writeFileSync: write } = await import("fs")
    mkdir(TEST_DIR, { recursive: true })
    // Simulate a legacy config file where 'license' was stored as a plain object (pre-fix)
    write(join(TEST_DIR, "config.json"), JSON.stringify({ license: { key: "abc", valid: true } }), "utf-8")

    const { store } = await import("../electron/store")

    // get() should return the original object value (via in-memory fallback).
    expect(store.get("license")).toEqual({ key: "abc", valid: true })

    // With encryption unavailable (mock above), the migration moves the value
    // to the in-memory map and PURGES it from disk rather than re-writing
    // plaintext. This is the new refuse-to-persist-plaintext guarantee.
    const onDisk = JSON.parse(readFileSync(join(TEST_DIR, "config.json"), "utf-8"))
    expect(onDisk.license).toBeUndefined()
  })
})

// ── SECRET_KEY_PATTERN behavior (defense in depth) ─────────────────────────
//
// The store's SECRET_KEY_PATTERN catches any key name containing
// key/token/secret/password/credential (case-insensitive). Values written
// under those keys must never hit disk when the OS keychain is unavailable.

describe("SimpleStore — SECRET_KEY_PATTERN", () => {
  it("refuses to persist 'userPassword' to disk when encryption unavailable", async () => {
    const { store } = await import("../electron/store")
    store.set("userPassword", "hunter2")

    const filePath = join(TEST_DIR, "config.json")
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"))
      // Must not leak to disk — the key name matches SECRET_KEY_PATTERN.
      expect(raw.userPassword).toBeUndefined()
    }

    // Memory fallback still serves the value for this session.
    expect(store.get("userPassword")).toBe("hunter2")
  })

  it("treats 'apiKeyHint' as secret-shaped (pattern match, goes to memory)", async () => {
    // Behavior assertion, not a bug: SECRET_KEY_PATTERN is intentionally
    // permissive — any key containing "key" (including benign-looking
    // names like "apiKeyHint") goes to the in-memory fallback instead of
    // disk. This is defense in depth. Downstream code that genuinely wants
    // to persist a non-secret hint should pick a different key name.
    const { store } = await import("../electron/store")
    store.set("apiKeyHint", "blurred")

    const filePath = join(TEST_DIR, "config.json")
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"))
      expect(raw.apiKeyHint).toBeUndefined()
    }
    // Memory fallback serves it back.
    expect(store.get("apiKeyHint")).toBe("blurred")
  })

  it("persists 'theme' (non-secret-shaped key) to disk", async () => {
    const { store } = await import("../electron/store")
    store.set("theme", "dark")

    const filePath = join(TEST_DIR, "config.json")
    expect(existsSync(filePath)).toBe(true)
    const raw = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(raw.theme).toBe("dark")
  })

  it("delete('apiKey') removes from both memory fallback and disk", async () => {
    const { store } = await import("../electron/store")

    // Set via memory fallback (encryption unavailable).
    store.set("apiKey", "sk-secret-xyz")
    expect(store.get("apiKey")).toBe("sk-secret-xyz")

    // Plant a stale on-disk copy too so we can verify delete() purges it.
    const filePath = join(TEST_DIR, "config.json")
    const current = existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf-8")) : {}
    current.apiKey = "stale-plaintext"
    const { writeFileSync: write } = await import("fs")
    write(filePath, JSON.stringify(current), "utf-8")

    store.delete("apiKey")

    // Gone from memory.
    expect(store.get("apiKey")).toBeUndefined()
    // Gone from disk.
    const after = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(after.apiKey).toBeUndefined()
  })
})

// ── Encryption available: roundtrip to real ciphertext on disk ─────────────

describe("SimpleStore — encryption available", () => {
  it("set+get roundtrip for 'apiKey' stores ciphertext on disk and returns plain value via get()", async () => {
    // Override the electron mock just for this test so safeStorage looks real.
    vi.resetModules()
    vi.doMock("electron", () => ({
      app: { getPath: () => TEST_DIR },
      safeStorage: {
        isEncryptionAvailable: () => true,
        // Simple reversible transform — NOT real crypto, just enough for this
        // test to verify ciphertext-on-disk and plaintext-on-get.
        encryptString: (s: string) => Buffer.from(`ENC::${s}`),
        decryptString: (buf: Buffer) => buf.toString("utf-8").replace(/^ENC::/, "")
      }
    }))

    const { store } = await import("../electron/store")
    store.set("apiKey", "sk-real-key-456")

    const filePath = join(TEST_DIR, "config.json")
    const raw = JSON.parse(readFileSync(filePath, "utf-8"))

    // Ciphertext on disk — never the plaintext.
    expect(raw.apiKey).toBeDefined()
    expect(raw.apiKey).not.toBe("sk-real-key-456")
    // Our fake encrypt stores base64 of "ENC::sk-real-key-456".
    expect(Buffer.from(raw.apiKey, "base64").toString("utf-8")).toContain("sk-real-key-456")

    // get() decrypts and returns the plain value.
    expect(store.get("apiKey")).toBe("sk-real-key-456")
  })
})
