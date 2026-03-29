import { readFileSync, readdirSync, statSync, existsSync } from "fs"
import { join, extname, relative, basename, dirname } from "path"

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScriptKind = "server" | "client" | "shared"

export interface ScriptNode {
  id: string       // relative path from project root (used as key)
  name: string     // display name
  path: string     // absolute path
  kind: ScriptKind
  group: string
}

export interface RemoteNode {
  id: string       // remote name
  name: string
}

export type EdgeKind =
  | "require"
  | "fire_server"      // Client → fires → RemoteEvent
  | "fire_client"      // Server → fires → RemoteEvent
  | "fire_all"         // Server → fires all → RemoteEvent
  | "receives_server"  // RemoteEvent → Server handler
  | "receives_client"  // RemoteEvent → Client handler

export interface TopologyEdge {
  id: string
  source: string   // scriptNode.id or remoteNode.id
  target: string
  kind: EdgeKind
  label?: string
}

export interface TopologyResult {
  scripts: ScriptNode[]
  remotes: RemoteNode[]
  edges: TopologyEdge[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function classifyPath(relPath: string): ScriptKind {
  const norm = relPath.replace(/\\/g, "/")
  if (norm.startsWith("src/server")) return "server"
  if (norm.startsWith("src/client")) return "client"
  return "shared"
}

function extractGroup(relPath: string, kind: ScriptKind): string {
  const norm = relPath.replace(/\\/g, "/")
  const prefix = `src/${kind}/`
  const after = norm.slice(prefix.length)
  const slash = after.indexOf("/")
  if (slash === -1) return ""
  return after.slice(0, slash)
}

function walkLuau(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    try {
      const stat = statSync(full)
      if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
        walkLuau(full, out)
      } else if (stat.isFile() && (extname(entry) === ".lua" || extname(entry) === ".luau")) {
        out.push(full)
      }
    } catch {}
  }
}

// Extract all string literal arguments to WaitForChild / FindFirstChild
function extractChildNames(src: string): string[] {
  const names: string[] = []
  const re = /(?:WaitForChild|FindFirstChild)\s*\(\s*["']([^"']+)["']/g
  let m
  while ((m = re.exec(src)) !== null) names.push(m[1])
  return names
}

// Extract module names from require() calls
function extractRequires(src: string): string[] {
  const names: string[] = []
  // require(path.To.Module) → last segment
  const re = /require\s*\(\s*[^)]+?\b(\w+)\s*\)/g
  let m
  while ((m = re.exec(src)) !== null) {
    // skip known service names that aren't user modules
    const skip = new Set(["ReplicatedStorage", "ServerScriptService", "StarterPlayer",
      "StarterPlayerScripts", "Workspace", "Players", "RunService", "game", "script"])
    if (!skip.has(m[1])) names.push(m[1])
  }
  return [...new Set(names)]
}

// Very light heuristic: scan for local var = ...WaitForChild("X") then varName:Method
interface RemoteUsage {
  name: string
  fires: EdgeKind[]
  receives: EdgeKind[]
}

function extractRemoteUsages(src: string): RemoteUsage[] {
  const usages = new Map<string, RemoteUsage>()

  // Pass 1: collect variable → remote name bindings
  // Patterns: local varName = ...WaitForChild("RemoteName")
  //           local varName = remotes.RemoteName
  const varBind1 = /local\s+(\w+)\s*=\s*[^=\n]*?(?:WaitForChild|FindFirstChild)\s*\(\s*["']([^"']+)["']/g
  let m: RegExpExecArray | null
  const varToRemote = new Map<string, string>()

  while ((m = varBind1.exec(src)) !== null) {
    varToRemote.set(m[1], m[2])
    if (!usages.has(m[2])) usages.set(m[2], { name: m[2], fires: [], receives: [] })
  }

  // Also detect direct reference: local varName = remotes.RemoteName (PascalCase)
  const varBind2 = /local\s+(\w+)\s*=\s*\w+\.([A-Z]\w+)\s*(?:\n|$)/g
  while ((m = varBind2.exec(src)) !== null) {
    // Only if the right side looks like a Remote name (PascalCase identifier after a dot)
    varToRemote.set(m[1], m[2])
    if (!usages.has(m[2])) usages.set(m[2], { name: m[2], fires: [], receives: [] })
  }

  // Pass 2: detect fire / receive patterns with known var names
  for (const [varName, remoteName] of varToRemote) {
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const usage = usages.get(remoteName)!

    if (new RegExp(`${escaped}\\s*:\\s*FireServer\\s*\\(`).test(src))
      usage.fires.push("fire_server")
    if (new RegExp(`${escaped}\\s*:\\s*FireClient\\s*\\(`).test(src))
      usage.fires.push("fire_client")
    if (new RegExp(`${escaped}\\s*:\\s*FireAllClients\\s*\\(`).test(src))
      usage.fires.push("fire_all")
    if (new RegExp(`${escaped}\\s*\\.\\s*OnServerEvent\\s*[.:]\\s*Connect`).test(src))
      usage.receives.push("receives_server")
    if (new RegExp(`${escaped}\\s*\\.\\s*OnClientEvent\\s*[.:]\\s*Connect`).test(src))
      usage.receives.push("receives_client")
  }

  // Pass 3: fallback — any unbound fire/receive keywords, use WaitForChild names as hints
  const childNames = extractChildNames(src)

  const hasFire = (src: string, pat: RegExp, kind: EdgeKind) => {
    if (!pat.test(src)) return false
    return true
  }

  if (hasFire(src, /\bFireServer\s*\(/, "fire_server")) {
    const candidate = childNames[0] ?? "__unknown__"
    if (!usages.has(candidate)) usages.set(candidate, { name: candidate, fires: [], receives: [] })
    const u = usages.get(candidate)!
    if (!u.fires.includes("fire_server")) u.fires.push("fire_server")
  }
  if (hasFire(src, /\bFireAllClients\s*\(/, "fire_all")) {
    const candidate = childNames[0] ?? "__unknown__"
    if (!usages.has(candidate)) usages.set(candidate, { name: candidate, fires: [], receives: [] })
    const u = usages.get(candidate)!
    if (!u.fires.includes("fire_all")) u.fires.push("fire_all")
  }
  if (hasFire(src, /\bFireClient\s*\(/, "fire_client")) {
    const candidate = childNames[0] ?? "__unknown__"
    if (!usages.has(candidate)) usages.set(candidate, { name: candidate, fires: [], receives: [] })
    const u = usages.get(candidate)!
    if (!u.fires.includes("fire_client")) u.fires.push("fire_client")
  }
  if (hasFire(src, /\.OnServerEvent\s*[.:]\s*Connect/, "receives_server")) {
    const candidate = childNames[0] ?? "__unknown__"
    if (!usages.has(candidate)) usages.set(candidate, { name: candidate, fires: [], receives: [] })
    const u = usages.get(candidate)!
    if (!u.receives.includes("receives_server")) u.receives.push("receives_server")
  }
  if (hasFire(src, /\.OnClientEvent\s*[.:]\s*Connect/, "receives_client")) {
    const candidate = childNames[0] ?? "__unknown__"
    if (!usages.has(candidate)) usages.set(candidate, { name: candidate, fires: [], receives: [] })
    const u = usages.get(candidate)!
    if (!u.receives.includes("receives_client")) u.receives.push("receives_client")
  }

  return [...usages.values()].filter((u) => u.fires.length > 0 || u.receives.length > 0)
}

// ── Main Analyzer ─────────────────────────────────────────────────────────────

export function analyzeTopology(projectPath: string): TopologyResult {
  const srcDir = join(projectPath, "src")
  const allFiles: string[] = []
  walkLuau(srcDir, allFiles)

  const scripts: ScriptNode[] = []
  const remoteMap = new Map<string, RemoteNode>()
  const edges: TopologyEdge[] = []
  let edgeCounter = 0

  const nextEdgeId = () => `e${edgeCounter++}`

  // Build script nodes
  for (const absPath of allFiles) {
    const rel = relative(projectPath, absPath).replace(/\\/g, "/")
    const name = basename(absPath, extname(absPath))
    const kind = classifyPath(rel)
    scripts.push({
      id: rel,
      name,
      path: absPath,
      kind,
      group: extractGroup(rel, kind)
    })
  }

  // Build script id index by name for require resolution
  const scriptByName = new Map<string, ScriptNode>()
  for (const s of scripts) scriptByName.set(s.name.toLowerCase(), s)

  // Analyze each script
  for (const script of scripts) {
    let src = ""
    try { src = readFileSync(script.path, "utf-8") } catch { continue }

    // Require edges
    const reqNames = extractRequires(src)
    for (const rname of reqNames) {
      const target = scriptByName.get(rname.toLowerCase())
      if (target && target.id !== script.id) {
        edges.push({
          id: nextEdgeId(),
          source: script.id,
          target: target.id,
          kind: "require",
          label: rname
        })
      }
    }

    // Remote edges
    const remoteUsages = extractRemoteUsages(src)
    for (const usage of remoteUsages) {
      if (usage.name === "__unknown__") continue

      // Ensure remote node exists
      if (!remoteMap.has(usage.name)) {
        remoteMap.set(usage.name, { id: `remote:${usage.name}`, name: usage.name })
      }
      const remoteId = `remote:${usage.name}`

      for (const kind of usage.fires) {
        edges.push({ id: nextEdgeId(), source: script.id, target: remoteId, kind, label: usage.name })
      }
      for (const kind of usage.receives) {
        edges.push({ id: nextEdgeId(), source: remoteId, target: script.id, kind, label: usage.name })
      }
    }
  }

  return {
    scripts,
    remotes: [...remoteMap.values()],
    edges
  }
}
