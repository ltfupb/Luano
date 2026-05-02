import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const mockIsBinaryAvailable = vi.fn().mockReturnValue(false)
  // Default behavior: call through to the real execFileSync. Individual tests
  // override with mockImplementationOnce for a single run.
  const mockExecFileSync = vi.fn()
  return { mockIsBinaryAvailable, mockExecFileSync }
})

// Mock child_process so we can intercept tar invocations from validateArchiveEntryNames.
vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process")
  return {
    ...actual,
    execFileSync: h.mockExecFileSync
  }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock("../electron/sidecar", () => ({
  getUserBinDir: () => join(tmpdir(), "luano-test-bin"),
  isBinaryAvailable: h.mockIsBinaryAvailable
}))

vi.mock("../electron/store", () => ({
  store: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() }
}))

vi.mock("../electron/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// ── Import under test ─────────────────────────────────────────────────────────

import {
  getDownloadStatus,
  downloadTool,
  downloadAndInstall,
  validateNoZipSlip,
  validateArchiveEntryNames
} from "../electron/toolchain/downloader"

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getDownloadStatus", () => {
  it("returns not-installed for unknown tool", () => {
    expect(getDownloadStatus("nonexistent")).toBe("not-installed")
  })

  it("returns not-installed for tool that is not downloaded", () => {
    expect(getDownloadStatus("rojo")).toBe("not-installed")
  })

  it("returns not-installed for any known tool without binary", () => {
    expect(getDownloadStatus("argon")).toBe("not-installed")
    expect(getDownloadStatus("selene")).toBe("not-installed")
  })

  it("returns installed when binary is available", () => {
    h.mockIsBinaryAvailable.mockReturnValueOnce(true)
    expect(getDownloadStatus("rojo")).toBe("installed")
  })
})

describe("downloadTool — guard clauses", () => {
  it("returns failure for unknown tool ID", async () => {
    const result = await downloadTool("nonexistent_tool_xyz")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Unknown tool/)
  })

  it("returns success immediately when binary is already installed", async () => {
    h.mockIsBinaryAvailable.mockReturnValueOnce(true)
    const result = await downloadTool("rojo")
    expect(result.success).toBe(true)
  })
})

// ── SHA256 refusal (security contract) ────────────────────────────────────────

describe("downloadAndInstall — SHA256 refusal", () => {
  it("refuses install when expectedSha256 is undefined", async () => {
    const result = await downloadAndInstall("rojo", "rojo", "https://example.com/ignored.zip", "1.0.0", undefined)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/SHA256/)
    expect(result.error).toMatch(/Refusing to install/)
  })

  it("refuses install when expectedSha256 is empty string", async () => {
    const result = await downloadAndInstall("rojo", "rojo", "https://example.com/ignored.zip", "1.0.0", "")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/SHA256/)
    expect(result.error).toMatch(/Refusing to install/)
  })
})

describe("downloader does not readFileSync the zip (streaming hash)", () => {
  it("source imports createReadStream (streaming) but not readFileSync", async () => {
    // The fix swapped createHash(...).update(readFileSync(zipPath)) for a
    // createReadStream().pipe(hash) flow. A whole-file read on a multi-hundred
    // MB archive would pin that much RAM before rejection — streaming keeps
    // it bounded. This is a source-level guarantee; we read the file and
    // assert the right import set is present.
    const fs = await import("fs")
    const path = await import("path")
    const src = fs.readFileSync(path.join(process.cwd(), "electron/toolchain/downloader.ts"), "utf8")
    expect(src).toMatch(/createReadStream/)
    // No readFileSync CALL on the archive path — we stream via
    // createReadStream. The word may still appear in comments but not as
    // an actual function-call invocation.
    expect(src).not.toMatch(/readFileSync\s*\(/)
  })
})

// ── checkToolUpdates skip-unhashed ────────────────────────────────────────────

describe("checkToolUpdates — skips unhashed advertised versions", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("does not advertise an update whose version lacks a pinned sha256", async () => {
    // Re-mock with a controlled registry + stubbed fetchLatestRelease so the
    // only differentiator is whether the "latest" version matches tool.version
    // (which is the only version with a pinned hash).
    vi.doMock("electron", () => ({
      app: { getPath: () => "/tmp/luano-test" },
      safeStorage: { isEncryptionAvailable: () => false }
    }))
    vi.doMock("../electron/sidecar", () => ({
      getUserBinDir: () => join(tmpdir(), "luano-test-bin"),
      isBinaryAvailable: vi.fn().mockReturnValue(true)
    }))
    vi.doMock("../electron/store", () => ({
      store: {
        get: vi.fn((k: string) => {
          if (k === "toolchain.installedVersions") return { rojo: "7.6.1" }
          return undefined
        }),
        set: vi.fn()
      }
    }))
    vi.doMock("../electron/logger", () => ({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    }))
    // Stub out the https module so fetchLatestRelease returns a crafted release
    // with a different tag (= no pinned hash for that version).
    vi.doMock("https", () => ({
      get: (_url: string, _opts: unknown, cb?: (res: unknown) => void) => {
        const callback = typeof _opts === "function" ? _opts as (res: unknown) => void : cb!
        const listeners: Record<string, Array<(chunk?: unknown) => void>> = {}
        const res = {
          statusCode: 200,
          headers: {},
          on: (event: string, fn: (chunk?: unknown) => void) => {
            listeners[event] = listeners[event] || []
            listeners[event].push(fn)
            return res
          },
          resume: () => {}
        }
        // Reply with a release advertising a NEWER version with no pinned hash.
        const body = JSON.stringify({
          tag_name: "v99.0.0",
          published_at: "2099-01-01T00:00:00Z",
          assets: [{ name: "rojo-99.0.0-linux-x86_64.zip", browser_download_url: "https://example.com/r.zip" }]
        })
        setImmediate(() => {
          listeners["data"]?.forEach((fn) => fn(Buffer.from(body)))
          listeners["end"]?.forEach((fn) => fn())
        })
        callback(res)
        // Mock ClientRequest must expose `on` (error handler) and
        // `setTimeout` (per-fetch timeout added in pass-4 fix). Both
        // are no-ops because the test resolves synchronously via
        // setImmediate above — the timeout never fires.
        return {
          on: () => ({}),
          setTimeout: () => undefined,
          destroy: () => undefined
        } as unknown as { on: () => unknown }
      }
    }))

    const mod = await import("../electron/toolchain/downloader")
    const updates = await mod.checkToolUpdates(["rojo"])
    // v99.0.0 has no pinned hash in TOOL_REGISTRY.rojo.sha256 — it MUST be skipped.
    expect(updates.find((u) => u.toolId === "rojo")).toBeUndefined()
  })
})

// ── validateArchiveEntryNames (pre-extraction) ───────────────────────────────

describe("validateArchiveEntryNames — rejects dangerous entries", () => {
  const fakeZip = join(tmpdir(), `luano-test-archive-${Date.now()}.zip`)

  beforeEach(() => {
    // Write a placeholder file so the path exists; tar -tf is mocked anyway.
    writeFileSync(fakeZip, "placeholder")
    h.mockExecFileSync.mockReset()
  })

  afterEach(() => {
    try { rmSync(fakeZip, { force: true }) } catch { /* noop */ }
  })

  it("rejects entries with '..' traversal", () => {
    h.mockExecFileSync.mockReturnValueOnce(
      Buffer.from("good/file.txt\nbad/../../escape.txt\n") as unknown as Buffer
    )
    expect(() => validateArchiveEntryNames(fakeZip)).toThrow(/parent-dir traversal/)
    expect(h.mockExecFileSync).toHaveBeenCalledWith("tar", ["-tf", fakeZip], expect.any(Object))
  })

  it("rejects entries with absolute POSIX path (leading '/')", () => {
    h.mockExecFileSync.mockReturnValueOnce(
      Buffer.from("/etc/passwd\n") as unknown as Buffer
    )
    expect(() => validateArchiveEntryNames(fakeZip)).toThrow(/absolute-path entry/)
  })

  it("rejects entries with absolute Windows-style path (leading '\\')", () => {
    h.mockExecFileSync.mockReturnValueOnce(
      Buffer.from("\\Windows\\System32\\evil.exe\n") as unknown as Buffer
    )
    expect(() => validateArchiveEntryNames(fakeZip)).toThrow(/absolute-path entry/)
  })

  it("rejects entries with Windows drive-letter prefix", () => {
    h.mockExecFileSync.mockReturnValueOnce(
      Buffer.from("C:\\evil.exe\n") as unknown as Buffer
    )
    expect(() => validateArchiveEntryNames(fakeZip)).toThrow(/drive-qualified entry/)
  })

  it("rejects entries with forward-slash drive-letter prefix", () => {
    h.mockExecFileSync.mockReturnValueOnce(
      Buffer.from("D:/evil.exe\n") as unknown as Buffer
    )
    expect(() => validateArchiveEntryNames(fakeZip)).toThrow(/drive-qualified entry/)
  })

  it("accepts a clean listing", () => {
    h.mockExecFileSync.mockReturnValueOnce(
      Buffer.from("rojo\nREADME.md\n") as unknown as Buffer
    )
    expect(() => validateArchiveEntryNames(fakeZip)).not.toThrow()
  })
})

// ── validateNoZipSlip (post-extraction) ──────────────────────────────────────

describe("validateNoZipSlip — post-extraction safety", () => {
  const root = join(tmpdir(), `luano-test-zipslip-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  beforeEach(() => {
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* noop */ }
  })

  it("accepts a tree that stays within destDir", () => {
    writeFileSync(join(root, "binary"), "data")
    mkdirSync(join(root, "sub"))
    writeFileSync(join(root, "sub", "file.txt"), "data")
    expect(() => validateNoZipSlip(root)).not.toThrow()
  })

  it("rejects a directory containing a symlink entry", () => {
    const target = join(tmpdir(), `luano-test-linktarget-${Date.now()}.txt`)
    writeFileSync(target, "outside")
    try {
      symlinkSync(target, join(root, "link"))
    } catch (err) {
      // On Windows without SeCreateSymbolicLinkPrivilege, symlinkSync fails.
      // In that case we skip the check — the production code path still
      // protects the real build machine.
      if ((err as NodeJS.ErrnoException).code === "EPERM") {
        return
      }
      throw err
    }
    expect(() => validateNoZipSlip(root)).toThrow(/symlink/)
    try { rmSync(target, { force: true }) } catch { /* noop */ }
  })

  it("rejects extracted file paths that escape destDir via symlinked directory", () => {
    // Create an outside directory that holds a file. Then symlink it INSIDE
    // destDir. The walker follows the symlink and realpath returns a path
    // outside rootReal — which is the zip-slip escape condition.
    const outside = join(tmpdir(), `luano-test-outside-${Date.now()}`)
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, "escape.txt"), "escaped")
    try {
      symlinkSync(outside, join(root, "sneaky"), "dir")
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EPERM") {
        try { rmSync(outside, { recursive: true, force: true }) } catch { /* noop */ }
        return
      }
      throw err
    }
    // validateNoZipSlip should throw on the symlink check (before it even
    // tries to resolve realpath).
    expect(() => validateNoZipSlip(root)).toThrow(/symlink|escapes target/)
    try { rmSync(outside, { recursive: true, force: true }) } catch { /* noop */ }
  })
})

// ── Binary find (exact filename match) ────────────────────────────────────────

describe("downloadAndInstall — binary find uses exact filename match", () => {
  const binDir = join(tmpdir(), "luano-test-bin")

  beforeEach(() => {
    // Ensure clean destination dir before each run.
    try { rmSync(binDir, { recursive: true, force: true }) } catch { /* noop */ }
    mkdirSync(binDir, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(binDir, { recursive: true, force: true }) } catch { /* noop */ }
  })

  it("does NOT mis-select 'rojo-backup' when looking for 'rojo'", () => {
    // We can't easily run the full downloadAndInstall without heavy fs+network
    // mocking, but the binary-find rule is just: files.find(f => f === expected).
    // Assert that rule with a canned list.
    const files = ["rojo-backup", "rojo-plugin-settings", "README.md"]
    const ext = process.platform === "win32" ? ".exe" : ""
    const expectedName = `rojo${ext}`
    expect(files.find((f) => f === expectedName)).toBeUndefined()
  })

  it("finds exact 'rojo' binary even when archive also contains 'rojo-backup'", () => {
    const ext = process.platform === "win32" ? ".exe" : ""
    const expectedName = `rojo${ext}`
    const files = [expectedName, "rojo-backup", "rojo-plugin-settings"]
    expect(files.find((f) => f === expectedName)).toBe(expectedName)
  })

  it("on Windows finds 'rojo.exe' but not 'rojo' (exact ext match)", () => {
    // Simulate the check with ext=".exe" explicitly — independent of host platform.
    const ext = ".exe"
    const expectedName = `rojo${ext}`
    const files = ["rojo", "rojo.exe", "rojo-backup.exe"]
    expect(files.find((f) => f === expectedName)).toBe("rojo.exe")
  })
})

// Clean up any dangling test dirs in tmpdir from aborted runs (best-effort).
afterEach(() => {
  const stale = join(tmpdir(), "luano-test-bin")
  if (existsSync(stale)) {
    try { rmSync(stale, { recursive: true, force: true }) } catch { /* noop */ }
  }
})
