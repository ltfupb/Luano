interface BridgeInstanceNode {
  name: string
  class: string
  children?: BridgeInstanceNode[]
}

interface BridgeLogEntry {
  text: string
  kind: "output" | "warn" | "error"
  ts: number
}

interface BridgeCommandResult {
  id: string
  success: boolean
  result: string
}

interface BridgeApi {
  // Studio Bridge (legacy MCP)
  studioGetConsole: () => Promise<string | null>
  studioIsConnected: () => Promise<boolean>

  // Live Bridge
  bridgeGetTree: () => Promise<BridgeInstanceNode | null>
  bridgeGetLogs: () => Promise<BridgeLogEntry[]>
  bridgeIsConnected: () => Promise<boolean>
  bridgeClearLogs: () => Promise<{ success: boolean }>
  bridgeRunScript: (code: string) => Promise<{ id: string }>
  bridgeGetCommandResult: (id: string) => Promise<BridgeCommandResult | null>
  bridgeIsPluginInstalled: () => Promise<boolean>
  bridgeInstallPlugin: () => Promise<{ success: boolean; path?: string; error?: string }>
}
