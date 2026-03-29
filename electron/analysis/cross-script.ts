import { readFileSync, readdirSync, statSync, existsSync } from "fs"
import { join, extname, relative, basename } from "path"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ServiceUsage {
  name: string
  methods: string[]
}

export interface RemoteLink {
  remoteName: string
  fireScripts: Array<{ path: string; kind: "FireServer" | "FireClient" | "FireAllClients" }>
  handleScripts: Array<{ path: string; kind: "OnServerEvent" | "OnClientEvent" }>
}

export interface ScriptAnalysis {
  path: string
  relPath: string
  kind: "server" | "client" | "shared"
  services: ServiceUsage[]
  remotesFired: string[]
  remotesHandled: string[]
  requires: string[]
}

export interface CrossScriptResult {
  scripts: ScriptAnalysis[]
  remoteLinks: RemoteLink[]
}

// ── Roblox 서비스 목록 ────────────────────────────────────────────────────────

const ROBLOX_SERVICES = [
  "Players", "DataStoreService", "ReplicatedStorage", "ServerScriptService",
  "ServerStorage", "StarterGui", "StarterPlayer", "StarterPlayerScripts",
  "Workspace", "RunService", "UserInputService", "TweenService",
  "HttpService", "MarketplaceService", "MessagingService", "TeleportService",
  "CollectionService", "PhysicsService", "SoundService", "Chat",
  "Teams", "BadgeService", "GamePassService", "PolicyService",
  "TextService", "LocalizationService", "MemoryStoreService",
  "ProximityPromptService", "PathfindingService", "ContextActionService",
  "GuiService", "HapticService", "VRService", "InsertService",
  "GroupService", "AssetService", "AnimationClipProvider"
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function walkLuau(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      try {
        const stat = statSync(full)
        if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
          out.push(...walkLuau(full))
        } else if (stat.isFile() && (extname(entry) === ".lua" || extname(entry) === ".luau")) {
          out.push(full)
        }
      } catch {}
    }
  } catch {}
  return out
}

function classifyPath(relPath: string): "server" | "client" | "shared" {
  const norm = relPath.replace(/\\/g, "/")
  if (norm.startsWith("src/server")) return "server"
  if (norm.startsWith("src/client")) return "client"
  return "shared"
}

function extractServices(src: string): ServiceUsage[] {
  const services: Map<string, Set<string>> = new Map()

  // game:GetService("ServiceName")
  const getServiceRe = /game\s*:\s*GetService\s*\(\s*["'](\w+)["']\s*\)/g
  let m: RegExpExecArray | null
  while ((m = getServiceRe.exec(src)) !== null) {
    const name = m[1]
    if (ROBLOX_SERVICES.includes(name)) {
      if (!services.has(name)) services.set(name, new Set())
    }
  }

  // 서비스 변수에서 메서드 호출 추적
  // local Players = game:GetService("Players")  →  Players:GetPlayers()
  const bindRe = /local\s+(\w+)\s*=\s*game\s*:\s*GetService\s*\(\s*["'](\w+)["']\s*\)/g
  const bindings = new Map<string, string>()
  while ((m = bindRe.exec(src)) !== null) {
    bindings.set(m[1], m[2])
    if (!services.has(m[2])) services.set(m[2], new Set())
  }

  // 메서드 호출 추적
  for (const [varName, serviceName] of bindings) {
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const methodRe = new RegExp(`${escaped}\\s*[.:]\\s*(\\w+)\\s*[.(]`, "g")
    while ((m = methodRe.exec(src)) !== null) {
      services.get(serviceName)?.add(m[1])
    }
  }

  return [...services.entries()].map(([name, methods]) => ({
    name,
    methods: [...methods]
  }))
}

function extractRemoteFires(src: string): Array<{ name: string; kind: "FireServer" | "FireClient" | "FireAllClients" }> {
  const results: Array<{ name: string; kind: "FireServer" | "FireClient" | "FireAllClients" }> = []

  // 변수 바인딩: local varName = ...WaitForChild("RemoteName") or ...FindFirstChild("RemoteName")
  const bindRe = /local\s+(\w+)\s*=\s*[^=\n]*?(?:WaitForChild|FindFirstChild)\s*\(\s*["']([^"']+)["']/g
  const varToRemote = new Map<string, string>()
  let m: RegExpExecArray | null
  while ((m = bindRe.exec(src)) !== null) {
    varToRemote.set(m[1], m[2])
  }

  for (const [varName, remoteName] of varToRemote) {
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (new RegExp(`${escaped}\\s*:\\s*FireServer\\s*\\(`).test(src))
      results.push({ name: remoteName, kind: "FireServer" })
    if (new RegExp(`${escaped}\\s*:\\s*FireClient\\s*\\(`).test(src))
      results.push({ name: remoteName, kind: "FireClient" })
    if (new RegExp(`${escaped}\\s*:\\s*FireAllClients\\s*\\(`).test(src))
      results.push({ name: remoteName, kind: "FireAllClients" })
  }

  return results
}

function extractRemoteHandlers(src: string): Array<{ name: string; kind: "OnServerEvent" | "OnClientEvent" }> {
  const results: Array<{ name: string; kind: "OnServerEvent" | "OnClientEvent" }> = []

  const bindRe = /local\s+(\w+)\s*=\s*[^=\n]*?(?:WaitForChild|FindFirstChild)\s*\(\s*["']([^"']+)["']/g
  const varToRemote = new Map<string, string>()
  let m: RegExpExecArray | null
  while ((m = bindRe.exec(src)) !== null) {
    varToRemote.set(m[1], m[2])
  }

  for (const [varName, remoteName] of varToRemote) {
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (new RegExp(`${escaped}\\s*\\.\\s*OnServerEvent`).test(src))
      results.push({ name: remoteName, kind: "OnServerEvent" })
    if (new RegExp(`${escaped}\\s*\\.\\s*OnClientEvent`).test(src))
      results.push({ name: remoteName, kind: "OnClientEvent" })
  }

  return results
}

function extractRequires(src: string): string[] {
  const names: string[] = []
  const re = /require\s*\(\s*[^)]+?\b(\w+)\s*\)/g
  const skip = new Set(["ReplicatedStorage", "ServerScriptService", "StarterPlayer",
    "StarterPlayerScripts", "Workspace", "Players", "RunService", "game", "script"])
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    if (!skip.has(m[1])) names.push(m[1])
  }
  return [...new Set(names)]
}

// ── Main Analyzer ─────────────────────────────────────────────────────────────

export function analyzeCrossScript(projectPath: string): CrossScriptResult {
  const srcDir = join(projectPath, "src")
  const allFiles = walkLuau(srcDir)
  const scripts: ScriptAnalysis[] = []
  const remoteLinkMap = new Map<string, RemoteLink>()

  for (const absPath of allFiles) {
    const relPath = relative(projectPath, absPath).replace(/\\/g, "/")
    let src: string
    try { src = readFileSync(absPath, "utf-8") } catch { continue }

    const kind = classifyPath(relPath)
    const services = extractServices(src)
    const fires = extractRemoteFires(src)
    const handlers = extractRemoteHandlers(src)
    const requires = extractRequires(src)

    scripts.push({
      path: absPath,
      relPath,
      kind,
      services,
      remotesFired: fires.map((f) => f.name),
      remotesHandled: handlers.map((h) => h.name),
      requires
    })

    // RemoteLink 집계
    for (const fire of fires) {
      if (!remoteLinkMap.has(fire.name)) {
        remoteLinkMap.set(fire.name, { remoteName: fire.name, fireScripts: [], handleScripts: [] })
      }
      remoteLinkMap.get(fire.name)!.fireScripts.push({ path: relPath, kind: fire.kind })
    }
    for (const handler of handlers) {
      if (!remoteLinkMap.has(handler.name)) {
        remoteLinkMap.set(handler.name, { remoteName: handler.name, fireScripts: [], handleScripts: [] })
      }
      remoteLinkMap.get(handler.name)!.handleScripts.push({ path: relPath, kind: handler.kind })
    }
  }

  return {
    scripts,
    remoteLinks: [...remoteLinkMap.values()]
  }
}
