/**
 * tests/sync-store.test.ts — Unit tests for src/stores/syncStore.ts
 *
 * Runs in jsdom (localStorage available).
 * Tests initial state and all setters.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { useSyncStore } from "../src/stores/syncStore"

// syncStore has no persist middleware, so no localStorage to clear.
// Just reset state directly before each test.

const INITIAL: Parameters<typeof useSyncStore.setState>[0] = {
  status: "stopped",
  port: null,
  toolName: "Argon",
  error: null
}

beforeEach(() => {
  useSyncStore.setState(INITIAL)
})

describe("syncStore — initial state", () => {
  it("starts stopped with no port or error", () => {
    const s = useSyncStore.getState()
    expect(s.status).toBe("stopped")
    expect(s.port).toBeNull()
    expect(s.error).toBeNull()
  })

  it("has Argon as default tool name", () => {
    expect(useSyncStore.getState().toolName).toBe("Argon")
  })
})

describe("syncStore — setters", () => {
  it("setStatus transitions correctly", () => {
    useSyncStore.getState().setStatus("starting")
    expect(useSyncStore.getState().status).toBe("starting")
    useSyncStore.getState().setStatus("running")
    expect(useSyncStore.getState().status).toBe("running")
    useSyncStore.getState().setStatus("error")
    expect(useSyncStore.getState().status).toBe("error")
    useSyncStore.getState().setStatus("stopped")
    expect(useSyncStore.getState().status).toBe("stopped")
  })

  it("setPort updates port value", () => {
    useSyncStore.getState().setPort(34872)
    expect(useSyncStore.getState().port).toBe(34872)
    useSyncStore.getState().setPort(null)
    expect(useSyncStore.getState().port).toBeNull()
  })

  it("setToolName updates toolName", () => {
    useSyncStore.getState().setToolName("Rojo")
    expect(useSyncStore.getState().toolName).toBe("Rojo")
  })

  it("setError sets and clears error", () => {
    useSyncStore.getState().setError("connection refused")
    expect(useSyncStore.getState().error).toBe("connection refused")
    useSyncStore.getState().setError(null)
    expect(useSyncStore.getState().error).toBeNull()
  })
})
