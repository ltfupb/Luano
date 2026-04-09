import { readFile, readdir, stat, access } from "fs/promises"
import { readFileSync, existsSync } from "fs"
import { join, relative, extname } from "path"
import { searchDocs, formatDocsForPrompt } from "./rag"
import { buildApiContext } from "./api-context"
import { analyzeTopology } from "../topology/analyzer"

export interface ProjectContext {
  globalSummary: string
  currentFile?: string
  currentFileContent?: string
  diagnostics?: string
  docsContext?: string // RAG 결과 (Phase 2)
  apiContext?: string // API Dump에서 추출한 서비스/클래스 정의
  bridgeContext?: string // Live Studio bridge state (Phase 4)
  attachedFiles?: Array<{ path: string; content: string }> // 사용자 첨부 파일
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
async function scanModules(projectPath: string, rojoStructure: Record<string, string>): Promise<string> {
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
          if (s.isDirectory() && !entry.startsWith(".") && entry !== "node_modules" && entry !== "Packages") {
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

  // Rojo 프로젝트 구조에서 스캔 대상 디렉토리 결정, 없으면 src/ 폴백
  const scanRoots = new Set<string>()
  for (const localPath of Object.keys(rojoStructure)) {
    const topDir = localPath.split(/[/\\]/)[0]
    if (topDir) scanRoots.add(join(projectPath, topDir))
  }
  if (scanRoots.size === 0) {
    scanRoots.add(join(projectPath, "src"))
  }

  for (const root of scanRoots) {
    await walk(root)
  }
  return modules.slice(0, 30).join("\n")
}

// 프로젝트 루트의 LUANO.md 읽기 (사용자 지시사항)
function readLuanoMd(projectPath: string): string {
  const mdPath = join(projectPath, "LUANO.md")
  if (!existsSync(mdPath)) return ""
  try {
    const content = readFileSync(mdPath, "utf-8").trim()
    return content.slice(0, 4000) // 토큰 제한
  } catch {
    return ""
  }
}

// Parse Rojo sourcemap.json → "file path → Roblox instance path" mapping
function parseSourcemap(projectPath: string): string {
  const smPath = join(projectPath, "sourcemap.json")
  if (!existsSync(smPath)) return ""
  try {
    const sm = JSON.parse(readFileSync(smPath, "utf-8"))
    const entries: string[] = []

    function walk(node: { name?: string; className?: string; filePaths?: string[]; children?: unknown[] }, path: string): void {
      const name = node.name ?? ""
      const fullPath = path ? `${path}.${name}` : name
      if (node.filePaths && node.filePaths.length > 0) {
        for (const fp of node.filePaths) {
          entries.push(`  ${fp} → ${fullPath}`)
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          walk(child as typeof node, fullPath)
        }
      }
    }

    walk(sm, "")
    return entries.slice(0, 40).join("\n")
  } catch {
    return ""
  }
}

export async function buildGlobalSummary(projectPath: string): Promise<string> {
  const structure = parseRojoProject(projectPath)
  const modules = await scanModules(projectPath, structure)
  const luanoMd = readLuanoMd(projectPath)

  const structureLines = Object.entries(structure)
    .map(([path, robloxPath]) => `  ${path} → ${robloxPath}`)
    .join("\n")

  const luanoSection = luanoMd
    ? `\nPROJECT INSTRUCTIONS (LUANO.md):\n${luanoMd}\n`
    : ""

  // Topology: dependency edges between scripts
  let depSection = ""
  try {
    const topology = analyzeTopology(projectPath)
    if (topology.edges.length > 0) {
      const depLines = topology.edges
        .slice(0, 20)
        .map((e) => `  ${e.source} → ${e.target} (${e.kind})`)
        .join("\n")
      depSection = `\nDEPENDENCIES:\n${depLines}\n`
    }
  } catch { /* topology analysis optional */ }

  // Sourcemap: file → Roblox instance mapping
  const instanceMap = parseSourcemap(projectPath)
  const instanceSection = instanceMap
    ? `\nINSTANCE MAP (sourcemap.json):\n${instanceMap}\n`
    : ""

  return `PROJECT: ${projectPath.split(/[/\\]/).pop()} (Rojo)
PROJECT PATH: ${projectPath}
STRUCTURE:
${structureLines || "  (default.project.json not found)"}
MODULES:
${modules || "  (no modules found)"}${depSection}${instanceSection}${luanoSection}`
}

// RAG: 유저 메시지에서 키워드 추출해 문서 검색
export function buildDocsContext(userMessage: string): string {
  const chunks = searchDocs(userMessage, 3)
  return formatDocsForPrompt(chunks)
}

// ── Prompt Modules (static sections — cached by Anthropic prefix matching) ──

/** Identity + critical rules — NEVER changes between requests */
function sectionIdentity(): string {
  return `You are Luano, an expert Roblox game development AI agent. You write production-quality Luau code and use tools to create, edit, and verify files directly.

CRITICAL RULES:
- When asked to create, modify, or fix code, you MUST use tool calls (create_file, edit_file, read_file, lint_file, etc.). NEVER just describe code in text.
- All file paths MUST be absolute. Combine PROJECT PATH + relative path.
  Example: PROJECT PATH "C:/Users/me/game" + "src/server/MyScript.server.lua" → "C:/Users/me/game/src/server/MyScript.server.lua"
- ALWAYS lint after creating or editing Luau files. The create/edit → lint → fix → lint cycle is mandatory. Never leave lint errors unfixed.`
}

/** Workflow + tool strategy — NEVER changes */
function sectionWorkflow(): string {
  return `
WORKFLOW:
You will first be asked to output a plan (no tools available). Then you will be told to execute with tools.
1. PLAN: Outline what files to create/modify in 2-3 bullets. Don't write code yet.
2. EXECUTE: Follow your plan. Use tools to create/edit files.
   - If the project has existing modules: read_file relevant code before editing.
   - If the project is empty (no modules): create files immediately. Do NOT search or list — there is nothing to find.
3. VERIFY: Run lint_file on every Luau file you created or edited. Fix any errors.
4. Summarize what you did in 1-2 sentences.

TOOL STRATEGY:
General principles:
- Try the simplest approach first. Don't overcomplicate.
- Never give up after one tool error — always attempt recovery.

Error recovery (apply to ALL tools):
- If a tool call fails, STOP and diagnose WHY before retrying. Read the error message carefully.
- Don't retry the identical action blindly — that wastes rounds. Change something based on the error.
- Don't abandon a viable approach after a single failure either. Investigate first, then decide.
- If the same error repeats twice, try a completely different approach.
- Escalate to the user only when you are genuinely stuck after investigation, not as a first response.

Per-tool guidance:
- read_file: Use BEFORE edit_file. You cannot write a correct edit without seeing current content. For large files, use start_line/end_line to read only the relevant section.
- edit_file: old_text must exactly match a unique substring in the file.
  → "Text not found": Use read_file to see actual content, then retry with correct old_text.
  → "matches N locations": Include more surrounding lines in old_text to disambiguate.
  → Never try to edit a file you haven't read in this conversation.
- create_file: If it fails, use list_files to verify the parent directory exists, then retry.
- grep_files: Use to find require() chains, function usages, and references before making cross-file changes. Search the project path.
- search_docs: Use when you need exact Roblox API details — method signatures, events, properties, enums. Don't guess API names or parameters; look them up.
- lint_file: Read the error message carefully. Fix the specific issue with edit_file — don't rewrite the entire file for one lint error.
- list_files: Use to understand directory structure before creating files in unfamiliar locations.
- delete_file: DANGEROUS — only use when the user explicitly asked to delete. Never delete files as part of a refactor unless instructed.

SCOPE DISCIPLINE:
- Do NOT add features, refactor code, or make "improvements" beyond what was asked.
- Do NOT add docstrings, comments, or type annotations to code you didn't change.
- Do NOT add error handling or validation for scenarios that can't happen. Only validate at system boundaries (remotes, user input, external APIs).
- Do NOT create helpers or abstractions for one-time operations. Three similar lines > a premature abstraction.
- Do NOT design for hypothetical future requirements.
- If fixing a bug, fix the bug. Don't refactor nearby code, add types, or "improve" error messages.

RESPONSE STYLE:
- Be extremely concise. After using tools, reply in 1-2 sentences max.
- Do NOT show the code you wrote in chat — the user sees it in the editor.
- Do NOT list what you're about to do before doing it. Just do it, then briefly say what you did.
- Do NOT explain obvious things. Only explain non-obvious design decisions.
- Do NOT give time estimates for any work.
- When referencing code locations, use "filename:line_number" format (e.g., "PlayerManager.lua:42") so the user can jump to it.`
}

/** Luau language standards + Roblox architecture — NEVER changes */
function sectionLuauStandards(): string {
  return `
ROJO FILE MAPPING:
STRUCTURE shows "local_path → RobloxService" from default.project.json.
Files inside that local folder appear DIRECTLY inside the Roblox service.
Example: "src/server → ServerScriptService" → src/server/Foo.server.lua = ServerScriptService.Foo
File extensions: .server.lua = Script, .client.lua = LocalScript, .lua/.luau = ModuleScript.

LUAU CODE STANDARDS:
CRITICAL: You write Luau, NOT TypeScript/JavaScript. Never use TS/JS syntax (const, let, =>, interface, class, etc.).
CRITICAL: Every line must be syntactically valid. Never write incomplete lines like bare "local " with nothing after it. Never write "local local". Always close every function/if/for block with "end".

Format & style:
- --!strict at the top of every new file
- Type annotations on function signatures (Luau syntax, NOT TypeScript):
  local function greet(name: string): string
  local function add(a: number, b: number): number
  local function fire(player: Player, data: {[string]: any}): ()
- StyLua: tabs, 120 columns, double quotes
- Always local — never global variables
- Comments only where logic is non-obvious

Modern Luau idioms:
- "for k, v in table do" (not pairs()/ipairs())
- String interpolation \`value is {value}\` (not string.format for simple concat)
- task.spawn/task.defer/task.delay (never coroutine.wrap, spawn(), delay(), or wait())
- table.create() for pre-allocated arrays, buffer for binary data
- Cache service/instance references once at script top, not inside loops
- Roblox globals (game, workspace, Instance, Enum, etc.) are always available — no imports needed
- String concat uses ".." (not "+")

EXAMPLE — typical server script (leaderstats):
--!strict
local Players = game:GetService("Players")

local function onPlayerAdded(player: Player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	leaderstats.Parent = player

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 0
	coins.Parent = leaderstats
end

Players.PlayerAdded:Connect(onPlayerAdded)
-- END EXAMPLE

Validation & error handling:
- pcall all external calls that can fail (DataStore, HTTP, MarketplaceService)
- Validate at system boundaries only: remote arguments (typeof, range clamp, string length), user input
- Don't add pcall/validation for internal module calls that won't fail

ROBLOX ARCHITECTURE:
Client-Server:
- Server = authority, client = presentation. Never trust client input.
- RemoteEvents for fire-and-forget. RemoteFunctions only server→client (never client→server — exploitable).
- Rate-limit all client→server remotes: os.clock() per-player tracking, max 10-20/sec.
- Single-script architecture preferred: one main server Script + ModuleScripts.
- ReplicatedStorage for shared types/utils, ServerScriptService for server modules.

Character handling:
- ALWAYS use CharacterAdded:Connect (not :Wait()) to handle respawns.
- Pattern: PlayerAdded → CharacterAdded:Connect → setup Humanoid events inside.
- Humanoid events (Died, StateChanged, Jump, etc.) break on respawn — re-connect every time.
- Example:
  Players.PlayerAdded:Connect(function(player)
    player.CharacterAdded:Connect(function(character)
      local humanoid = character:WaitForChild("Humanoid")
      -- connect events here, they auto-reconnect on each respawn
    end)
  end)

Data:
- Always pcall DataStore operations (GetAsync/SetAsync/UpdateAsync can all fail).
- UpdateAsync for atomic read-modify-write (not GetAsync→SetAsync which races).
- Session locking: load on PlayerAdded, save on PlayerRemoving + BindToClose.
- BindToClose must save ALL player data with timeout — server shuts down in 30s.
- Schema-version saved data: _version field, migrate on load.

Networking:
- FireAllClients() for broadcast, FireClient() for targeted.
- UnreliableRemoteEvents for frequent loss-tolerant data (cursor, camera).
- Batch updates, send deltas not full state.

Performance:
- Cache GetService/FindFirstChild — never call in loops.
- Avoid Instance.new() in loops — use object pooling or template:Clone().
- CollectionService tags for bulk instance management (not workspace iteration).
- Disconnect RBXScriptConnections when done. Store connections, call :Disconnect().
- RunService.Heartbeat for game loops (server), RenderStepped for visuals (client only).

UI:
- ScreenGui with ResetOnSpawn = false for persistent UI.
- UDim2.fromScale() for responsive, UDim2.fromOffset() for pixel-precise.
- TweenService for animations (not manual property updates).

Security:
- Never loadstring(). Never put secrets in client-accessible locations.
- typeof() + range clamp + string length limit on all remote arguments.
- Don't replicate server-side state to clients unless necessary.`
}

/**
 * Cached static prefix — identical across ALL requests.
 * Anthropic prompt caching matches byte-identical prefixes,
 * so this MUST NOT contain any dynamic content.
 */
let _staticPrefix: string | null = null
function getStaticPrefix(): string {
  if (!_staticPrefix) {
    _staticPrefix = sectionIdentity() + sectionWorkflow() + sectionLuauStandards()
  }
  return _staticPrefix
}

// ── Dynamic sections (change per request — appended AFTER cached prefix) ────

function sectionStudio(context: ProjectContext): string {
  if (!context.bridgeContext) {
    return "\nNOTE: Studio Bridge is not connected. Tools read_instance_tree, get_runtime_logs, run_studio_script, set_property are unavailable this session.\n"
  }
  return `
STUDIO TESTING (bridge connected):
After creating/editing game logic, validate automatically:
1. run_studio_script — execute a quick sanity check.
2. get_runtime_logs — check for errors.
3. If errors found, fix with edit_file and retest.
Do not ask permission to test — just do it.
`
}

function sectionDynamicContext(context: ProjectContext): string {
  const parts: string[] = []

  parts.push(`\nPROJECT CONTEXT:\n${context.globalSummary}`)
  parts.push(`\nCURRENT FILE: ${context.currentFile ?? "none"}`)

  if (context.currentFileContent) {
    parts.push(`\`\`\`luau\n${context.currentFileContent}\n\`\`\``)
  }

  if (context.diagnostics) {
    parts.push(`\nCURRENT DIAGNOSTICS:\n${context.diagnostics}`)
  }

  // API reference
  if (context.apiContext) {
    parts.push(`\nAPI REFERENCE (from current file):\n${context.apiContext}`)
  } else if (context.currentFileContent) {
    const apiCtx = buildApiContext(context.currentFileContent)
    if (apiCtx) parts.push(`\nAPI REFERENCE (from current file):\n${apiCtx}`)
  }

  // RAG docs
  if (context.docsContext) {
    parts.push(`\nROBLOX DOCUMENTATION:\n${context.docsContext}`)
  }

  // Studio bridge state
  if (context.bridgeContext) {
    parts.push(`\nSTUDIO LIVE BRIDGE:\n${context.bridgeContext}`)
  }

  // Attached files
  if (context.attachedFiles?.length) {
    parts.push(`\nATTACHED FILES:\n${context.attachedFiles.map((f) => `--- ${f.path} ---\n\`\`\`luau\n${f.content}\n\`\`\``).join("\n\n")}`)
  }

  return parts.join("\n")
}

/**
 * Build the full system prompt.
 *
 * Cache-break prevention: the static prefix (identity + workflow + Luau standards)
 * is always byte-identical and comes first. Dynamic sections (studio, project context,
 * current file) are appended after. This ensures Anthropic prompt caching hits on the
 * ~3K token prefix every time.
 */
export function buildSystemPrompt(context: ProjectContext): string {
  return getStaticPrefix() + sectionStudio(context) + sectionDynamicContext(context)
}
