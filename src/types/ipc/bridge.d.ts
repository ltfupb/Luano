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
  // Live Bridge — single canonical Studio runtime channel
  bridgeGetTree: () => Promise<BridgeInstanceNode | null>
  bridgeGetLogs: () => Promise<BridgeLogEntry[]>
  bridgeIsConnected: () => Promise<boolean>
  bridgeClearLogs: () => Promise<{ success: boolean }>
  // Resolves with `{ id }` on success. The main-process handler now requires
  // a native confirm dialog before queueing the script (see
  // `electron/ipc/bridge-handlers.ts`); on denial / project-missing / Pro
  // gating, the actual runtime payload is `{ success: false, error }` (or the
  // Pro shape) — callers that depend on the success path should optional-chain
  // `.id` and treat its absence as "denied".
  bridgeRunScript: (code: string) => Promise<{ id: string }>
  bridgeGetCommandResult: (id: string) => Promise<BridgeCommandResult | null>
  bridgeIsPluginInstalled: () => Promise<boolean>
  bridgeInstallPlugin: () => Promise<{ success: boolean; path?: string; error?: string }>
  bridgeGetToken: () => Promise<string | { success: false; error: string; message: string }>

  // Emitted when the main process invalidates the existing bridge token (e.g.
  // because the on-disk token file was corrupt and had to be regenerated).
  // Notice-only — the token itself never flows through this event; renderers
  // that need the new value must fetch it via the Pro-gated bridge:get-token.
  onBridgeTokenInvalidated: (cb: () => void) => () => void
}
