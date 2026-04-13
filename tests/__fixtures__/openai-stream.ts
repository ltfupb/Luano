/**
 * Mock helpers for OpenAI SDK chat completions used by electron/ai/agent.ts.
 *
 * Agent consumes OpenAI in two ways:
 *   1. Non-streaming: `const response = await openai.chat.completions.create({...})`
 *   2. Streaming:     `for await (const chunk of stream)`
 *
 * These helpers return objects that satisfy both shapes without pulling in
 * the real SDK typings.
 */

export type MockOpenAIToolCall = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export type MockOpenAIMessage = {
  role: "assistant"
  content: string | null
  tool_calls?: MockOpenAIToolCall[]
}

export type MockOpenAIChoice = {
  index: 0
  message: MockOpenAIMessage
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter"
}

export type MockOpenAIResponse = {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: MockOpenAIChoice[]
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export interface MockOpenAIOptions {
  /** Content returned on `.message.content`. */
  content?: string
  /** Tool calls issued by the assistant (sets finish_reason to "tool_calls"). */
  toolCalls?: MockOpenAIToolCall[]
  /** Finish reason. Defaults to "stop" or "tool_calls" based on toolCalls presence. */
  finishReason?: MockOpenAIChoice["finish_reason"]
  /** Model id reported. */
  model?: string
  /** Token accounting. */
  promptTokens?: number
  completionTokens?: number
}

/**
 * Build a full (non-streaming) OpenAI chat completion response.
 */
export function buildOpenAIResponse(opts: MockOpenAIOptions = {}): MockOpenAIResponse {
  const finish = opts.finishReason ?? (opts.toolCalls?.length ? "tool_calls" : "stop")
  return {
    id: "chatcmpl_mock_" + Math.random().toString(36).slice(2, 10),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: opts.model ?? "gpt-4o",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: opts.content ?? (opts.toolCalls?.length ? null : "ok"),
          ...(opts.toolCalls?.length ? { tool_calls: opts.toolCalls } : {})
        },
        finish_reason: finish
      }
    ],
    usage: {
      prompt_tokens: opts.promptTokens ?? 100,
      completion_tokens: opts.completionTokens ?? 20,
      total_tokens: (opts.promptTokens ?? 100) + (opts.completionTokens ?? 20)
    }
  }
}

/**
 * Build a streamed OpenAI chat completion.
 * Returns an async iterable of ChatCompletionChunk-shaped objects, matching
 * how `openai.chat.completions.create({ stream: true, ... })` is consumed.
 */
export function createOpenAIStream(opts: MockOpenAIOptions = {}) {
  const full = buildOpenAIResponse(opts)
  const base = {
    id: full.id,
    object: "chat.completion.chunk",
    created: full.created,
    model: full.model
  }

  const chunks: unknown[] = []

  if (opts.content) {
    chunks.push({
      ...base,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: opts.content },
          finish_reason: null
        }
      ]
    })
  }

  if (opts.toolCalls?.length) {
    opts.toolCalls.forEach((tc, i) => {
      chunks.push({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: i,
                  id: tc.id,
                  type: "function",
                  function: { name: tc.function.name, arguments: tc.function.arguments }
                }
              ]
            },
            finish_reason: null
          }
        ]
      })
    })
  }

  chunks.push({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: full.choices[0].finish_reason }]
  })

  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk
    }
  }
}

/**
 * Tiny factory for OpenAI tool_call objects.
 */
export function openaiToolCall(
  name: string,
  args: Record<string, unknown>,
  id = "call_" + Math.random().toString(36).slice(2, 10)
): MockOpenAIToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) }
  }
}
