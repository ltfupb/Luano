/**
 * AI Code Evaluator — Separate API call to evaluate code quality.
 * Used by the VERIFY stage of the agent loop (Pro).
 * Also available as a standalone IPC call for manual evaluation.
 */

import { chat, type ChatMessage } from "./provider"

export interface EvalResult {
  score: number       // 1-10
  issues: string[]
  suggestions: string[]
  summary: string
}

const EVAL_SYSTEM = `You are a Luau/Roblox code quality evaluator. Given source code, evaluate it and respond with ONLY a JSON object:

{
  "score": <1-10>,
  "issues": ["issue1", "issue2"],
  "suggestions": ["suggestion1", "suggestion2"],
  "summary": "one-line summary of overall quality"
}

Scoring guide:
- 9-10: Production ready, well-structured, proper typing
- 7-8: Good quality, minor improvements possible
- 5-6: Functional but has notable issues (missing error handling, unclear naming, etc.)
- 3-4: Significant problems (memory leaks, race conditions, bad patterns)
- 1-2: Critical issues (security risks, will crash, fundamentally broken)

Focus on Roblox/Luau specific concerns:
- Memory leaks (missing :Disconnect(), dangling connections)
- RunService/Heartbeat usage patterns
- RemoteEvent validation
- Proper use of task library
- Type annotations

Respond with ONLY the JSON object, no markdown fences.`

/**
 * Evaluate code quality using a separate AI call.
 * Returns structured evaluation with score, issues, and suggestions.
 */
export async function evaluateCode(
  filePath: string,
  content: string,
  instruction?: string
): Promise<EvalResult> {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath
  let userPrompt = `Evaluate this Luau code from "${fileName}":\n\n\`\`\`lua\n${content}\n\`\`\``
  if (instruction) {
    userPrompt += `\n\nThe code was written to fulfill this request: "${instruction}"`
  }

  const messages: ChatMessage[] = [{ role: "user", content: userPrompt }]

  try {
    const response = await chat(messages, EVAL_SYSTEM)
    const match = response.match(/\{[\s\S]*\}/)
    if (!match) {
      return { score: 5, issues: [], suggestions: [], summary: response.slice(0, 200) }
    }
    const parsed = JSON.parse(match[0]) as Partial<EvalResult>
    return {
      score: Math.max(1, Math.min(10, parsed.score ?? 5)),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
      summary: String(parsed.summary ?? "")
    }
  } catch (err) {
    return {
      score: 0,
      issues: [`Evaluation failed: ${err instanceof Error ? err.message : String(err)}`],
      suggestions: [],
      summary: "Evaluation failed"
    }
  }
}

/**
 * Batch evaluate multiple files. Returns map of filePath -> EvalResult.
 */
export async function evaluateFiles(
  files: Array<{ path: string; content: string }>,
  instruction?: string
): Promise<Record<string, EvalResult>> {
  const results: Record<string, EvalResult> = {}
  // Evaluate sequentially to avoid rate limits
  for (const file of files) {
    results[file.path] = await evaluateCode(file.path, file.content, instruction)
  }
  return results
}
