/**
 * tests/shared-require-in-project.test.ts
 *
 * Unit tests for the two trust-boundary helpers in electron/ipc/shared.ts:
 *   - requireInProject(p): path-within-project gate used by file:* handlers
 *   - requireMatchesCurrentProject(p): exact-root gate used by analysis/
 *     toolchain handlers that scaffold `.luano/*`
 *
 * Both helpers rely on `setCurrentProject`/`getCurrentProject` for the trust
 * boundary, so we flip the project state per-test rather than mocking it.
 *
 * electron/ipc/shared.ts pulls in pro/modules (among others). Those require
 * heavy dependencies we don't need; mock them to keep the test process light.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdirSync, rmSync, realpathSync } from "fs"
import { join, resolve } from "path"
import { tmpdir } from "os"

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock("../electron/pro/modules", () => ({
  buildSystemPrompt: vi.fn().mockReturnValue(""),
  buildDocsContext: vi.fn().mockResolvedValue(""),
  buildGlobalSummary: vi.fn()
}))
vi.mock("../electron/ai/memory", () => ({
  buildMemoryIndex: vi.fn().mockReturnValue(""),
  loadInstructions: vi.fn().mockReturnValue("")
}))
vi.mock("../electron/ai/provider", () => ({
  isAdvisorAvailable: vi.fn().mockReturnValue(false)
}))
vi.mock("../electron/ai/wag", () => ({
  buildWagIndex: vi.fn().mockReturnValue(""),
  wagExists: vi.fn().mockReturnValue(false)
}))

import {
  requireInProject,
  requireMatchesCurrentProject,
  setCurrentProject,
  getCurrentProject
} from "../electron/ipc/shared"

let testRoot: string
let projectRoot: string

beforeEach(() => {
  testRoot = join(tmpdir(), `luano-shared-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(testRoot, { recursive: true })
  // Realpath so macOS /tmp → /private/tmp doesn't trip validatePath's
  // realpath-equality check.
  testRoot = realpathSync(testRoot)
  projectRoot = join(testRoot, "project")
  mkdirSync(projectRoot)
})

afterEach(() => {
  setCurrentProject(null)
  try { rmSync(testRoot, { recursive: true, force: true }) } catch { /* best effort */ }
})

describe("requireInProject", () => {
  it("throws 'No project' when no project is open", () => {
    setCurrentProject(null)
    expect(() => requireInProject(join(projectRoot, "src/init.lua"))).toThrow(/No project/)
  })

  it("throws on empty string input", () => {
    setCurrentProject(projectRoot)
    expect(() => requireInProject("")).toThrow(/Invalid path/)
  })

  it("throws on non-string input", () => {
    setCurrentProject(projectRoot)
    // Cast through unknown because the signature declares `string` — the
    // runtime guard is what we're actually asserting here.
    expect(() => requireInProject(undefined as unknown as string)).toThrow(/Invalid path/)
    expect(() => requireInProject(123 as unknown as string)).toThrow(/Invalid path/)
    expect(() => requireInProject(null as unknown as string)).toThrow(/Invalid path/)
  })

  it("returns canonical path for a valid in-project path", () => {
    setCurrentProject(projectRoot)
    const candidate = join(projectRoot, "src", "server.lua")
    const result = requireInProject(candidate)
    // validatePath realpaths the nearest existing ancestor. Since projectRoot
    // exists and is already realpath'd, the result for a non-existent tail
    // should be the joined form.
    expect(result).toBe(resolve(candidate))
  })

  it("throws on path traversal escape", () => {
    setCurrentProject(projectRoot)
    const escape = join(projectRoot, "..", "..", "etc", "passwd")
    expect(() => requireInProject(escape)).toThrow(/Path traversal blocked/)
  })
})

describe("requireMatchesCurrentProject", () => {
  it("throws 'No project' when no project is open", () => {
    setCurrentProject(null)
    expect(() => requireMatchesCurrentProject(projectRoot)).toThrow(/No project/)
  })

  it("throws when given path does not match current project", () => {
    setCurrentProject(projectRoot)
    const other = join(testRoot, "other-project")
    expect(() => requireMatchesCurrentProject(other)).toThrow(/does not match/)
  })

  it("passes when paths match exactly", () => {
    setCurrentProject(projectRoot)
    const result = requireMatchesCurrentProject(projectRoot)
    expect(result).toBe(projectRoot)
    // Sanity: the module state matches what we set.
    expect(getCurrentProject()).toBe(projectRoot)
  })

  it("passes when paths normalize to the same location", () => {
    setCurrentProject(projectRoot)
    // path.resolve normalizes trailing slashes, `.`, and `..` segments so
    // these should all compare equal.
    const equivalent = join(projectRoot, ".", "sub", "..")
    expect(() => requireMatchesCurrentProject(equivalent)).not.toThrow()
  })

  it("throws on non-string input", () => {
    setCurrentProject(projectRoot)
    expect(() => requireMatchesCurrentProject(undefined as unknown as string)).toThrow(/does not match/)
  })
})
