import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { validatePath, isPathSafe, ensureLuanoDir } from "../electron/file/sandbox"
import { assertBasename, createFile, createFolder, renameEntry } from "../electron/file/project"
import { resolve, join } from "path"
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "fs"
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

/**
 * Symlink tests exercise the realpath branches of validatePath. Creating
 * symlinks on Windows requires either admin rights or Developer Mode. To
 * keep CI green across platforms, we skip on win32 — the macOS/Linux runs
 * cover the branches.
 */
describe("validatePath — symlink handling", () => {
  let testRoot: string
  let projectRoot: string
  let outside: string

  beforeEach(() => {
    testRoot = join(tmpdir(), `luano-symlink-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(testRoot, { recursive: true })
    // Use the realpath of the tmp dir — on macOS /tmp is a symlink to /private/tmp,
    // so resolve once up front to avoid spurious mismatches when comparing realpaths.
    testRoot = realpathSync(testRoot)
    projectRoot = join(testRoot, "project")
    outside = join(testRoot, "outside")
    mkdirSync(projectRoot, { recursive: true })
    mkdirSync(outside, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(testRoot, { recursive: true, force: true }) } catch { /* best effort */ }
  })

  it.skipIf(process.platform === "win32")(
    "rejects symlink inside project pointing outside root",
    () => {
      // Write a real file at the escape target, then drop a symlink inside the
      // project that points at it. A naive string-prefix sandbox would think
      // the symlink is "inside" the project — validatePath must realpath it.
      const target = join(outside, "secret.txt")
      writeFileSync(target, "secret")
      const linkInside = join(projectRoot, "link.txt")
      symlinkSync(target, linkInside)

      expect(() => validatePath(linkInside, projectRoot)).toThrow(/Symlink escape blocked/)
    }
  )

  it.skipIf(process.platform === "win32")(
    "rejects symlink ancestor whose target does not exist",
    () => {
      // Symlink points outside the project to a path that doesn't exist. The
      // realpathWithFallback branch must still reject based on the symlink
      // target, not the (missing) final file.
      const missingTarget = join(outside, "never-created")
      const linkInside = join(projectRoot, "dangling")
      symlinkSync(missingTarget, linkInside)

      // Candidate is a file *inside* the dangling symlinked directory.
      const candidate = join(linkInside, "file.lua")
      expect(() => validatePath(candidate, projectRoot)).toThrow(/outside project root/)
    }
  )

  it.skipIf(process.platform === "win32")(
    "accepts a candidate inside a symlinked project root",
    () => {
      // Simulate the real-world case where the user's project path is a
      // symlink (e.g. ~/projects → /Volumes/Work/projects). validatePath must
      // realpath both sides so the comparison succeeds.
      const realProject = join(testRoot, "real-project")
      mkdirSync(realProject)
      const symProject = join(testRoot, "sym-project")
      symlinkSync(realProject, symProject)

      const candidate = join(symProject, "src", "init.lua")
      // Pre-create the parent so realpath resolves cleanly; the file itself
      // doesn't need to exist (covers the write-new-file path).
      mkdirSync(join(realProject, "src"))

      const result = validatePath(candidate, symProject)
      // Returned path should be the canonical real path, not the symlinked one.
      expect(result).toBe(join(realProject, "src", "init.lua"))
    }
  )

  it("returns canonical (realpath-resolved) path, not raw input", () => {
    // No symlinks required — on every platform, validatePath promises to
    // return the realpath of existing ancestors. Verify the return value is
    // the realpath form even when the input used a normalized-but-not-real
    // spelling. On macOS /tmp is typically a symlink to /private/tmp: we
    // already realpath'd testRoot in beforeEach, so any input under it
    // should round-trip to the same canonical spelling.
    const nested = join(projectRoot, "nested")
    mkdirSync(nested)
    const result = validatePath(nested, projectRoot)
    expect(result).toBe(realpathSync(nested))
  })
})

// ── assertBasename (name validation for create/rename) ──────────────────────
describe("assertBasename", () => {
  it("accepts normal filenames", () => {
    expect(() => assertBasename("init.lua")).not.toThrow()
    expect(() => assertBasename("MyModule.luau")).not.toThrow()
    expect(() => assertBasename("file with spaces.txt")).not.toThrow()
    expect(() => assertBasename("dotted.name.file.md")).not.toThrow()
  })

  it("rejects path separators (forward and back slashes)", () => {
    expect(() => assertBasename("foo/bar.lua")).toThrow(/path separators/)
    expect(() => assertBasename("foo\\bar.lua")).toThrow(/path separators/)
    expect(() => assertBasename("../escape.lua")).toThrow(/path separators/)
  })

  it("rejects traversal segments", () => {
    expect(() => assertBasename("..")).toThrow(/traversal/)
    expect(() => assertBasename(".")).toThrow(/traversal/)
  })

  it("rejects empty / whitespace-only / NUL-containing names", () => {
    expect(() => assertBasename("")).toThrow(/empty/)
    expect(() => assertBasename("   ")).toThrow(/whitespace/)
    expect(() => assertBasename("bad\0name")).toThrow(/NUL byte/)
  })

  it("rejects Windows reserved device names (even with extension)", () => {
    expect(() => assertBasename("CON")).toThrow(/reserved/)
    expect(() => assertBasename("con.txt")).toThrow(/reserved/)
    expect(() => assertBasename("PRN.log")).toThrow(/reserved/)
    expect(() => assertBasename("COM1")).toThrow(/reserved/)
    expect(() => assertBasename("LPT9.dat")).toThrow(/reserved/)
    expect(() => assertBasename("nul")).toThrow(/reserved/)
  })

  it("allows reserved-like but non-reserved names", () => {
    // "CONE", "COM0", "LPT", "LPT10" are not reserved.
    expect(() => assertBasename("CONE.lua")).not.toThrow()
    expect(() => assertBasename("COM0.lua")).not.toThrow()
    expect(() => assertBasename("LPT.lua")).not.toThrow()
    expect(() => assertBasename("LPT10.lua")).not.toThrow()
  })

  it("rejects names longer than 255 chars", () => {
    const long = "a".repeat(256)
    expect(() => assertBasename(long)).toThrow(/exceeds 255/)
  })

  it("rejects trailing space or dot (Windows strips them silently)", () => {
    expect(() => assertBasename("foo ")).toThrow(/trailing/)
    expect(() => assertBasename("foo.")).toThrow(/trailing/)
  })
})

// ── create/rename name validation (IPC-level integration) ───────────────────
describe("create/rename helpers reject malicious names", () => {
  let root: string
  beforeEach(() => {
    root = join(tmpdir(), `luano-name-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(root, { recursive: true })
    root = realpathSync(root)
  })
  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ }
  })

  it("createFile refuses name with traversal — parent is validated but name escapes", () => {
    // The parent (root) is inside root, but the name `../evil.lua` would
    // escape once join()ed. assertBasename must catch this.
    expect(() => createFile(root, "../evil.lua", root)).toThrow(/path separators|traversal/)
  })

  it("createFolder refuses name with forward-slash segment", () => {
    expect(() => createFolder(root, "inner/nested", root)).toThrow(/path separators/)
  })

  it("renameEntry refuses reserved Windows name", () => {
    const target = join(root, "file.lua")
    writeFileSync(target, "")
    expect(() => renameEntry(target, "CON.lua", root)).toThrow(/reserved/)
    // File untouched on rejection
    expect(existsSync(target)).toBe(true)
  })

  it("createFile with valid name round-trips through validatePath", () => {
    const p = createFile(root, "good.lua", root)
    expect(p).toBe(join(root, "good.lua"))
    expect(existsSync(p)).toBe(true)
  })
})
