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
  // downloadUrl removed: handler ignores renderer-supplied URLs (M3 fix)
  toolchainUpdateTool: (toolId: string, latestVersion?: string) => Promise<{ success: boolean; error?: string }>
  toolchainDownloadMultiple: (toolIds: string[]) => Promise<Record<string, { success: boolean; error?: string }>>
  toolchainIsMinimumReady: () => Promise<boolean>
  toolchainHasProjectConfig: (projectPath: string) => Promise<boolean>
  toolchainInitProjectConfig: (projectPath: string) => Promise<{ success: boolean; error?: string }>
  packageManagerRun: (
    projectPath: string,
    command: "init" | "install" | "update" | "add",
    packageName?: string
  ) => Promise<{
    success: boolean
    output?: string
    error?: string
    tool?: string
  }>
  packageManagerMigrateToPesde: (projectPath: string) => Promise<{
    success: boolean
    error?: string
    migratedCount?: number
    unmappedCount?: number
    pesdeTomlPath?: string
    backupPath?: string
  }>
  packageManagerMigrateToWally: (
    projectPath: string,
    options?: { force?: boolean }
  ) => Promise<{
    success: boolean
    notSupported?: boolean
    /** Set when wally.toml.bak is older than current pesde.toml — caller should
     *  confirm with the user before re-invoking with `{ force: true }`. */
    staleBackup?: { backupPath: string; backupAgeDays: number; pesdeAgeDays: number }
    error?: string
    wallyTomlPath?: string
    backupPath?: string
  }>
}
