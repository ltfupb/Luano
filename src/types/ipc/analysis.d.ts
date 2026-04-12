type ScriptKind = "server" | "client" | "shared"

type EdgeKind =
  | "require"
  | "fire_server"
  | "fire_client"
  | "fire_all"
  | "receives_server"
  | "receives_client"

interface TopologyScriptNode {
  id: string
  name: string
  path: string
  kind: ScriptKind
  group: string
}

interface TopologyRemoteNode {
  id: string
  name: string
}

interface TopologyEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  label?: string
}

interface TopologyResult {
  scripts: TopologyScriptNode[]
  remotes: TopologyRemoteNode[]
  edges: TopologyEdge[]
}

interface AnalysisApi {
  analyzeTopology: (projectPath: string) => Promise<TopologyResult>
  analyzeCrossScript: (projectPath: string) => Promise<unknown>
  perfLint: (projectPath: string) => Promise<unknown>
  perfLintFile: (filePath: string, content: string) => Promise<unknown>
}
