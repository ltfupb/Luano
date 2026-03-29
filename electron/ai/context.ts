import { readFile, readdir, stat, access } from "fs/promises"
import { readFileSync, existsSync } from "fs"
import { join, relative, extname } from "path"
import { searchDocs, formatDocsForPrompt } from "./rag"

export interface ProjectContext {
  globalSummary: string
  currentFile?: string
  currentFileContent?: string
  diagnostics?: string
  docsContext?: string // RAG 결과 (Phase 2)
  bridgeContext?: string // Live Studio bridge state (Phase 4)
}

// 모듈 export 시그니처 추출 (정규식 기반)
function extractExports(content: string): string[] {
  const exports: string[] = []

  // function M.FuncName(...) 패턴
  const methodPattern = /function\s+\w+\.(\w+)\s*\(([^)]*)\)/g
  let match
  while ((match = methodPattern.exec(content)) !== null) {
    exports.push(`${match[1]}(${match[2].trim()})`)
  }

  // local function FuncName(...) 패턴
  const localFnPattern = /local\s+function\s+(\w+)\s*\(([^)]*)\)/g
  while ((match = localFnPattern.exec(content)) !== null) {
    exports.push(`${match[1]}(${match[2].trim()})`)
  }

  return exports.slice(0, 10)
}

// Rojo 프로젝트 구조 파싱 (동기 — 빌드 시 한 번만 호출)
function parseRojoProject(projectPath: string): Record<string, string> {
  const projectFile = join(projectPath, "default.project.json")
  if (!existsSync(projectFile)) return {}

  try {
    const proj = JSON.parse(readFileSync(projectFile, "utf-8"))
    const structure: Record<string, string> = {}

    function parseTree(tree: Record<string, unknown>, path: string): void {
      for (const [key, value] of Object.entries(tree)) {
        if (key.startsWith("$")) continue
        const fullPath = path ? `${path}/${key}` : key
        if (typeof value === "object" && value !== null) {
          const v = value as Record<string, unknown>
          if (v["$path"]) {
            structure[String(v["$path"])] = fullPath
          }
          parseTree(v, fullPath)
        }
      }
    }

    parseTree(proj.tree || {}, "")
    return structure
  } catch {
    return {}
  }
}

// 모든 Luau 파일 비동기 스캔 + 시그니처 추출
async function scanModules(projectPath: string): Promise<string> {
  const modules: string[] = []

  async function walk(dir: string): Promise<void> {
    try {
      await access(dir)
    } catch {
      return
    }
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(dir, entry)
        try {
          const s = await stat(fullPath)
          if (s.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
            await walk(fullPath)
          } else if (s.isFile() && (extname(entry) === ".lua" || extname(entry) === ".luau")) {
            try {
              const content = await readFile(fullPath, "utf-8")
              const relPath = relative(projectPath, fullPath)
              const exports = extractExports(content)
              if (exports.length > 0) {
                modules.push(`  ${relPath}: ${exports.join(", ")}`)
              }
            } catch { /* 읽기 실패 시 skip */ }
          }
        } catch { /* stat 실패 시 skip */ }
      })
    )
  }

  await walk(join(projectPath, "src"))
  return modules.slice(0, 30).join("\n")
}

export async function buildGlobalSummary(projectPath: string): Promise<string> {
  const structure = parseRojoProject(projectPath)
  const modules = await scanModules(projectPath)

  const structureLines = Object.entries(structure)
    .map(([path, robloxPath]) => `  ${path} → ${robloxPath}`)
    .join("\n")

  return `PROJECT: ${projectPath.split(/[/\\]/).pop()} (Rojo)
STRUCTURE:
${structureLines || "  (default.project.json not found)"}
MODULES:
${modules || "  (no modules found)"}`
}

// RAG: 유저 메시지에서 키워드 추출해 문서 검색
export function buildDocsContext(userMessage: string): string {
  const chunks = searchDocs(userMessage, 3)
  return formatDocsForPrompt(chunks)
}

export function buildSystemPrompt(context: ProjectContext): string {
  const docsSection = context.docsContext
    ? `\nROBLOX DOCUMENTATION:\n${context.docsContext}\n`
    : ""

  const bridgeSection = context.bridgeContext
    ? `\nSTUDIO LIVE BRIDGE:\n${context.bridgeContext}\n`
    : ""

  return `You are Luano, an expert-level Roblox game development AI. You have deep knowledge of Luau, the Roblox engine, and production game architecture patterns.

CODE STYLE:
- --!strict mode for all new files
- StyLua formatting: tabs, 120 columns, double quotes
- Selene roblox standard lint rules
- Type annotations on all function signatures

ROBLOX ARCHITECTURE:
- Client-server boundary is strict. Server = authority, client = presentation.
- Never trust client input. Always validate type, range, and permissions on server.
- RemoteEvents for fire-and-forget. RemoteFunctions only when server→client response is needed. Never expose RemoteFunctions to client→server (exploitable).
- Rate-limit all client→server remotes (os.clock() per-player tracking).
- Use ModuleScripts in ReplicatedStorage for shared types/utils, ServerScriptService for server modules.
- Single-script architecture > many scripts. Use one main server Script + modules.

PERFORMANCE:
- Cache GetService/FindFirstChild/GetChildren results — never call repeatedly in loops.
- Use task.spawn/task.defer/task.delay — never raw coroutines, spawn(), delay(), or wait().
- Avoid Instance.new() in loops — use object pooling or template:Clone().
- Use CollectionService tags for bulk instance management instead of iterating workspace.
- Disconnect all RBXScriptConnections when no longer needed. Store connections and call :Disconnect().
- Use table.create() for pre-allocated arrays. Use buffer for binary data.
- Minimize remote traffic: batch updates, send deltas not full state.

DATA:
- Always pcall DataStore operations. GetAsync/SetAsync/UpdateAsync all can fail.
- Use UpdateAsync for atomic read-modify-write (not GetAsync→SetAsync which races).
- Implement session locking: load on PlayerAdded, save on PlayerRemoving + BindToClose.
- BindToClose must save ALL player data with a timeout — the server shuts down in 30s.
- Schema-version your saved data. Add a _version field and migrate on load.

SECURITY:
- Never use loadstring() — disabled in Roblox and a security red flag.
- Never put secrets (API keys, admin lists) in client-accessible locations.
- Sanity-check all remote arguments: typeof() check, range clamp, string length limit.
- Use Enum comparisons, not string matching, for security-critical checks.
- Don't replicate server-side state to clients unless they need it.

NETWORKING PATTERNS:
- FireAllClients() for broadcast (chat, game state). FireClient() for targeted updates.
- Unreliable RemoteEvents for frequent, loss-tolerant data (cursor position, camera).
- Throttle client→server remotes to max 10-20 per second per player.

UI:
- Always use ScreenGui with ResetOnSpawn = false for persistent UI.
- Use UDim2.fromScale() for responsive layout, UDim2.fromOffset() for pixel-precise.
- AnchorPoint + Position for centering. UIListLayout/UIGridLayout for dynamic lists.
- Tween UI with TweenService, not manual property updates.

COMMON SERVICES:
- Players, ReplicatedStorage, ServerScriptService, Workspace — always GetService().
- RunService.Heartbeat for game loops (server), RenderStepped for camera/visual (client only).
- UserInputService + ContextActionService for input. Prefer ContextActionService for game actions.
- TweenService for animations, Debris for timed cleanup.
- CollectionService for tag-based systems. Use over manual tracking tables.
- HttpService for JSON encode/decode. MarketplaceService for purchases.

ANTI-PATTERNS TO AVOID:
- while true do wait() end → use RunService.Heartbeat or task.wait() with purpose.
- pairs()/ipairs() → just "for k, v in table do" (Luau optimization).
- string.format for simple concat → use string interpolation \`value is {value}\`.
- Nested WaitForChild chains in loops → cache references once at script start.
- Global variables → always use local. Module-scoped state for shared mutable state.

WHEN WRITING CODE:
1. Always include type annotations.
2. Validate inputs at system boundaries (remotes, user input).
3. Handle errors with pcall where external calls can fail.
4. Add brief comments only where the logic is non-obvious.
5. Prefer functional patterns: map/filter with table.create + loops.

PROJECT CONTEXT:
${context.globalSummary}

CURRENT FILE: ${context.currentFile ?? "none"}
${context.currentFileContent ? `\`\`\`luau\n${context.currentFileContent}\n\`\`\`` : ""}

${context.diagnostics ? `CURRENT DIAGNOSTICS:\n${context.diagnostics}` : ""}${docsSection}${bridgeSection}`
}
