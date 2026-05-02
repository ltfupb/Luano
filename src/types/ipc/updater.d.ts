interface UpdaterApi {
  updaterCheck: () => Promise<{ success: boolean; version?: string; error?: string }>
  updaterDownload: () => Promise<{ success: boolean; error?: string }>
  updaterInstall: () => Promise<{ success: boolean; error?: string }>
  updaterStatus: () => Promise<{
    status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error"
    version?: string
    progress?: number
    error?: string
  }>
}
