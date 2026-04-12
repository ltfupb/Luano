interface ToolchainApi {
  toolchainRegistry: () => Promise<{
    tools: Record<string, {
      id: string; name: string; description: string
      category: string; recommended: boolean; version: string
      github: string; binaryName: string; configFiles?: string[]
    }>
    categories: Array<{ id: string; label: string; allowNone: boolean }>
  }>
  toolchainGetConfig: (projectPath?: string, projectOnly?: boolean) => Promise<{
    selections: Record<string, string | null>
    installed: Record<string, boolean>
  }>
  toolchainSetTool: (category: string, toolId: string | null, projectPath?: string) => Promise<{ success: boolean }>
  toolchainDownload: (toolId: string) => Promise<{ success: boolean; error?: string }>
  toolchainRemove: (toolId: string) => Promise<{ success: boolean; error?: string }>
  toolchainDownloadStatus: (toolId: string) => Promise<{ status: string }>
  toolchainCheckUpdates: (installedIds: string[]) => Promise<Array<{
    toolId: string
    currentVersion: string
    latestVersion: string
    downloadUrl: string
  }>>
  toolchainFetchMetadata: () => Promise<Record<string, { license: string | null; updatedAt: string | null }>>
  toolchainUpdateTool: (toolId: string, downloadUrl: string, latestVersion?: string) => Promise<{ success: boolean; error?: string }>
  toolchainDownloadMultiple: (toolIds: string[]) => Promise<Record<string, { success: boolean; error?: string }>>
  toolchainIsMinimumReady: () => Promise<boolean>
  toolchainHasProjectConfig: (projectPath: string) => Promise<boolean>
  toolchainInitProjectConfig: (projectPath: string) => Promise<{ success: boolean }>
}
