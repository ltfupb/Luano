interface ProjectApi {
  openFolder: () => Promise<string | null>
  openProject: (path: string) => Promise<{ success: boolean; lspPort: number }>
  closeProject: () => Promise<{ success: boolean }>
  initProject: (path: string) => Promise<{ success: boolean }>
}
