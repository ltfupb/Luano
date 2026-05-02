/**
 * tests/ask-user.test.ts — requestAskUser IPC round-trip tests
 *
 * Tests the ask_user tool's main-process side:
 *   - correct answer formatting (single, multi, missing)
 *   - abort signal resolves null and cleans up
 *   - mismatched ID is ignored
 *   - empty questions short-circuits
 *   - multiSelect comma-join and whitelist validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { IpcMainEvent } from "electron"

// ── Hoisted mocks ────────────────────────────────────────────────────────────

// H6: agent now uses ipcMain.on + removeListener instead of once + re-registration.
// Tests updated to match the new correct behavior.
const { mockIpcMainOn, mockIpcMainRemoveListener } = vi.hoisted(() => ({
  mockIpcMainOn: vi.fn(),
  mockIpcMainRemoveListener: vi.fn()
}))

const h = vi.hoisted(() => {
  const winSend = vi.fn()
  const win = { webContents: { send: winSend } }
  return { winSend, win }
})

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [h.win] },
  ipcMain: {
    on: mockIpcMainOn,
    once: vi.fn(),
    removeListener: mockIpcMainRemoveListener
  }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("../electron/sidecar/index", () => ({
  spawnSidecar: vi.fn(),
  isBinaryAvailable: vi.fn(() => false)
}))
vi.mock("../electron/sidecar/selene", () => ({ lintFile: vi.fn() }))
vi.mock("../electron/sidecar/stylua", () => ({ formatFile: vi.fn() }))
vi.mock("../electron/bridge/server", () => ({
  getBridgeTree: vi.fn(),
  getBridgeLogs: vi.fn(),
  isBridgeConnected: vi.fn(() => false),
  queueScript: vi.fn(),
  consumeCommandResult: vi.fn()
}))
vi.mock("../electron/mcp/client", () => ({
  isMcpConnected: vi.fn(async () => false),
  mcpInsertModel: vi.fn(async () => ({ success: false, output: "" }))
}))
vi.mock("../electron/ai/rag", () => ({ searchDocs: vi.fn() }))
vi.mock("../electron/file/sandbox", () => ({ validatePath: vi.fn() }))
vi.mock("../electron/ai/wag", () => ({
  wagExists: vi.fn(() => false),
  readWagFile: vi.fn(),
  listSiblings: vi.fn(() => []),
  searchWag: vi.fn(() => []),
  rebuildWagIndex: vi.fn()
}))
vi.mock("../electron/ai/provider", () => ({
  getProvider: vi.fn().mockReturnValue("anthropic"),
  getModel: vi.fn().mockReturnValue("claude-sonnet-4-6"),
  getModelTier: vi.fn().mockReturnValue("frontier"),
  getAnthropicClient: vi.fn(),
  getOpenAIClient: vi.fn(),
  isAdvisorAvailable: vi.fn().mockReturnValue(false),
  getAdvisorModel: vi.fn().mockReturnValue("claude-opus-4-6"),
  _setActiveAbortController: vi.fn(),
  toCachedSystem: vi.fn().mockImplementation((s: unknown) => s),
  toCachedTools: vi.fn().mockImplementation((t: unknown) => t),
  chat: vi.fn(),
  StreamBlockTracker: class { onStart() {} onStop() {} }
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import { requestAskUser } from "../electron/ai/agent"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQuestion(overrides?: Partial<import("../electron/ai/agent").AskUserQuestion>) {
  return {
    question: "Pick a style",
    header: "Style",
    options: [{ label: "Option A" }, { label: "Option B" }],
    ...overrides
  }
}

/** Simulate the renderer sending back an answer by triggering the registered handler */
function resolveWithAnswers(id: string, answers: Record<string, string>) {
  // H6: handler is now registered with ipcMain.on (not once), so we look in
  // mockIpcMainOn rather than mockIpcMainOnce.
  const [, handler] = mockIpcMainOn.mock.calls[mockIpcMainOn.mock.calls.length - 1] as [
    string,
    (e: IpcMainEvent, data: { id: string; answers: Record<string, string> }) => void
  ]
  handler({} as IpcMainEvent, { id, answers })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe("requestAskUser", () => {
  it("returns '(no questions provided)' immediately for empty array", async () => {
    const result = await requestAskUser([], "ch", new AbortController().signal)
    expect(result).toBe("(no questions provided)")
    expect(mockIpcMainOn).not.toHaveBeenCalled()
  })

  it("broadcasts questions to all windows with a UUID id", async () => {
    const controller = new AbortController()
    const promise = requestAskUser([makeQuestion()], "ai:agent:1", controller.signal)

    const sentId = (h.winSend.mock.calls[0][1] as { id: string }).id
    expect(sentId).toMatch(/^[0-9a-f-]{36}$/) // UUID format

    resolveWithAnswers(sentId, { "0": "Option A" })
    await promise
    expect(h.winSend).toHaveBeenCalledWith("ai:agent:1:ask-user", { id: sentId, questions: expect.any(Array) })
  })

  it("formats answer as 'Question\\n→ Answer' for single-select", async () => {
    const controller = new AbortController()
    const promise = requestAskUser([makeQuestion()], "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    resolveWithAnswers(id, { "0": "Option A" })
    const result = await promise
    expect(result).toBe("Pick a style\n→ Option A")
  })

  it("joins multiple questions with double newline", async () => {
    const controller = new AbortController()
    const qs = [makeQuestion({ question: "Q1" }), makeQuestion({ question: "Q2" })]
    const promise = requestAskUser(qs, "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    resolveWithAnswers(id, { "0": "Option A", "1": "Option B" })
    const result = await promise
    expect(result).toBe("Q1\n→ Option A\n\nQ2\n→ Option B")
  })

  it("uses '(no answer)' when answer key is missing", async () => {
    const controller = new AbortController()
    const promise = requestAskUser([makeQuestion()], "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    resolveWithAnswers(id, {})
    const result = await promise
    expect(result).toBe("Pick a style\n→ (no answer)")
  })

  it("whitelist-rejects an answer not in options", async () => {
    const controller = new AbortController()
    const promise = requestAskUser([makeQuestion()], "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    resolveWithAnswers(id, { "0": "injected content" })
    const result = await promise
    expect(result).toBe("Pick a style\n→ (no answer)")
  })

  it("resolves null and cleans up listener on abort", async () => {
    const controller = new AbortController()
    const promise = requestAskUser([makeQuestion()], "ch", controller.signal)

    controller.abort()
    const result = await promise
    expect(result).toBeNull()
    expect(mockIpcMainRemoveListener).toHaveBeenCalled()
  })

  it("validates multiSelect answers — keeps only known labels", async () => {
    const controller = new AbortController()
    const qs = [makeQuestion({ multiSelect: true })]
    const promise = requestAskUser(qs, "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    // "Option A" is valid, "Injected" is not
    resolveWithAnswers(id, { "0": "Option A, Injected, Option B" })
    const result = await promise
    expect(result).toBe("Pick a style\n→ Option A, Option B")
  })

  it("formats multiSelect selections as comma-joined labels", async () => {
    const controller = new AbortController()
    const qs = [makeQuestion({ multiSelect: true })]
    const promise = requestAskUser(qs, "ch", controller.signal)
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    resolveWithAnswers(id, { "0": "Option A, Option B" })
    const result = await promise
    expect(result).toBe("Pick a style\n→ Option A, Option B")
  })

  // H6 — flood-race regression. With the old ipcMain.once + re-registration
  // pattern, a flood of wrong-sender events from a compromised second
  // renderer could land between `once` firing and the re-registration,
  // dropping the legitimate sender's reply. The ipcMain.on + manual
  // removeListener pattern keeps the listener registered until cleanup,
  // so wrong-sender events are silently ignored AND the legit event still
  // resolves the promise.
  it("H6: ignores 5 wrong-sender events then resolves on the legit reply", async () => {
    // requestUIResponse filters target windows to webContents.id === senderId,
    // so the mock window must report id 101 for the request broadcast to land.
    (h.win as unknown as { webContents: { id: number } }).webContents.id = 101

    const controller = new AbortController()
    const promise = requestAskUser(
      [makeQuestion()],
      "ch",
      controller.signal,
      /* senderId = expected */ 101
    )
    const id = (h.winSend.mock.calls[0][1] as { id: string }).id

    // Capture the handler that requestAskUser registered with ipcMain.on.
    const [, handler] = mockIpcMainOn.mock.calls[mockIpcMainOn.mock.calls.length - 1] as [
      string,
      (e: IpcMainEvent, data: { id: string; answers: Record<string, string> }) => void
    ]

    // Flood: 5 wrong-sender events with the right id but a hostile sender.
    for (let i = 0; i < 5; i++) {
      handler(
        { sender: { id: 999 } } as unknown as IpcMainEvent,
        { id, answers: { "0": "Option B" } } // hostile answer
      )
    }

    // Promise must NOT have resolved yet — the listener must still be alive.
    let resolvedEarly: string | null | undefined = undefined
    const probe = promise.then((v) => { resolvedEarly = v; return v })
    // Yield once so any microtask resolution would have shown up.
    await Promise.resolve()
    expect(resolvedEarly).toBeUndefined()

    // Legit reply from the expected sender — promise must resolve with it.
    handler(
      { sender: { id: 101 } } as unknown as IpcMainEvent,
      { id, answers: { "0": "Option A" } }
    )

    const result = await probe
    expect(result).toBe("Pick a style\n→ Option A")
    expect(mockIpcMainRemoveListener).toHaveBeenCalled()
  })
})
