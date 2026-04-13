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

  it("stores API keys as plaintext when encryption unavailable", async () => {
    const { store } = await import("../electron/store")
    store.set("apiKey", "sk-test-key-123")

    // When safeStorage unavailable, key stored as-is
    const filePath = join(TEST_DIR, "config.json")
    const raw = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(raw.apiKey).toBe("sk-test-key-123")

    // get() returns the same value
    expect(store.get("apiKey")).toBe("sk-test-key-123")
  })

  it("handles corrupted config file gracefully", async () => {
    const { writeFileSync } = await import("fs")
    writeFileSync(join(TEST_DIR, "config.json"), "not valid json", "utf-8")

    const { store } = await import("../electron/store")
    // Should not throw, should start with empty data
    expect(store.get("anything")).toBeUndefined()
  })

  it("re-encrypts legacy unencrypted object on get()", async () => {
    const { mkdirSync: mkdir, writeFileSync: write } = await import("fs")
    mkdir(TEST_DIR, { recursive: true })
    // Simulate a legacy config file where 'license' was stored as a plain object (pre-fix)
    write(join(TEST_DIR, "config.json"), JSON.stringify({ license: { key: "abc", valid: true } }), "utf-8")

    const { store } = await import("../electron/store")

    // get() should return the original object value
    expect(store.get("license")).toEqual({ key: "abc", valid: true })

    // After get(), the on-disk value must be re-encrypted (no longer a raw object)
    const onDisk = JSON.parse(readFileSync(join(TEST_DIR, "config.json"), "utf-8"))
    expect(typeof onDisk.license).toBe("string") // was re-encrypted to a string
    expect(onDisk.license).not.toEqual({ key: "abc", valid: true })
  })
})
