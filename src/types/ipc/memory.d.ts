interface MemoryApi {
  memoryList: (projectPath: string) => Promise<Array<{
    id: string
    type: "user" | "project" | "feedback"
    content: string
    createdAt: string
    updatedAt: string
  }>>
  memoryAdd: (projectPath: string, type: string, content: string) => Promise<{
    id: string; type: string; content: string; createdAt: string; updatedAt: string
  }>
  memoryUpdate: (projectPath: string, id: string, content: string) => Promise<{
    id: string; type: string; content: string; createdAt: string; updatedAt: string
  } | null>
  memoryDelete: (projectPath: string, id: string) => Promise<boolean>
  memoryContext: (projectPath: string) => Promise<string>
  memoryAutoDetect: (projectPath: string, userMsg: string, assistantMsg: string) => Promise<Array<{
    id: string; type: string; content: string
  }>>
  instructionsLoad: (projectPath: string) => Promise<string>
}
