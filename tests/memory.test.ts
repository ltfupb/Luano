import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join } from "path"
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs"
import {
  getMemories, addMemory, updateMemory, deleteMemory,
  getMemoriesByType, buildMemoryContext, buildMemoryIndex, buildMemoryDetail,
  loadInstructions,
  buildMemoryDetectPrompt, parseMemoryDetectResponse,
  estimateTokens, estimateMessagesTokens,
  buildCompressionPrompt
} from "../electron/ai/memory"

const TEST_DIR = join(__dirname, ".tmp-test-project")

beforeEach(() => {
  mkdirSync(join(TEST_DIR, ".luano"), { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe("Memory CRUD", () => {
  it("starts with empty memories", () => {
    expect(getMemories(TEST_DIR)).toEqual([])
  })

  it("adds a memory", () => {
    const mem = addMemory(TEST_DIR, "user", "Prefers OOP style")
    expect(mem.id).toMatch(/^mem_/)
    expect(mem.type).toBe("user")
    expect(mem.content).toBe("Prefers OOP style")
    expect(mem.createdAt).toBeTruthy()
  })

  it("persists memories to disk", () => {
    addMemory(TEST_DIR, "user", "test")
    const raw = JSON.parse(readFileSync(join(TEST_DIR, ".luano", "memory.json"), "utf-8"))
    expect(raw.memories).toHaveLength(1)
  })

  it("retrieves all memories", () => {
    addMemory(TEST_DIR, "user", "pref1")
    addMemory(TEST_DIR, "project", "decision1")
    addMemory(TEST_DIR, "feedback", "correction1")
    expect(getMemories(TEST_DIR)).toHaveLength(3)
  })

  it("filters by type", () => {
    addMemory(TEST_DIR, "user", "u1")
    addMemory(TEST_DIR, "project", "p1")
    addMemory(TEST_DIR, "user", "u2")
    expect(getMemoriesByType(TEST_DIR, "user")).toHaveLength(2)
    expect(getMemoriesByType(TEST_DIR, "project")).toHaveLength(1)
    expect(getMemoriesByType(TEST_DIR, "feedback")).toHaveLength(0)
  })

  it("updates a memory", async () => {
    const mem = addMemory(TEST_DIR, "user", "old content")
    await new Promise((r) => setTimeout(r, 5))
    const updated = updateMemory(TEST_DIR, mem.id, "new content")
    expect(updated).not.toBeNull()
    expect(updated!.content).toBe("new content")
    expect(updated!.updatedAt).not.toBe(mem.createdAt)
  })

  it("returns null when updating non-existent id", () => {
    expect(updateMemory(TEST_DIR, "fake_id", "test")).toBeNull()
  })

  it("deletes a memory", () => {
    const mem = addMemory(TEST_DIR, "user", "to delete")
    expect(deleteMemory(TEST_DIR, mem.id)).toBe(true)
    expect(getMemories(TEST_DIR)).toHaveLength(0)
  })

  it("returns false when deleting non-existent id", () => {
    expect(deleteMemory(TEST_DIR, "fake_id")).toBe(false)
  })
})

describe("buildMemoryContext (legacy)", () => {
  it("returns 'No memories stored.' when no memories", () => {
    expect(buildMemoryContext(TEST_DIR)).toBe("No memories stored.")
  })

  it("groups memories by type", () => {
    addMemory(TEST_DIR, "user", "likes TypeScript")
    addMemory(TEST_DIR, "feedback", "no trailing summaries")
    addMemory(TEST_DIR, "project", "using Knit framework")

    const ctx = buildMemoryContext(TEST_DIR)
    expect(ctx).toContain("[Full memory detail]")
    expect(ctx).toContain("User:")
    expect(ctx).toContain("likes TypeScript")
    expect(ctx).toContain("Feedback:")
    expect(ctx).toContain("no trailing summaries")
    expect(ctx).toContain("Project notes:")
    expect(ctx).toContain("using Knit framework")
  })
})

describe("buildMemoryIndex (Layer 1)", () => {
  it("returns empty string when no memories", () => {
    expect(buildMemoryIndex(TEST_DIR)).toBe("")
  })

  it("returns short pointers with memory IDs", () => {
    addMemory(TEST_DIR, "user", "likes TypeScript")
    addMemory(TEST_DIR, "feedback", "no trailing summaries")

    const idx = buildMemoryIndex(TEST_DIR)
    expect(idx).toContain("[Memories")
    expect(idx).toContain("User:")
    expect(idx).toContain("Feedback:")
    expect(idx).toMatch(/\[mem_/)
  })

  it("truncates long content to ~80 chars", () => {
    const longContent = "A".repeat(200)
    addMemory(TEST_DIR, "user", longContent)

    const idx = buildMemoryIndex(TEST_DIR)
    expect(idx).toContain("…")
    expect(idx).not.toContain("A".repeat(200))
  })
})

describe("buildMemoryDetail (Layer 2)", () => {
  it("returns 'No memories stored.' when empty", () => {
    expect(buildMemoryDetail(TEST_DIR)).toBe("No memories stored.")
  })

  it("looks up single memory by ID", () => {
    const mem = addMemory(TEST_DIR, "user", "likes TypeScript")
    const detail = buildMemoryDetail(TEST_DIR, mem.id)
    expect(detail).toContain("likes TypeScript")
    expect(detail).toContain("[user]")
  })

  it("returns not found for bad ID when memories exist", () => {
    addMemory(TEST_DIR, "user", "some memory")
    expect(buildMemoryDetail(TEST_DIR, "mem_fake")).toBe("Memory mem_fake not found.")
  })
})

describe("loadInstructions", () => {
  it("returns empty string when LUANO.md does not exist", () => {
    expect(loadInstructions(TEST_DIR)).toBe("")
  })

  it("reads LUANO.md from project root", () => {
    const fp = join(TEST_DIR, "LUANO.md")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { writeFileSync } = require("fs")
    writeFileSync(fp, "# Project Rules\n- Use strict mode", "utf-8")
    const result = loadInstructions(TEST_DIR)
    expect(result).toContain("# Project Rules")
    expect(result).toContain("Use strict mode")
  })
})

describe("Auto Memory Detection", () => {
  it("builds detection prompt from conversation", () => {
    const prompt = buildMemoryDetectPrompt("I prefer OOP", "Got it, I'll use OOP")
    expect(prompt).toContain("User: I prefer OOP")
    expect(prompt).toContain("Assistant: Got it")
  })

  it("parses NONE response", () => {
    const result = parseMemoryDetectResponse("NONE", TEST_DIR)
    expect(result).toEqual([])
  })

  it("parses valid memory lines", () => {
    const response = "user|Prefers OOP coding style\nfeedback|No trailing summaries"
    const result = parseMemoryDetectResponse(response, TEST_DIR)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe("user")
    expect(result[1].type).toBe("feedback")
  })

  it("skips duplicate memories", () => {
    addMemory(TEST_DIR, "user", "Prefers OOP coding style")
    const response = "user|Prefers OOP coding style"
    const result = parseMemoryDetectResponse(response, TEST_DIR)
    expect(result).toHaveLength(0)
  })

  it("ignores invalid lines", () => {
    const response = "invalid line\nuser|valid memory\nrandom|bad type"
    const result = parseMemoryDetectResponse(response, TEST_DIR)
    expect(result).toHaveLength(1)
  })
})

describe("Token Estimation", () => {
  it("estimates English text tokens", () => {
    const tokens = estimateTokens("Hello world this is a test")
    // ~26 chars / 4 = ~7 tokens
    expect(tokens).toBeGreaterThan(5)
    expect(tokens).toBeLessThan(15)
  })

  it("estimates CJK text with higher token density", () => {
    const cjk = estimateTokens("안녕하세요 반갑습니다")
    const english = estimateTokens("Hello nice to meet you")
    // CJK should estimate higher token count per character
    expect(cjk).toBeGreaterThan(0)
  })

  it("estimates message array tokens", () => {
    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there, how can I help?" }
    ]
    const tokens = estimateMessagesTokens(messages)
    expect(tokens).toBeGreaterThan(5)
  })
})

describe("Compression Prompt", () => {
  it("builds compression prompt from messages", () => {
    const messages = [
      { role: "user", content: "Fix the bug in player.lua" },
      { role: "assistant", content: "I found the issue. The variable was nil." }
    ]
    const prompt = buildCompressionPrompt(messages)
    expect(prompt).toContain("Summarize this conversation")
    expect(prompt).toContain("Fix the bug")
    expect(prompt).toContain("variable was nil")
  })
})
