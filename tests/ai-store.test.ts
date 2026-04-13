/**
 * tests/ai-store.test.ts — Unit tests for src/stores/aiStore.ts
 *
 * Runs in jsdom (localStorage available).
 * Tests message management, session persistence, and compress guard clauses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { useAIStore } from "../src/stores/aiStore"

// ── Reset helpers ─────────────────────────────────────────────────────────────

const INITIAL: Parameters<typeof useAIStore.setState>[0] = {
  messages: [],
  isStreaming: false,
  globalSummary: "",
  planMode: false,
  autoAccept: false,
  pendingReview: null,
  sessions: {},
  activeSessionId: null,
  sessionHandoff: "",
  compressedContext: ""
}

beforeEach(() => {
  useAIStore.setState(INITIAL)
})

afterEach(() => {
  localStorage.clear()
})

// ── addMessage ────────────────────────────────────────────────────────────────

describe("addMessage", () => {
  it("appends message and returns generated id", () => {
    const id = useAIStore.getState().addMessage({ role: "user", content: "hello" })
    const { messages } = useAIStore.getState()
    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe(id)
    expect(messages[0].content).toBe("hello")
    expect(messages[0].role).toBe("user")
  })

  it("generates unique ids for sequential messages", () => {
    const id1 = useAIStore.getState().addMessage({ role: "user", content: "a" })
    const id2 = useAIStore.getState().addMessage({ role: "assistant", content: "b" })
    expect(id1).not.toBe(id2)
    expect(useAIStore.getState().messages).toHaveLength(2)
  })
})

// ── updateMessage ─────────────────────────────────────────────────────────────

describe("updateMessage", () => {
  it("updates content and streaming flag for target id", () => {
    const id = useAIStore.getState().addMessage({ role: "assistant", content: "...", streaming: true })
    useAIStore.getState().updateMessage(id, "full response", false)
    const msg = useAIStore.getState().messages.find((m) => m.id === id)!
    expect(msg.content).toBe("full response")
    expect(msg.streaming).toBe(false)
  })

  it("does not affect other messages", () => {
    useAIStore.getState().addMessage({ role: "user", content: "q" })
    const id2 = useAIStore.getState().addMessage({ role: "assistant", content: "orig", streaming: true })
    useAIStore.getState().addMessage({ role: "user", content: "q2" })
    useAIStore.getState().updateMessage(id2, "updated")
    const msgs = useAIStore.getState().messages
    expect(msgs[0].content).toBe("q")
    expect(msgs[2].content).toBe("q2")
  })

  it("preserves streaming flag when not passed", () => {
    const id = useAIStore.getState().addMessage({ role: "assistant", content: "x", streaming: true })
    useAIStore.getState().updateMessage(id, "new content")
    const msg = useAIStore.getState().messages.find((m) => m.id === id)!
    expect(msg.streaming).toBe(true)
  })
})

// ── simple setters ────────────────────────────────────────────────────────────

describe("simple setters", () => {
  it("setStreaming", () => {
    useAIStore.getState().setStreaming(true)
    expect(useAIStore.getState().isStreaming).toBe(true)
    useAIStore.getState().setStreaming(false)
    expect(useAIStore.getState().isStreaming).toBe(false)
  })

  it("clearMessages empties the messages array", () => {
    useAIStore.getState().addMessage({ role: "user", content: "hi" })
    useAIStore.getState().clearMessages()
    expect(useAIStore.getState().messages).toHaveLength(0)
  })

  it("setPlanMode", () => {
    useAIStore.getState().setPlanMode(true)
    expect(useAIStore.getState().planMode).toBe(true)
  })

  it("setAutoAccept", () => {
    useAIStore.getState().setAutoAccept(true)
    expect(useAIStore.getState().autoAccept).toBe(true)
  })

  it("setPendingReview", () => {
    const review = { files: ["/a.lua"], messageId: "m1" }
    useAIStore.getState().setPendingReview(review)
    expect(useAIStore.getState().pendingReview).toEqual(review)
    useAIStore.getState().setPendingReview(null)
    expect(useAIStore.getState().pendingReview).toBeNull()
  })
})

// ── saveProjectChat ───────────────────────────────────────────────────────────

describe("saveProjectChat", () => {
  const PROJECT = "/proj/foo"

  it("does nothing when messages is empty", () => {
    useAIStore.getState().saveProjectChat(PROJECT)
    expect(useAIStore.getState().sessions[PROJECT]).toBeUndefined()
  })

  it("saves messages as a session entry", () => {
    useAIStore.getState().addMessage({ role: "user", content: "make foo" })
    useAIStore.getState().saveProjectChat(PROJECT)
    const sessions = useAIStore.getState().sessions[PROJECT]
    expect(sessions).toHaveLength(1)
    expect(sessions[0].messages[0].content).toBe("make foo")
    expect(sessions[0].preview).toBe("make foo")
  })

  it("uses first user message as preview", () => {
    useAIStore.getState().addMessage({ role: "assistant", content: "greeting" })
    useAIStore.getState().addMessage({ role: "user", content: "my question" })
    useAIStore.getState().saveProjectChat(PROJECT)
    const sessions = useAIStore.getState().sessions[PROJECT]
    expect(sessions[0].preview).toBe("my question")
  })

  it("sets activeSessionId after save", () => {
    useAIStore.getState().addMessage({ role: "user", content: "hi" })
    useAIStore.getState().saveProjectChat(PROJECT)
    expect(useAIStore.getState().activeSessionId).not.toBeNull()
  })

  it("updates existing session when called again with same activeSessionId", () => {
    useAIStore.getState().addMessage({ role: "user", content: "v1" })
    useAIStore.getState().saveProjectChat(PROJECT)
    const sid = useAIStore.getState().activeSessionId!

    // add more and save again
    useAIStore.getState().addMessage({ role: "assistant", content: "r1" })
    useAIStore.getState().saveProjectChat(PROJECT)
    const sessions = useAIStore.getState().sessions[PROJECT]
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(sid)
    expect(sessions[0].messages).toHaveLength(2)
  })

  it("trims to 20 sessions max", () => {
    for (let i = 0; i < 21; i++) {
      useAIStore.setState({ activeSessionId: null, messages: [] })
      useAIStore.getState().addMessage({ role: "user", content: `msg ${i}` })
      useAIStore.getState().saveProjectChat(PROJECT)
    }
    expect(useAIStore.getState().sessions[PROJECT]).toHaveLength(20)
  })
})

// ── loadProjectChat ───────────────────────────────────────────────────────────

describe("loadProjectChat", () => {
  const PROJECT = "/proj/bar"

  it("loads latest session messages", () => {
    useAIStore.getState().addMessage({ role: "user", content: "session 1" })
    useAIStore.getState().saveProjectChat(PROJECT)
    useAIStore.getState().clearMessages()

    useAIStore.getState().loadProjectChat(PROJECT)
    expect(useAIStore.getState().messages[0].content).toBe("session 1")
  })

  it("clears messages when no sessions exist for project", () => {
    useAIStore.getState().addMessage({ role: "user", content: "some msg" })
    useAIStore.getState().loadProjectChat("/no-project-here")
    expect(useAIStore.getState().messages).toHaveLength(0)
    expect(useAIStore.getState().activeSessionId).toBeNull()
  })
})

// ── startNewSession ───────────────────────────────────────────────────────────

describe("startNewSession", () => {
  it("clears messages and resets activeSessionId", () => {
    useAIStore.getState().addMessage({ role: "user", content: "hi" })
    useAIStore.getState().startNewSession()
    expect(useAIStore.getState().messages).toHaveLength(0)
    expect(useAIStore.getState().activeSessionId).toBeNull()
  })

  it("saves current messages to project before clearing", () => {
    const PROJECT = "/proj/baz"
    useAIStore.getState().addMessage({ role: "user", content: "saved before clear" })
    useAIStore.getState().startNewSession(PROJECT)
    expect(useAIStore.getState().sessions[PROJECT]).toHaveLength(1)
  })

  it("builds sessionHandoff from last 2 assistant messages", () => {
    useAIStore.getState().addMessage({ role: "assistant", content: "response 1" })
    useAIStore.getState().addMessage({ role: "user", content: "q" })
    useAIStore.getState().addMessage({ role: "assistant", content: "response 2" })
    useAIStore.getState().startNewSession()
    const handoff = useAIStore.getState().sessionHandoff
    expect(handoff).toContain("response 1")
    expect(handoff).toContain("response 2")
  })

  it("sets empty handoff when no messages", () => {
    useAIStore.getState().startNewSession()
    expect(useAIStore.getState().sessionHandoff).toBe("")
  })
})

// ── switchSession ─────────────────────────────────────────────────────────────

describe("switchSession", () => {
  const PROJECT = "/proj/switch"

  it("loads target session messages and sets activeSessionId", () => {
    // create session A
    useAIStore.getState().addMessage({ role: "user", content: "session A msg" })
    useAIStore.getState().saveProjectChat(PROJECT)
    const sidA = useAIStore.getState().activeSessionId!

    // start new session B
    useAIStore.setState({ messages: [], activeSessionId: null })
    useAIStore.getState().addMessage({ role: "user", content: "session B msg" })
    useAIStore.getState().saveProjectChat(PROJECT)

    // switch back to A
    useAIStore.getState().switchSession(PROJECT, sidA)
    const { messages, activeSessionId } = useAIStore.getState()
    expect(activeSessionId).toBe(sidA)
    expect(messages[0].content).toBe("session A msg")
  })

  it("clears handoff and compressedContext after switch", () => {
    useAIStore.setState({ sessionHandoff: "old handoff", compressedContext: "old ctx" })
    useAIStore.getState().addMessage({ role: "user", content: "x" })
    useAIStore.getState().saveProjectChat(PROJECT)
    const sid = useAIStore.getState().activeSessionId!
    useAIStore.getState().switchSession(PROJECT, sid)
    expect(useAIStore.getState().sessionHandoff).toBe("")
    expect(useAIStore.getState().compressedContext).toBe("")
  })
})

// ── deleteSession ─────────────────────────────────────────────────────────────

describe("deleteSession", () => {
  const PROJECT = "/proj/del"

  it("removes session from list", () => {
    useAIStore.getState().addMessage({ role: "user", content: "x" })
    useAIStore.getState().saveProjectChat(PROJECT)
    const sid = useAIStore.getState().activeSessionId!
    useAIStore.getState().deleteSession(PROJECT, sid)
    expect(useAIStore.getState().sessions[PROJECT]).toHaveLength(0)
  })

  it("switches to latest remaining session when active session is deleted", () => {
    // session 1
    useAIStore.getState().addMessage({ role: "user", content: "session 1" })
    useAIStore.getState().saveProjectChat(PROJECT)
    const sid1 = useAIStore.getState().activeSessionId!

    // session 2
    useAIStore.setState({ messages: [], activeSessionId: null })
    useAIStore.getState().addMessage({ role: "user", content: "session 2" })
    useAIStore.getState().saveProjectChat(PROJECT)
    const sid2 = useAIStore.getState().activeSessionId!

    // delete session 2 (active) — should fall back to session 1
    useAIStore.getState().deleteSession(PROJECT, sid2)
    expect(useAIStore.getState().activeSessionId).toBe(sid1)
    expect(useAIStore.getState().messages[0].content).toBe("session 1")
  })

  it("does not change activeSession when a non-active session is deleted", () => {
    useAIStore.getState().addMessage({ role: "user", content: "s1" })
    useAIStore.getState().saveProjectChat(PROJECT)
    const sid1 = useAIStore.getState().activeSessionId!

    useAIStore.setState({ messages: [], activeSessionId: null })
    useAIStore.getState().addMessage({ role: "user", content: "s2" })
    useAIStore.getState().saveProjectChat(PROJECT)
    const sid2 = useAIStore.getState().activeSessionId!

    // delete session 1 (not active)
    useAIStore.getState().deleteSession(PROJECT, sid1)
    expect(useAIStore.getState().activeSessionId).toBe(sid2)
  })
})

// ── getProjectSessions ────────────────────────────────────────────────────────

describe("getProjectSessions", () => {
  it("returns empty array for unknown project", () => {
    expect(useAIStore.getState().getProjectSessions("/unknown")).toEqual([])
  })

  it("returns saved sessions for project", () => {
    const PROJECT = "/proj/gps"
    useAIStore.getState().addMessage({ role: "user", content: "test" })
    useAIStore.getState().saveProjectChat(PROJECT)
    expect(useAIStore.getState().getProjectSessions(PROJECT)).toHaveLength(1)
  })
})

// ── compressOldMessages ───────────────────────────────────────────────────────

describe("compressOldMessages", () => {
  it("returns early when fewer than 20 messages", async () => {
    const mockApi = { aiEstimateTokens: vi.fn(), aiCompressMessages: vi.fn() }
    ;(window as unknown as { api: unknown }).api = mockApi

    for (let i = 0; i < 19; i++) {
      useAIStore.getState().addMessage({ role: "user", content: `msg ${i}` })
    }
    await useAIStore.getState().compressOldMessages()
    expect(mockApi.aiEstimateTokens).not.toHaveBeenCalled()
  })

  it("returns early when token count is below threshold", async () => {
    const mockApi = {
      aiEstimateTokens: vi.fn().mockResolvedValue(1000),
      aiCompressMessages: vi.fn()
    }
    ;(window as unknown as { api: unknown }).api = mockApi

    for (let i = 0; i < 25; i++) {
      useAIStore.getState().addMessage({ role: "user", content: `msg ${i}` })
    }
    await useAIStore.getState().compressOldMessages()
    expect(mockApi.aiCompressMessages).not.toHaveBeenCalled()
  })

  it("compresses when token count exceeds 50000", async () => {
    const mockApi = {
      aiEstimateTokens: vi.fn().mockResolvedValue(60000),
      aiCompressMessages: vi.fn().mockResolvedValue("summary of old msgs")
    }
    ;(window as unknown as { api: unknown }).api = mockApi

    for (let i = 0; i < 25; i++) {
      useAIStore.getState().addMessage({ role: "user", content: `msg ${i}` })
    }
    await useAIStore.getState().compressOldMessages()
    expect(mockApi.aiCompressMessages).toHaveBeenCalled()
    expect(useAIStore.getState().compressedContext).toContain("summary of old msgs")
    // messages should be reduced
    expect(useAIStore.getState().messages.length).toBeLessThan(25)
  })

  it("silently swallows errors from aiEstimateTokens", async () => {
    const mockApi = {
      aiEstimateTokens: vi.fn().mockRejectedValue(new Error("network error")),
      aiCompressMessages: vi.fn()
    }
    ;(window as unknown as { api: unknown }).api = mockApi

    for (let i = 0; i < 25; i++) {
      useAIStore.getState().addMessage({ role: "user", content: `msg ${i}` })
    }
    const messagesBefore = useAIStore.getState().messages.length

    // Should not throw
    await expect(useAIStore.getState().compressOldMessages()).resolves.not.toThrow()
    // State must be unchanged
    expect(useAIStore.getState().messages.length).toBe(messagesBefore)
    expect(useAIStore.getState().compressedContext).toBe("")
    expect(mockApi.aiCompressMessages).not.toHaveBeenCalled()
  })
})
