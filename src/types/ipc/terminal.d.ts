interface TerminalApi {
  terminalCreate: (cwd?: string) => Promise<{ id: string; error?: string }>
  terminalWrite: (id: string, data: string) => Promise<void>
  terminalResize: (id: string, cols: number, rows: number) => Promise<void>
  terminalKill: (id: string) => Promise<void>
}
