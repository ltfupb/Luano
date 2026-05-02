import { resolve, normalize, sep, join, dirname, relative } from "path"
import { existsSync, mkdirSync, realpathSync, lstatSync, openSync, readlinkSync } from "fs"

/**
 * Resolve a path with symlinks fully resolved. Returns null if the path
 * (and every ancestor) does not exist yet.
 */
function tryRealpath(p: string): string | null {
  try {
    return realpathSync.native(p)
  } catch {
    return null
  }
}

/**
 * Walk up a path until a real existing ancestor is found, realpath that,
 * then re-attach the remaining tail (unchanged, since those components don't
 * exist yet and therefore can't be symlinks).
 */
function realpathWithFallback(p: string): string {
  const resolved = tryRealpath(p)
  if (resolved !== null) return resolved

  // Find the nearest existing ancestor and realpath that so symlinks in
  // any existing segment are resolved. Non-existent tail is appended raw.
  let current = p
  const tail: string[] = []
  while (true) {
    const parent = dirname(current)
    if (parent === current) {
      // Reached filesystem root without finding anything — bail.
      return normalize(p)
    }
    // Leaf of `current` relative to `parent`. Use `path.relative` so the
    // drive-root edge case (`dirname("C:\\project") === "C:\\"`, which has a
    // trailing sep) is handled correctly — a naive `slice(parent.length + 1)`
    // would chop the first character of "project".
    const leaf = relative(parent, current)
    const realParent = tryRealpath(parent)
    if (realParent !== null) {
      return join(realParent, leaf, ...tail.reverse())
    }
    tail.push(leaf)
    current = parent
  }
}

/**
 * Reject if any existing ancestor component of `p` (up to `root`) is a symlink
 * that points outside `root`. Used as an extra defense layer beyond realpath —
 * catches the case where the target doesn't exist yet but a midpoint symlink
 * already escapes.
 * @internal exported for unit tests (C1 NTFS junction coverage).
 */
export function assertNoEscapingSymlink(p: string, root: string): void {
  let current = p
  while (current.length >= root.length) {
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) {
        // Dangling-symlink case: realpathSync.native throws ENOENT when the
        // symlink target doesn't exist. Fall back to readlinkSync + manual
        // resolve so we still catch escapes via not-yet-created targets.
        let real: string
        try {
          real = realpathSync.native(current)
        } catch {
          const target = readlinkSync(current)
          real = normalize(resolve(dirname(current), target))
        }
        const realRoot = realpathSync.native(root)
        if (real !== realRoot && !real.startsWith(realRoot + sep)) {
          throw new Error(`Symlink escape blocked: ${current} resolves outside project root`)
        }
      } else if (stat.isDirectory()) {
        // C1: detect NTFS junctions / macOS firmlinks — these are not reported
        // as symlinks by lstat but realpathSync resolves them to their target.
        // Compare realpath against normalize(resolve()) — a mismatch means a
        // reparse point. Only check existing directories for performance.
        try {
          const real = realpathSync.native(current)
          const normalized = normalize(resolve(current))
          const same = process.platform === "win32"
            ? real.toLowerCase() === normalized.toLowerCase()
            : real === normalized
          if (!same) {
            // The junction target must still be within the root; if not, block.
            const realRoot = realpathSync.native(root)
            if (real !== realRoot && !real.startsWith(realRoot + sep)) {
              throw new Error(`Junction/reparse-point escape blocked: ${current} resolves outside project root`)
            }
          }
        } catch (err) {
          if (err instanceof Error && (err.message.startsWith("Junction") || err.message.startsWith("Symlink"))) throw err
        }
      }
    } catch (err) {
      if (err instanceof Error && (err.message.startsWith("Symlink escape blocked") || err.message.startsWith("Junction"))) throw err
      // lstat fails on non-existent path — fine, keep walking up.
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

/**
 * Validate that a file path is within the allowed project boundary.
 * Prevents path traversal attacks (e.g., "../../etc/passwd") AND symlink
 * escapes (a symlink inside the project that points outside).
 *
 * For not-yet-existing paths (common for write-new-file), falls back to
 * realpath-ing the nearest existing ancestor, then verifies no ancestor
 * symlink escapes the root.
 *
 * ## TOCTOU caveat (defense-in-depth, NOT a complete fix)
 *
 * The returned path is validated as of *call time*. A local attacker with
 * write access to the project dir can race us: replace the canonical target
 * with a symlink between the call to `validatePath` and the subsequent
 * `readFileSync`/`writeFileSync`. Full mitigation requires `O_NOFOLLOW` +
 * per-fd operations, which Node.js doesn't fully expose on Windows.
 *
 * Callers SHOULD narrow the window:
 *   - Use the returned canonical path (never the raw input) for fs ops.
 *   - For new files, prefer `fs.openSync(path, 'wx')` — exclusive create
 *     fails if the target exists, including if it was just symlinked in.
 *   - For existing-file writes, pre-check with `lstatSync(path).isSymbolicLink()`
 *     and refuse, or use `openNoFollow` below.
 *
 * @returns canonical absolute path (symlinks resolved; non-existent tail left
 *   joined to its real ancestor). Callers MUST use this return value for
 *   downstream filesystem ops — the original `filePath` may be a relative
 *   string whose meaning depends on process.cwd(), or may contain symlink
 *   segments that the validator collapsed.
 * @throws Error if path escapes the project root
 */
export function validatePath(filePath: string, projectRoot: string): string {
  const resolvedCandidate = normalize(resolve(projectRoot, filePath))
  const resolvedRoot = normalize(resolve(projectRoot))

  // First: plain prefix check on resolved paths — catches `../` traversal
  // cheaply before we touch the filesystem.
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(resolvedRoot + sep)) {
    throw new Error(`Path traversal blocked: ${filePath} is outside project root`)
  }

  // Second: resolve symlinks. Both sides must be realpath'd so a symlinked
  // project root still matches. For candidates that don't exist yet, walk up
  // to the nearest existing ancestor.
  const realRoot = tryRealpath(resolvedRoot) ?? resolvedRoot
  const realCandidate = realpathWithFallback(resolvedCandidate)

  if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + sep)) {
    throw new Error(`Symlink escape blocked: ${filePath} resolves outside project root`)
  }

  // Third: defense in depth — reject if any existing ancestor is a symlink
  // pointing outside root. Covers exotic cases where realpath normalization
  // might be bypassed by a race.
  assertNoEscapingSymlink(resolvedCandidate, resolvedRoot)

  // Return the canonical (symlink-resolved) form. Returning the pre-realpath
  // `resolvedCandidate` would let a caller re-traverse symlinks we just
  // validated — defeating the whole point. Downstream fs ops should operate
  // on the realpath so they're referentially identical to what was validated.
  return realCandidate
}

/**
 * Check if a path is within the project root without throwing.
 */
export function isPathSafe(filePath: string, projectRoot: string): boolean {
  try {
    validatePath(filePath, projectRoot)
    return true
  } catch {
    return false
  }
}

/** Ensure the project's `.luano/` state directory exists. */
export function ensureLuanoDir(projectPath: string): void {
  const dir = join(projectPath, ".luano")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * Best-effort "don't follow symlinks" file open. Narrows the TOCTOU window
 * by pre-checking `lstat` and rejecting if the target (or parent) is a
 * symlink, then `openSync` with the requested flags.
 *
 * This is NOT a complete fix — a fast race between the `lstat` and `openSync`
 * can still win. True `O_NOFOLLOW` semantics aren't portable in Node.js
 * (Windows has no direct equivalent). For new-file writes, prefer `wx` flag
 * (exclusive create) which atomically fails if the target exists.
 *
 * @param realPath absolute path, should be the canonical form returned by
 *   `validatePath`. Using the raw user path here would skip the traversal check.
 * @param flags `fs.openSync` flag string, e.g. 'r', 'r+', 'w', 'wx'.
 * @returns file descriptor — caller MUST `fs.closeSync(fd)`.
 * @throws if the path is a symlink, or the open fails.
 */
export function openNoFollow(realPath: string, flags: string): number {
  // For flags that require the file to exist (`r`, `r+`), reject if the target
  // is a symlink. For `wx` (exclusive create), the open itself fails on exists
  // so symlink replacement between check and open still results in EEXIST.
  if (existsSync(realPath)) {
    const stat = lstatSync(realPath)
    if (stat.isSymbolicLink()) {
      throw new Error(`Refused to open symlink: ${realPath}`)
    }
  }
  return openSync(realPath, flags)
}
