interface SyncApi {
  syncServe: (projectPath: string) => Promise<{ success: boolean }>
  syncStop: () => Promise<{ success: boolean }>
  syncGetStatus: () => Promise<string>
}
