/**
 * tests/sandbox-junction.test.ts — C1 NTFS junction / reparse-point detection.
 *
 * NTFS junctions and macOS firmlinks are NOT reported as symlinks by lstat,
 * but realpathSync resolves them to their target. validatePath's symlink
 * defense layer must catch this — otherwise an attacker who can drop a
 * junction inside a project root could escape the sandbox via a path that
 * passes the realpath prefix check.
 *
 * We mock fs at the module level so we can simulate a junction without
 * actually creating one (which on Windows requires admin / Developer Mode).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { sep } from "path"

const h = vi.hoisted(() => ({
  mockRealpathNative: vi.fn(),
  mockLstatSync: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(true),
}))

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs")
  return {
    ...actual,
    realpathSync: Object.assign(
      (p: string) => h.mockRealpathNative(p),
      { native: (p: string) => h.mockRealpathNative(p) }
    ),
    lstatSync: (p: string) => h.mockLstatSync(p),
    existsSync: (p: string) => h.mockExistsSync(p),
    mkdirSync: vi.fn(),
    openSync: vi.fn(),
  }
})

import { assertNoEscapingSymlink } from "../electron/file/sandbox"

beforeEach(() => {
  vi.clearAllMocks()
  h.mockExistsSync.mockReturnValue(true)
})

describe("C1 — assertNoEscapingSymlink junction / reparse-point detection", () => {
  // Helper for posix-shaped tests. The implementation uses path.sep at runtime,
  // so on Windows the actual fixture data will use backslashes. We work with
  // forward slashes here and rely on join/sep handling — the C1 logic compares
  // realpath strings exactly, so the test is platform-independent as long as
  // we feed it the right shaped strings.
  const ROOT = `${sep}project${sep}root`
  const JUNCTION_DIR = `${sep}project${sep}root${sep}junction`
  const OUT_OF_ROOT_TARGET = `${sep}outside${sep}junction-target`

  it("throws /Junction/ when an in-root directory is a junction whose target is out-of-root", () => {
    // realpathSync.native:
    //   - junction directory → out-of-root target (this is the junction!)
    //   - root itself → root (not a junction)
    h.mockRealpathNative.mockImplementation((p: string) => {
      if (p === JUNCTION_DIR) return OUT_OF_ROOT_TARGET
      if (p === ROOT) return ROOT
      // Any other ancestor — pass through (e.g., /project, sep)
      return p
    })

    // lstatSync: junction reports as a regular directory (NOT a symlink) — this
    // is what makes NTFS junctions / macOS firmlinks dangerous. The plain
    // symlink branch would not catch them.
    h.mockLstatSync.mockImplementation((p: string) => {
      if (p === JUNCTION_DIR) {
        return { isSymbolicLink: () => false, isDirectory: () => true } as unknown as ReturnType<typeof import("fs").lstatSync>
      }
      // Other ancestors are also plain directories (not symlinks). Their
      // realpath equals their resolved form so the C1 mismatch check passes.
      return { isSymbolicLink: () => false, isDirectory: () => true } as unknown as ReturnType<typeof import("fs").lstatSync>
    })

    expect(() => assertNoEscapingSymlink(JUNCTION_DIR, ROOT)).toThrow(/Junction/)
  })

  it("does NOT throw when a directory's realpath equals its resolved form (no junction)", () => {
    // No junction anywhere — every realpath returns the input. Walk should
    // complete cleanly.
    h.mockRealpathNative.mockImplementation((p: string) => p)
    h.mockLstatSync.mockImplementation(() => ({
      isSymbolicLink: () => false,
      isDirectory: () => true,
    }) as unknown as ReturnType<typeof import("fs").lstatSync>)

    expect(() => assertNoEscapingSymlink(JUNCTION_DIR, ROOT)).not.toThrow()
  })

  it("does NOT throw when the junction target is INSIDE the root (subdir junction)", () => {
    // A junction that points to another path INSIDE the same project is fine
    // — it's a symlink/junction the user themselves set up to alias one
    // project folder to another. realpath differs from resolve, but the
    // target is still under root.
    const insideTarget = `${ROOT}${sep}other-folder`
    h.mockRealpathNative.mockImplementation((p: string) => {
      if (p === JUNCTION_DIR) return insideTarget
      if (p === ROOT) return ROOT
      return p
    })
    h.mockLstatSync.mockImplementation(() => ({
      isSymbolicLink: () => false,
      isDirectory: () => true,
    }) as unknown as ReturnType<typeof import("fs").lstatSync>)

    expect(() => assertNoEscapingSymlink(JUNCTION_DIR, ROOT)).not.toThrow()
  })

  it("re-throws /Junction/ from the inner try/catch (does not get swallowed by the lstat catch)", () => {
    // Regression guard: the inner try/catch on lines around 84-86 must not
    // swallow the Junction error — the outer catch only re-throws messages
    // starting with "Symlink escape blocked" or "Junction".
    h.mockRealpathNative.mockImplementation((p: string) => {
      if (p === JUNCTION_DIR) return OUT_OF_ROOT_TARGET
      if (p === ROOT) return ROOT
      return p
    })
    h.mockLstatSync.mockImplementation(() => ({
      isSymbolicLink: () => false,
      isDirectory: () => true,
    }) as unknown as ReturnType<typeof import("fs").lstatSync>)

    let caught: Error | null = null
    try {
      assertNoEscapingSymlink(JUNCTION_DIR, ROOT)
    } catch (err) {
      caught = err as Error
    }
    expect(caught?.message ?? "").toMatch(/^Junction/)
  })
})
