/**
 * Mock helpers for Anthropic SDK streams used by electron/ai/agent.ts.
 *
 * Agent consumes streams via two APIs:
 *   1. `for await (const chunk of stream)` — iterates streaming events
 *   2. `await stream.finalMessage()` — resolves to final Anthropic.Message
 *
 * These helpers return an object that satisfies both shapes so tests can
 * mock `anthropic.messages.stream(...)` return value without pulling in the
 * real SDK event typing.
 */

export type MockContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }

export type MockAnthropicMessage = {
  id: string
  type: "message"
  role: "assistant"
  model: string
  content: MockContentBlock[]
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence"
  stop_sequence: null
  usage: { input_tokens: number; output_tokens: number }
}

export interface MockAnthropicStreamOptions {
  /** Final stop reason. Defaults to "end_turn". */
  stopReason?: MockAnthropicMessage["stop_reason"]
  /** Assistant content blocks the stream emits + final message carries. */
  content?: MockContentBlock[]
  /** Token accounting. */
  inputTokens?: number
  outputTokens?: number
  /** Model id reported by the message. */
  model?: string
}

/**
 * Build a mock Anthropic message (shape used by finalMessage()).
 */
export function buildAnthropicMessage(
  opts: MockAnthropicStreamOptions = {}
): MockAnthropicMessage {
  return {
    id: "msg_mock_" + Math.random().toString(36).slice(2, 10),
    type: "message",
    role: "assistant",
    model: opts.model ?? "claude-sonnet-4-6",
    content: opts.content ?? [{ type: "text", text: "ok" }],
    stop_reason: opts.stopReason ?? "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: opts.inputTokens ?? 100,
      output_tokens: opts.outputTokens ?? 20
    }
  }
}

/**
 * Create a mock stream object that supports both
 *   `for await (const chunk of stream)` and
 *   `await stream.finalMessage()`.
 *
 * Events emitted mirror a minimal subset of Anthropic's SSE shape
 * (message_start → content_block_delta → message_stop).
 */
export function createAnthropicStream(opts: MockAnthropicStreamOptions = {}) {
  const msg = buildAnthropicMessage(opts)

  const events: unknown[] = [
    { type: "message_start", message: { ...msg, content: [] } }
  ]
  for (const block of msg.content) {
    if (block.type === "text") {
      events.push({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: block.text }
      })
    } else if (block.type === "tool_use") {
      events.push({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} }
      })
      events.push({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
      })
    }
  }
  events.push({ type: "message_delta", delta: { stop_reason: msg.stop_reason } })
  events.push({ type: "message_stop" })

  return {
    [Symbol.asyncIterator]: async function* () {
      for (const ev of events) yield ev
    },
    finalMessage: async () => msg
  }
}

/**
 * Tiny factory for tool_use content blocks.
 */
export function toolUseBlock(
  name: string,
  input: Record<string, unknown>,
  id = "toolu_" + Math.random().toString(36).slice(2, 10)
): MockContentBlock {
  return { type: "tool_use", id, name, input }
}

/**
 * Tiny factory for text content blocks.
 */
export function textBlock(text: string): MockContentBlock {
  return { type: "text", text }
}
