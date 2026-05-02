/**
 * tests/ai-handlers-gates.test.ts — H15 / M2 ai-handlers IPC gates.
 *
 * Covers:
 *   - H15 agent:revert sender gate — only the renderer that owns the active
 *     session may revert a checkpoint; other senders get refused without
 *     invoking revertCheckpoint.
 *   - M2 ai:set-local-endpoint loopback / non-loopback rule — non-loopback
 *     hosts must use HTTPS to prevent MitM on a LAN Ollama.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {}
  return {
    handlers,
    mockGetActiveSessionSenderId: vi.fn(),
    mockGetLastCheckpoint: vi.fn(),
    mockRevertCheckpoint: vi.fn(),
    mockSetLocalEndpoint: vi.fn(),
    mockHasFeature: vi.fn().mockReturnValue(true),
  }
})

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      h.handlers[channel] = fn
    }),
    on: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      h.handlers[channel] = fn
    }),
  },
}))

vi.mock("../electron/ai/provider", () => ({
  chat: vi.fn(),
  chatStream: vi.fn(),
  abortAgent: vi.fn(),
  setApiKey: vi.fn(),
  getApiKey: vi.fn(),
  setOpenAIKey: vi.fn(),
  getOpenAIKey: vi.fn(),
  setGeminiKey: vi.fn(),
  getGeminiKey: vi.fn(),
  setLocalEndpoint: h.mockSetLocalEndpoint,
  getLocalEndpoint: vi.fn(),
  setLocalKey: vi.fn(),
  getLocalKey: vi.fn(),
  setLocalModel: vi.fn(),
  getLocalModel: vi.fn(),
  fetchLocalModels: vi.fn(),
  setProvider: vi.fn(),
  setModel: vi.fn(),
  getProviderAndModel: vi.fn(),
  setAdvisorEnabled: vi.fn(),
  getAdvisorEnabled: vi.fn(),
  setThinkingEffort: vi.fn(),
  getThinkingEffort: vi.fn(),
  fetchManagedUsage: vi.fn(),
  MODELS: [],
  getTokenUsage: vi.fn(),
  resetTokenUsage: vi.fn(),
}))

vi.mock("../electron/pro", () => ({ hasFeature: h.mockHasFeature }))

vi.mock("../electron/ai/memory", () => ({
  getMemories: vi.fn(),
  addMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  buildMemoryContext: vi.fn(),
  loadInstructions: vi.fn(),
  estimateMessagesTokens: vi.fn(),
  buildCompressionPrompt: vi.fn(),
}))

vi.mock("../electron/pro/modules", () => ({
  agentChat: vi.fn(),
  inlineEdit: vi.fn(),
  buildGlobalSummary: vi.fn(),
  getLastCheckpoint: h.mockGetLastCheckpoint,
  revertCheckpoint: h.mockRevertCheckpoint,
  evaluateCode: vi.fn(),
  evaluateFiles: vi.fn(),
  isBridgeConnected: vi.fn(),
  getBridgeTree: vi.fn(),
  getBridgeLogs: vi.fn(),
  recordQuery: vi.fn(),
  getActiveSessionSenderId: h.mockGetActiveSessionSenderId,
  redactSecrets: vi.fn(),
}))

vi.mock("../electron/ipc/shared", () => ({
  aiGeneratedFiles: new Map(),
  PRO_REQUIRED: () => ({ success: false, error: "pro required" }),
  buildFullSystemPrompt: vi.fn(),
  requireMatchesCurrentProject: vi.fn(),
  requireInProject: vi.fn(),
  getCurrentProject: vi.fn(),
}))

vi.mock("fs", () => ({
  readFileSync: vi.fn(() => "")
}))

import { registerAIHandlers } from "../electron/ipc/ai-handlers"

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(h.handlers)) delete h.handlers[k]
  registerAIHandlers()
})

// ── H15: agent:revert sender gate ─────────────────────────────────────────────

describe("H15 — agent:revert sender gate", () => {
  it("refuses revert when sender is NOT the active session owner", async () => {
    h.mockGetActiveSessionSenderId.mockReturnValue(101) // owner = 101
    h.mockGetLastCheckpoint.mockReturnValue({ files: ["/tmp/foo.lua"] })

    const handler = h.handlers["agent:revert"]
    // Call with a different sender id (compromised renderer / extension popup).
    const result = await handler({ sender: { id: 999 } })

    expect(result).toMatchObject({ success: false, message: "Not session owner" })
    expect(h.mockRevertCheckpoint).not.toHaveBeenCalled()
    expect(h.mockGetLastCheckpoint).not.toHaveBeenCalled()
  })

  it("allows revert when sender IS the active session owner", async () => {
    h.mockGetActiveSessionSenderId.mockReturnValue(101)
    h.mockGetLastCheckpoint.mockReturnValue({ files: ["/tmp/foo.lua"] })
    h.mockRevertCheckpoint.mockReturnValue(["/tmp/foo.lua"])

    const handler = h.handlers["agent:revert"]
    const result = await handler({ sender: { id: 101 } })

    expect(result).toMatchObject({ success: true })
    expect(h.mockRevertCheckpoint).toHaveBeenCalledTimes(1)
  })

  it("allows revert when no active session is recorded (legacy callers — owner undefined)", async () => {
    h.mockGetActiveSessionSenderId.mockReturnValue(undefined)
    h.mockGetLastCheckpoint.mockReturnValue({ files: ["/tmp/foo.lua"] })
    h.mockRevertCheckpoint.mockReturnValue(["/tmp/foo.lua"])

    const handler = h.handlers["agent:revert"]
    const result = await handler({ sender: { id: 999 } })

    expect(result).toMatchObject({ success: true })
    expect(h.mockRevertCheckpoint).toHaveBeenCalledTimes(1)
  })

  it("returns 'No checkpoint available' when there's nothing to revert (after sender gate passes)", async () => {
    h.mockGetActiveSessionSenderId.mockReturnValue(101)
    h.mockGetLastCheckpoint.mockReturnValue(null)

    const handler = h.handlers["agent:revert"]
    const result = await handler({ sender: { id: 101 } })

    expect(result).toMatchObject({ success: false, message: "No checkpoint available" })
    expect(h.mockRevertCheckpoint).not.toHaveBeenCalled()
  })
})

// ── M2: non-loopback HTTPS rule for ai:set-local-endpoint ──────────────────────

describe("M2 — ai:set-local-endpoint loopback / non-loopback rule", () => {
  // For each case we run the handler and assert success/failure. setLocalEndpoint
  // should only be called for accepted endpoints.
  type Case = { input: string; accept: boolean; reason: string }
  const cases: Case[] = [
    { input: "http://localhost:11434/v1",   accept: true,  reason: "loopback http allowed" },
    { input: "http://127.0.0.1:11434/v1",   accept: true,  reason: "loopback http allowed (IPv4)" },
    { input: "http://[::1]:11434",          accept: true,  reason: "loopback http allowed (IPv6)" },
    { input: "http://192.168.1.10:11434",   accept: false, reason: "non-loopback http rejected" },
    { input: "https://192.168.1.10:11434",  accept: true,  reason: "non-loopback https accepted" },
    { input: "http://10.0.0.5:11434",       accept: false, reason: "private http rejected" },
    { input: "https://ollama.example.com",  accept: true,  reason: "remote https accepted" },
    { input: "ws://localhost:11434",        accept: false, reason: "non-http(s) protocol rejected" },
    { input: "https://user:pass@host:11434", accept: false, reason: "embedded credentials rejected" },
  ]

  for (const c of cases) {
    it(`${c.reason}: ${c.input}`, async () => {
      const handler = h.handlers["ai:set-local-endpoint"]
      const result = await handler({}, c.input)

      if (c.accept) {
        expect(result).toMatchObject({ success: true })
        expect(h.mockSetLocalEndpoint).toHaveBeenCalledTimes(1)
      } else {
        expect(result).toMatchObject({ success: false })
        expect(h.mockSetLocalEndpoint).not.toHaveBeenCalled()
      }
    })
  }

  it("rejects empty string", async () => {
    const handler = h.handlers["ai:set-local-endpoint"]
    const result = await handler({}, "")
    expect(result).toMatchObject({ success: false })
    expect(h.mockSetLocalEndpoint).not.toHaveBeenCalled()
  })

  it("rejects malformed URL", async () => {
    const handler = h.handlers["ai:set-local-endpoint"]
    const result = await handler({}, "not a url at all")
    expect(result).toMatchObject({ success: false })
    expect(h.mockSetLocalEndpoint).not.toHaveBeenCalled()
  })
})
