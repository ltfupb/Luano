/**
 * tests/preload-api.test.ts
 *
 * Structural guard: every method on the preload `api` object must have a
 * corresponding key in one of the `*Api` interfaces composed into
 * `Window.api` (src/types/ipc/*.d.ts), and vice-versa.
 *
 * We can't import electron/preload at test time — `contextBridge` is only
 * available inside an Electron renderer. So we parse both files textually.
 * This is intentionally cheap: we look for top-level `identifier:` lines
 * in the preload's `api = { ... }` object and top-level `identifier:` lines
 * inside each `interface XxxApi { ... }` block.
 *
 * If this test fails, either:
 *   1) preload.ts added a new method — add it to the matching .d.ts too, or
 *   2) the .d.ts declared a key the preload doesn't expose — remove or add it.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "fs"
import { join, resolve } from "path"

const REPO_ROOT = resolve(__dirname, "..")
const PRELOAD_PATH = join(REPO_ROOT, "electron", "preload.ts")
const IPC_TYPES_DIR = join(REPO_ROOT, "src", "types", "ipc")

/** Pull keys out of `const api = { ... }` in preload.ts */
function getPreloadApiKeys(): Set<string> {
  const src = readFileSync(PRELOAD_PATH, "utf-8")

  // Find the start of the api object literal.
  const startMatch = src.match(/const\s+api\s*=\s*\{/)
  if (!startMatch) throw new Error("Could not locate `const api = {` in preload.ts")
  const startIdx = startMatch.index! + startMatch[0].length

  // Walk forward tracking brace depth until we close the api object.
  let depth = 1
  let i = startIdx
  while (i < src.length && depth > 0) {
    const c = src[i]
    // Skip string contents (rough — good enough since we only care about
    // matching outer braces; AI strings don't typically contain unbalanced
    // braces mid-line).
    if (c === "\"" || c === "'" || c === "`") {
      const quote = c
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++
        i++
      }
      i++
      continue
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 2
      continue
    }
    if (c === "{") depth++
    else if (c === "}") depth--
    i++
  }
  const body = src.slice(startIdx, i - 1)

  // Top-level keys only: the body is `  key: ...,\n  key2: ...,\n`. Track
  // both brace and paren depth so nested object literals and multi-line
  // function parameter lists don't leak "keys".
  const keys = new Set<string>()
  let braceDepth = 0
  let parenDepth = 0
  for (const line of body.split("\n")) {
    if (braceDepth === 0 && parenDepth === 0) {
      const m = line.match(/^\s{0,4}([A-Za-z_$][\w$]*)\s*:/)
      if (m) keys.add(m[1])
    }
    const openB = (line.match(/\{/g) || []).length
    const closeB = (line.match(/\}/g) || []).length
    const openP = (line.match(/\(/g) || []).length
    const closeP = (line.match(/\)/g) || []).length
    braceDepth += openB - closeB
    parenDepth += openP - closeP
    if (braceDepth < 0) braceDepth = 0
    if (parenDepth < 0) parenDepth = 0
  }
  return keys
}

/** Pull method names out of every `interface XxxApi { ... }` in .d.ts files. */
function getTypeApiKeys(): Set<string> {
  const keys = new Set<string>()
  for (const file of readdirSync(IPC_TYPES_DIR)) {
    if (!file.endsWith(".d.ts")) continue
    const src = readFileSync(join(IPC_TYPES_DIR, file), "utf-8")

    // Walk the file and extract keys only at the top level of each
    // `interface XxxApi { ... }` block. We must track brace depth because
    // nested return-type object literals (e.g. `() => Promise<{ foo: ... }>`)
    // contain their own `foo: ...` lines at deeper indentation that are NOT
    // api methods.
    const headerRe = /interface\s+\w+Api\s*\{/g
    let hm: RegExpExecArray | null
    while ((hm = headerRe.exec(src)) !== null) {
      // Start walking right after the `{`.
      let i = hm.index + hm[0].length
      let depth = 1
      // Capture the inner body while tracking brace depth.
      let body = ""
      while (i < src.length && depth > 0) {
        const c = src[i]
        if (c === "{") depth++
        else if (c === "}") {
          depth--
          if (depth === 0) break
        }
        body += c
        i++
      }

      // Re-scan the body line by line, but only keep keys when we're at
      // depth 0 relative to the interface body. Track BOTH brace and paren
      // depth: interface methods with multi-line parameter lists look like
      //   methodName: (
      //     arg: type,
      //     arg2: type,
      //   ) => ReturnType
      // and the inner `arg:` lines would otherwise match as top-level keys.
      let braceDepth = 0
      let parenDepth = 0
      for (const line of body.split("\n")) {
        if (braceDepth === 0 && parenDepth === 0) {
          const km = line.match(/^\s+([A-Za-z_$][\w$]*)\??\s*[:(]/)
          if (km) keys.add(km[1])
        }
        const openB = (line.match(/\{/g) || []).length
        const closeB = (line.match(/\}/g) || []).length
        const openP = (line.match(/\(/g) || []).length
        const closeP = (line.match(/\)/g) || []).length
        braceDepth += openB - closeB
        parenDepth += openP - closeP
        if (braceDepth < 0) braceDepth = 0
        if (parenDepth < 0) parenDepth = 0
      }
    }
  }
  return keys
}

describe("preload api ↔ Window.api type sync", () => {
  const preloadKeys = getPreloadApiKeys()
  const typeKeys = getTypeApiKeys()

  it("preload.ts exposes at least one key", () => {
    expect(preloadKeys.size).toBeGreaterThan(0)
  })

  it("types/ipc/*.d.ts declare at least one key", () => {
    expect(typeKeys.size).toBeGreaterThan(0)
  })

  it("every preload key is declared in Window.api", () => {
    const missingInTypes = [...preloadKeys].filter(k => !typeKeys.has(k)).sort()
    expect(
      missingInTypes,
      `Preload exposes these methods but they're missing from src/types/ipc/*.d.ts — ` +
      `renderer code calling them will have no type info:\n  ${missingInTypes.join("\n  ")}`
    ).toEqual([])
  })

  it("every Window.api key is exposed by preload", () => {
    const missingInPreload = [...typeKeys].filter(k => !preloadKeys.has(k)).sort()
    expect(
      missingInPreload,
      `Window.api declares these methods but preload.ts doesn't expose them — ` +
      `renderer code calling window.api.X will throw at runtime:\n  ${missingInPreload.join("\n  ")}`
    ).toEqual([])
  })
})

// Security regression guard for commit 236fc4a. @electron-toolkit/preload's
// `electronAPI` exposes raw ipcRenderer.invoke/send/on/once + process.env to
// the renderer with no channel filtering — entirely bypassing the
// ALLOWED_CHANNELS allowlist that defends api.invoke/api.on. A single
// `exposeInMainWorld("electron", electronAPI)` re-opens the bridge and lets
// a compromised renderer call any IPC handler directly.
describe("preload — window.electron raw bridge stays removed (security)", () => {
  const src = readFileSync(PRELOAD_PATH, "utf-8")

  it("does not expose `electron` on the main world", () => {
    expect(src).not.toMatch(/exposeInMainWorld\(\s*["']electron["']/)
  })

  it("does not import @electron-toolkit/preload", () => {
    expect(src).not.toMatch(/@electron-toolkit\/preload/)
  })

  it("does not assign window.electron directly", () => {
    expect(src).not.toMatch(/window\.electron\s*=/)
  })
})
