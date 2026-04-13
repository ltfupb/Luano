/**
 * tests/smoke/app-boot.test.ts — IPC handler registration smoke test
 *
 * Goal: verify that registerIpcHandlers() completes without throwing and
 * registers the expected IPC channels. Catches import-time errors, missing
 * exports, and channel name typos before they reach production.
 *
 * Strategy: mock every external dependency so only the handler wiring logic
 * under test actually runs. Assert on ipcMain.handle call count and channel names.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const ipcHandle = vi.fn()
  const ipcOn = vi.fn()
  return { ipcHandle, ipcOn }
})

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/luano-test", isPackaged: false, on: vi.fn() },
  ipcMain: { handle: h.ipcHandle, on: h.ipcOn, removeHandler: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }))

vi.mock("node-pty", () => ({
  spawn: vi.fn().mockReturnValue({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn()
  })
}))

vi.mock("../../electron/store", () => ({
  store: { get: vi.fn().mockReturnValue(undefined), set: vi.fn(), delete: vi.fn() }
}))

vi.mock("../../electron/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock("../../electron/ai/provider", () => ({
  chat: vi.fn(),
  chatStream: vi.fn(),
  planChat: vi.fn(),
  abortAgent: vi.fn(),
  setApiKey: vi.fn(),
  getApiKey: vi.fn(),
  setOpenAIKey: vi.fn(),
  getOpenAIKey: vi.fn(),
  setGeminiKey: vi.fn(),
  getGeminiKey: vi.fn(),
  setLocalEndpoint: vi.fn(),
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
  isAdvisorAvailable: vi.fn(),
  MODELS: [],
  getTokenUsage: vi.fn(),
  resetTokenUsage: vi.fn()
}))

vi.mock("../../electron/ai/memory", () => ({
  getMemories: vi.fn(),
  addMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  buildMemoryContext: vi.fn().mockReturnValue(""),
  loadInstructions: vi.fn().mockReturnValue(""),
  buildMemoryDetectPrompt: vi.fn().mockReturnValue(""),
  parseMemoryDetectResponse: vi.fn().mockReturnValue([]),
  estimateMessagesTokens: vi.fn().mockResolvedValue(0),
  buildCompressionPrompt: vi.fn().mockReturnValue(""),
  buildMemoryIndex: vi.fn().mockReturnValue("")
}))

vi.mock("../../electron/pro/modules", () => ({
  agentChat: vi.fn(),
  inlineEdit: vi.fn(),
  buildGlobalSummary: vi.fn().mockResolvedValue({ globalSummary: "" }),
  buildSystemPrompt: vi.fn().mockReturnValue(""),
  buildDocsContext: vi.fn().mockResolvedValue(""),
  getLastCheckpoint: vi.fn().mockReturnValue(null),
  revertCheckpoint: vi.fn(),
  evaluateCode: vi.fn(),
  evaluateFiles: vi.fn(),
  isBridgeConnected: vi.fn().mockReturnValue(false),
  getBridgeTree: vi.fn().mockResolvedValue(null),
  getBridgeLogs: vi.fn().mockReturnValue([]),
  recordQuery: vi.fn(),
  getBridgeToken: vi.fn().mockReturnValue(null),
  clearBridgeLogs: vi.fn(),
  queueScript: vi.fn(),
  getCommandResult: vi.fn(),
  getConsoleOutput: vi.fn(),
  isStudioConnected: vi.fn().mockReturnValue(false),
  analyzeTopology: vi.fn(),
  analyzeCrossScript: vi.fn(),
  performanceLint: vi.fn(),
  performanceLintFile: vi.fn(),
  loadSchemas: vi.fn().mockResolvedValue([]),
  addSchema: vi.fn(),
  deleteSchema: vi.fn(),
  generateDataModule: vi.fn(),
  generateMigration: vi.fn(),
  recordDiff: vi.fn(),
  telemetryEnabled: vi.fn().mockReturnValue(false),
  setTelemetry: vi.fn(),
  telemetryStats: vi.fn().mockResolvedValue({})
}))

vi.mock("../../electron/pro", () => ({
  hasFeature: vi.fn().mockReturnValue(false),
  isPro: vi.fn().mockReturnValue(false)
}))

vi.mock("../../electron/pro/license", () => ({
  activateLicense: vi.fn(),
  deactivateLicense: vi.fn(),
  getLicenseInfo: vi.fn().mockReturnValue(null),
  validateLicense: vi.fn().mockResolvedValue(false)
}))

vi.mock("../../electron/ipc/shared", () => ({
  aiGeneratedFiles: new Map(),
  PRO_REQUIRED: { error: "Pro required" },
  collectLuauFiles: vi.fn().mockReturnValue([]),
  setCurrentProject: vi.fn(),
  getCurrentProject: vi.fn().mockReturnValue(null),
  buildFullSystemPrompt: vi.fn().mockReturnValue(""),
  buildRAGContext: vi.fn().mockResolvedValue("")
}))

vi.mock("../../electron/file/project", () => ({
  readDir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createFile: vi.fn(),
  createFolder: vi.fn(),
  renameEntry: vi.fn(),
  deleteEntry: vi.fn(),
  moveEntry: vi.fn(),
  initProject: vi.fn()
}))

vi.mock("../../electron/file/watcher", () => ({
  watchProject: vi.fn(),
  stopWatcher: vi.fn()
}))

vi.mock("../../electron/ipc/terminal-handlers", () => ({
  registerTerminalHandlers: vi.fn(),
  cleanupPtys: vi.fn()
}))

vi.mock("../../electron/sidecar/selene", () => ({
  lintFile: vi.fn()
}))

vi.mock("../../electron/sidecar/stylua", () => ({
  formatFile: vi.fn()
}))

vi.mock("../../electron/main", () => ({
  syncManager: { start: vi.fn(), stop: vi.fn() },
  lspManager: { start: vi.fn(), stop: vi.fn() }
}))

vi.mock("../../electron/toolchain/config", () => ({
  getToolchainConfig: vi.fn(),
  getActiveTool: vi.fn(),
  setProjectTool: vi.fn(),
  setGlobalDefault: vi.fn(),
  isMinimumToolchainReady: vi.fn().mockReturnValue(false),
  hasProjectConfig: vi.fn().mockReturnValue(false),
  initProjectConfig: vi.fn()
}))

vi.mock("../../electron/toolchain/downloader", () => ({
  downloadTool: vi.fn(),
  downloadMultiple: vi.fn(),
  getDownloadStatus: vi.fn().mockReturnValue("not-installed"),
  removeTool: vi.fn(),
  checkToolUpdates: vi.fn().mockResolvedValue([]),
  updateTool: vi.fn(),
  fetchToolMetadata: vi.fn()
}))

vi.mock("../../electron/toolchain/registry", () => ({
  TOOL_REGISTRY: {},
  CATEGORIES: []
}))

// ── Import under test ─────────────────────────────────────────────────────────

import { registerIpcHandlers } from "../../electron/ipc/handlers"

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

function getChannels(): string[] {
  registerIpcHandlers()
  return h.ipcHandle.mock.calls.map(([ch]: [string]) => ch)
}

describe("registerIpcHandlers — smoke", () => {
  it("completes without throwing", () => {
    expect(() => registerIpcHandlers()).not.toThrow()
  })

  it("registers AI key management channels", () => {
    const channels = getChannels()
    expect(channels).toContain("ai:setKey")
    expect(channels).toContain("ai:get-key")
    expect(channels).toContain("ai:set-openai-key")
    expect(channels).toContain("ai:set-provider")
    expect(channels).toContain("ai:set-model")
  })

  it("registers project and file channels", () => {
    const channels = getChannels()
    expect(channels).toContain("project:open-folder")
    expect(channels).toContain("project:open")
    expect(channels).toContain("project:close")
    expect(channels).toContain("file:read")
    expect(channels).toContain("file:write")
  })

  it("registers license channels", () => {
    const channels = getChannels()
    expect(channels).toContain("license:activate")
    expect(channels).toContain("license:deactivate")
    expect(channels).toContain("license:info")
  })

  it("registers at least 30 IPC channels total", () => {
    // Sanity check: if someone accidentally deleted a registration block,
    // this would catch it before the channel-specific tests above narrow it down.
    expect(getChannels().length).toBeGreaterThanOrEqual(30)
  })
})
