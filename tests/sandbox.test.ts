import { describe, it, expect } from "vitest"
import { validatePath, isPathSafe } from "../electron/file/sandbox"
import { resolve } from "path"

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
