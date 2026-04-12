interface AiApi {
  // Keys
  aiSetKey: (key: string) => Promise<{ success: boolean }>
  aiGetKey: () => Promise<string | null>
  aiSetOpenAIKey: (key: string) => Promise<{ success: boolean }>
  aiGetOpenAIKey: () => Promise<string | null>
  aiSetGeminiKey: (key: string) => Promise<{ success: boolean }>
  aiGetGeminiKey: () => Promise<string | null>
  aiSetLocalEndpoint: (endpoint: string) => Promise<{ success: boolean }>
  aiGetLocalEndpoint: () => Promise<string>
  aiSetLocalKey: (key: string) => Promise<{ success: boolean }>
  aiGetLocalKey: () => Promise<string | null>
  aiSetLocalModel: (model: string) => Promise<{ success: boolean }>
  aiGetLocalModel: () => Promise<string>
  aiFetchLocalModels: () => Promise<Array<{ id: string; label: string }>>
  aiSetProvider: (provider: string) => Promise<{ success: boolean }>
  aiSetModel: (model: string) => Promise<{ success: boolean }>
  aiGetProviderModel: () => Promise<{
    provider: string
    model: string
    models: {
      anthropic: Array<{ id: string; label: string }>
      openai: Array<{ id: string; label: string }>
      gemini: Array<{ id: string; label: string }>
      local: Array<{ id: string; label: string }>
    }
  }>

  // Advisor
  aiSetAdvisor: (enabled: boolean) => Promise<{ success: boolean }>
  aiGetAdvisor: () => Promise<boolean>

  // Agent Todos
  onTodosUpdated: (cb: (todos: Array<{ content: string; status: string }>) => void) => () => void

  // Token usage
  aiGetTokenUsage: () => Promise<{ input: number; output: number; cacheRead: number }>
  aiResetTokenUsage: () => Promise<{ success: boolean }>
  onTokenUsage: (cb: (usage: { input: number; output: number; cacheRead: number }) => void) => () => void

  // Context
  buildContext: (projectPath: string, filePath?: string) => Promise<{ globalSummary: string }>

  // Chat
  aiChat: (messages: unknown[], context: unknown) => Promise<string>
  aiChatStream: (
    messages: unknown[],
    context: unknown,
    onChunk: (chunk: string | null) => void,
    onAdvisor?: (active: boolean) => void
  ) => Promise<void>

  // Plan Chat
  aiPlanChat: (messages: unknown[], context: unknown) => Promise<string[]>

  // Inline Edit
  inlineEdit: (
    filePath: string,
    fileContent: string,
    instruction: string,
    context: unknown
  ) => Promise<string>

  // Agent Chat
  aiAgentChat: (
    messages: unknown[],
    context: unknown,
    onChunk: (chunk: string | null) => void,
    onTool: (event: {
      tool: string
      input: Record<string, unknown>
      output: string
      success: boolean
    }) => void,
    onRound?: (info: { round: number; max: number }) => void,
    onAdvisor?: (active: boolean) => void
  ) => Promise<{ modifiedFiles: string[] }>

  // Agent Abort / Revert
  aiAbort: () => void
  aiRevert: () => Promise<{ success: boolean; reverted?: string[] }>
  onCheckpointAvailable: (cb: (info: { fileCount: number; files: string[] }) => void) => () => void

  // Error Explainer
  explainError: (errorText: string, context: unknown) => Promise<string>

  // Evaluator
  aiEvaluate: (filePath: string, content: string, instruction?: string) => Promise<{
    score: number
    issues: string[]
    suggestions: string[]
    summary: string
  }>
  aiEvaluateBatch: (
    files: Array<{ path: string; content: string }>,
    instruction?: string
  ) => Promise<Record<string, { score: number; issues: string[]; suggestions: string[]; summary: string }>>

  // Context Compression
  aiCompressMessages: (messages: Array<{ role: string; content: string }>) => Promise<string>
  aiEstimateTokens: (messages: Array<{ role: string; content: string }>) => Promise<number>
}
