/**
 * tests/terminal-handlers.test.ts
 *
 * Tests for electron/ipc/terminal-handlers.ts. Goal: verify the IPC gates on
 * terminal:create (no-project, cwd-outside-project, env whitelist) and the
 * per-WebContents ownership check on terminal:write.
 *
 * Strategy: mock `node-pty` so no real shell spawns, mock `ipcMain.handle` to
 * capture handlers into a map, and drive the captured handlers directly with
 * synthesized event objects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, realpathSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

type HandlerFn = (event: { sender: { id: number; isDestroyed(): boolean } }, ...args: unknown[]) => unknown
const handlers = new Map<string, HandlerFn>()

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const ptySpawn = vi.fn()
  const lastSpawned: { env?: Record<string, string>; cwd?: string; opts?: Record<string, unknown> } = {}
  return { ptySpawn, lastSpawned }
})

vi.mock("electron", () => ({
  ipcMain: {
    handle: (ch: string, fn: HandlerFn) => { handlers.set(ch, fn) }
  }
}))

// terminal-handlers now imports getUserBinDir from sidecar/index to prepend
// the toolchain bin dir to PATH; sidecar/index pulls in electron `app` and
// `@electron-toolkit/utils`, neither of which the test wants. Stub the one
// helper we need.
vi.mock("../electron/sidecar", () => ({
  getUserBinDir: () => "/tmp/luano-test-bin"
}))

vi.mock("node-pty", () => ({
  spawn: (shell: string, args: string[], opts: Record<string, unknown>) => {
    h.lastSpawned.env = opts.env as Record<string, string>
    h.lastSpawned.cwd = opts.cwd as string
    h.lastSpawned.opts = opts
    // Minimal IPty shape: the handlers only touch onData/onExit/write/resize/kill.
    return h.ptySpawn({
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn()
    })
  }
}))

// shared.ts drags in pro/modules etc; stub the few symbols we use via a
// lightweight replacement module so the terminal handlers see our project state.
vi.mock("../electron/ipc/shared", async () => {
  // Use vi.importActual so we lean on the real validatePath implementation
  // rather than reimplementing its traversal rules — keeps behaviour in sync
  // with production and avoids a `require()` inside the mock factory
  // (forbidden by @typescript-eslint/no-require-imports).
  const { validatePath } = await vi.importActual<typeof import("../electron/file/sandbox")>(
    "../electron/file/sandbox"
  )
  let project: string | null = null
  return {
    getCurrentProject: () => project,
    setCurrentProject: (p: string | null) => { project = p },
    requireInProject: (p: string): string => {
      if (!project) throw new Error("No project is open")
      if (typeof p !== "string" || p.length === 0) throw new Error("Invalid path")
      return validatePath(p, project)
    }
  }
})

// ── Import under test after mocks are wired ─────────────────────────────────
import { registerTerminalHandlers, cleanupPtys } from "../electron/ipc/terminal-handlers"
import { setCurrentProject } from "../electron/ipc/shared"

let testRoot: string
let projectRoot: string

beforeEach(() => {
  h.ptySpawn.mockImplementation((proc) => proc)
  handlers.clear()
  // Clear any PTYs left over from prior tests — ptyMap is module-level and
  // the per-sender cap otherwise counts them against this test's sender.
  cleanupPtys()
  testRoot = join(tmpdir(), `luano-term-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(testRoot, { recursive: true })
  testRoot = realpathSync(testRoot)
  projectRoot = join(testRoot, "project")
  mkdirSync(projectRoot)
  registerTerminalHandlers()
})

afterEach(() => {
  setCurrentProject(null)
  handlers.clear()
  try { rmSync(testRoot, { recursive: true, force: true }) } catch { /* best effort */ }
})

function mkEvent(id = 100): { sender: { id: number; isDestroyed(): boolean } } {
  return { sender: { id, isDestroyed: () => false } }
}

describe("terminal:create gates", () => {
  it("rejects when no project is open", async () => {
    setCurrentProject(null)
    const h2 = handlers.get("terminal:create")!
    const result = await h2(mkEvent()) as { id: string; error: string }
    expect(result.id).toBe("")
    expect(result.error).toMatch(/No project/)
    expect(h.ptySpawn).not.toHaveBeenCalled()
  })

  it("rejects cwd outside project (returns error, does not throw)", async () => {
    setCurrentProject(projectRoot)
    const h2 = handlers.get("terminal:create")!
    const outside = join(testRoot, "outside")
    const result = await h2(mkEvent(), outside) as { id: string; error: string }
    expect(result.id).toBe("")
    expect(result.error).toMatch(/Path traversal|outside project/)
    expect(h.ptySpawn).not.toHaveBeenCalled()
  })

  it("accepts a cwd inside the project and spawns with canonical path", async () => {
    setCurrentProject(projectRoot)
    const sub = join(projectRoot, "src")
    mkdirSync(sub)
    const h2 = handlers.get("terminal:create")!
    const result = await h2(mkEvent(), sub) as { id: string }
    expect(result.id).toMatch(/^term-/)
    expect(h.ptySpawn).toHaveBeenCalledOnce()
    expect(h.lastSpawned.cwd).toBe(sub)
  })

  it("defaults cwd to project root when cwd argument is omitted", async () => {
    setCurrentProject(projectRoot)
    const h2 = handlers.get("terminal:create")!
    const result = await h2(mkEvent()) as { id: string }
    expect(result.id).toMatch(/^term-/)
    expect(h.lastSpawned.cwd).toBe(projectRoot)
  })

  it("defaults cwd to project root when cwd is the empty string", async () => {
    setCurrentProject(projectRoot)
    const h2 = handlers.get("terminal:create")!
    await h2(mkEvent(), "")
    expect(h.lastSpawned.cwd).toBe(projectRoot)
  })

  it("passes only whitelisted env keys to the PTY", async () => {
    // Seed a few env vars: a whitelisted one (PATH) and a few that must be
    // stripped (ELECTRON_DISABLE_SECURITY_WARNINGS and a fake Luano dev token).
    const prevPath = process.env.PATH
    process.env.PATH = "/custom/path"
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true"
    process.env.LUANO_DEV_SECRET = "topsecret"
    try {
      setCurrentProject(projectRoot)
      const h2 = handlers.get("terminal:create")!
      await h2(mkEvent())
      const env = h.lastSpawned.env!
      // PATH is the whitelisted PATH plus the prepended toolchain bin dir so
      // the user can invoke on-demand tools (rojo, wally, pesde, …) by name.
      expect(env.PATH).toContain("/custom/path")
      expect(env.PATH).toContain("/tmp/luano-test-bin")
      expect(env.PATH?.endsWith("/custom/path")).toBe(true)
      expect(env.ELECTRON_DISABLE_SECURITY_WARNINGS).toBeUndefined()
      expect(env.LUANO_DEV_SECRET).toBeUndefined()
      // Sanity: env is a plain object, not a reference to process.env.
      expect(Object.keys(env).some((k) => k.startsWith("LUANO_"))).toBe(false)
    } finally {
      process.env.PATH = prevPath
      delete process.env.ELECTRON_DISABLE_SECURITY_WARNINGS
      delete process.env.LUANO_DEV_SECRET
    }
  })
})

describe("terminal:write ownership check", () => {
  it("rejects a write from a sender that did not create the terminal", async () => {
    setCurrentProject(projectRoot)
    const create = handlers.get("terminal:create")!
    const write = handlers.get("terminal:write")!
    const created = await create(mkEvent(100)) as { id: string }

    const result = write(mkEvent(200), created.id, "ls\n") as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/sender/)
  })

  it("allows a write from the creating sender", async () => {
    setCurrentProject(projectRoot)
    const create = handlers.get("terminal:create")!
    const write = handlers.get("terminal:write")!
    const created = await create(mkEvent(100)) as { id: string }

    const result = write(mkEvent(100), created.id, "ls\n") as { success: boolean }
    expect(result.success).toBe(true)
  })

  it("rejects a write to an unknown terminal id", () => {
    setCurrentProject(projectRoot)
    const write = handlers.get("terminal:write")!
    const result = write(mkEvent(), "term-does-not-exist", "x") as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/unknown/)
  })
})
