import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { validatePath, isPathSafe, ensureLuanoDir } from "../electron/file/sandbox"
import { resolve, join } from "path"
import { existsSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"

describe("validatePath", () => {
  const root = resolve("/project/my-game")

  it("accepts paths within project root", () => {
    const result = validatePath("/project/my-game/src/server.lua", root)
    expect(result).toBe(resolve("/project/my-game/src/server.lua"))
  })

  it("accepts relative paths resolved within root", () => {
    const result = validatePath("src/server.lua", root)
    expect(result).toBe(resolve(root, "src/server.lua"))
  })

  it("blocks path traversal with ..", () => {
    expect(() => validatePath("/project/my-game/../../etc/passwd", root)).toThrow("Path traversal blocked")
  })

  it("blocks absolute paths outside root", () => {
    expect(() => validatePath("/etc/passwd", root)).toThrow("Path traversal blocked")
  })

  it("blocks sneaky traversal", () => {
    expect(() => validatePath("/project/my-game/src/../../other-project/file.lua", root)).toThrow("Path traversal blocked")
  })

  it("accepts nested subdirectories", () => {
    const result = validatePath("/project/my-game/src/server/modules/deep/file.lua", root)
    expect(result).toBe(resolve("/project/my-game/src/server/modules/deep/file.lua"))
  })
})

describe("isPathSafe", () => {
  const root = resolve("/project/my-game")

  it("returns true for safe paths", () => {
    expect(isPathSafe("/project/my-game/src/init.lua", root)).toBe(true)
  })

  it("returns false for traversal paths", () => {
    expect(isPathSafe("/etc/passwd", root)).toBe(false)
  })
})

describe("ensureLuanoDir", () => {
  // Use an OS temp dir so we exercise the real fs — the helper is 3 lines
  // and mocking adds no confidence. Clean up after each test.
  let testRoot: string

  beforeEach(() => {
    testRoot = join(tmpdir(), `luano-sandbox-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(testRoot, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(testRoot, { recursive: true, force: true }) } catch { /* best effort */ }
  })

  it("creates .luano/ when it does not exist", () => {
    ensureLuanoDir(testRoot)
    expect(existsSync(join(testRoot, ".luano"))).toBe(true)
  })

  it("is a no-op when .luano/ already exists", () => {
    const dir = join(testRoot, ".luano")
    mkdirSync(dir)
    // Calling again must not throw (mkdir would throw without recursive:true
    // on second call — the helper's recursive:true keeps us idempotent).
    expect(() => ensureLuanoDir(testRoot)).not.toThrow()
    expect(existsSync(dir)).toBe(true)
  })

  it("creates the project path itself if missing (recursive)", () => {
    const nested = join(testRoot, "deep", "nested", "project")
    // Parent deep/nested/project doesn't exist yet. With recursive:true
    // the .luano/ and all parents should be created together.
    ensureLuanoDir(nested)
    expect(existsSync(join(nested, ".luano"))).toBe(true)
  })
})
