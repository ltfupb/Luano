interface AskUserOption { label: string; description?: string; preview?: string }
interface AskUserQuestion { question: string; header: string; options: AskUserOption[]; multiSelect?: boolean }

interface EditPreviewPayload {
  path: string
  oldContent: string
  newContent: string | null
  kind: "create" | "edit" | "delete"
  error?: string
}

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

  // Thinking effort (low | medium | high | xhigh | max)
  aiSetThinkingEffort: (effort: string) => Promise<{ success: boolean }>
  aiGetThinkingEffort: () => Promise<"low" | "medium" | "high" | "xhigh" | "max">

  // Managed AI — usage from Worker
  managedFetchUsage: () => Promise<{
    period_ym: string
    used: number
    cap: number
    remaining: number
    cache_hit_rate: number
    resets_at: number
  } | null>

  // Native menu — tell main to rebuild with hasProject state
  menuSetProjectState: (hasProject: boolean) => Promise<{ success: boolean }>

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
    onAdvisor?: (active: boolean) => void,
    onThinking?: (active: boolean) => void
  ) => Promise<void>

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
    onAdvisor?: (active: boolean) => void,
    onThinking?: (active: boolean) => void,
    onApprovalRequest?: (req: { id: string; tool: string; input: Record<string, unknown>; preview?: EditPreviewPayload | null }) => void,
    onAskUserRequest?: (req: { id: string; questions: AskUserQuestion[] }) => void,
    autoAccept?: boolean
  ) => Promise<{ modifiedFiles: string[] }>


  // Agent Abort / Revert
  aiAbort: () => void

  // Tool Approval (destructive ops)
  sendToolApproval: (id: string, approved: boolean) => void

  // Ask User (interactive question UI)
  sendAskUserResponse: (id: string, answers: Record<string, string>) => void
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
