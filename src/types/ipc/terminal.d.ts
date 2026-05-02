interface TerminalApi {
  terminalCreate: (cwd?: string) => Promise<{ id: string; error?: string }>
  terminalWrite: (id: string, data: string) => Promise<{ success: boolean; error?: string }>
  terminalResize: (id: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>
  terminalKill: (id: string) => Promise<{ success: boolean; error?: string }>
}
