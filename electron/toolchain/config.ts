/**
 * electron/toolchain/config.ts — Toolchain configuration management
 *
 * Resolution order: project .luano/toolchain.json > global store defaults > bundled defaults
 */

import { join } from "path"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { store } from "../store"
import { type ToolCategory, getDefaultToolId, TOOL_REGISTRY } from "./registry"
import { isBinaryAvailable } from "../sidecar"

/** Check if the minimum toolchain (luau-lsp) is installed and ready */
export function isMinimumToolchainReady(): boolean {
  return isBinaryAvailable("luau-lsp")
}

/** Check if a project has a .luano/toolchain.json file */
export function hasProjectConfig(projectPath: string): boolean {
  return existsSync(join(projectPath, ".luano", "toolchain.json"))
}

/**
 * Write a baseline .luano/toolchain.json for a project using current resolved defaults.
 * No-op if the file already exists. Marks the project as "configured" so it won't
 * prompt the setup panel again.
 */
export function initProjectConfig(projectPath: string): void {
  if (hasProjectConfig(projectPath)) return
  const config: ProjectToolchain = {}
  const cats: ToolCategory[] = ["sync", "linter", "formatter", "lsp"]
  for (const cat of cats) {
    const tool = getActiveTool(cat, projectPath)
    if (tool) config[cat] = tool
  }
  writeProjectConfig(projectPath, config)
}

interface ProjectToolchain {
  [category: string]: string
}

interface GlobalToolchainConfig {
  defaults: Partial<Record<ToolCategory, string>>
}

function readProjectConfig(projectPath: string): ProjectToolchain | null {
  const configPath = join(projectPath, ".luano", "toolchain.json")
  if (!existsSync(configPath)) return null
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as ProjectToolchain
  } catch {
    return null
  }
}

function writeProjectConfig(projectPath: string, config: ProjectToolchain): void {
  const dir = join(projectPath, ".luano")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "toolchain.json"), JSON.stringify(config, null, 2), "utf-8")
}

function getGlobalConfig(): GlobalToolchainConfig {
  return store.get<GlobalToolchainConfig>("toolchain") ?? { defaults: {} }
}

/** Get the active tool for a category, respecting project > global > bundled priority */
export function getActiveTool(category: ToolCategory, projectPath?: string): string | null {
  // 1. Project-level override
  if (projectPath) {
    const proj = readProjectConfig(projectPath)
    if (proj?.[category]) return proj[category]
  }

  // 2. Global default
  const global = getGlobalConfig()
  if (global.defaults[category]) return global.defaults[category]!

  // 3. Bundled default
  return getDefaultToolId(category)
}

/** Set the active tool for a specific project */
export function setProjectTool(projectPath: string, category: ToolCategory, toolId: string | null): void {
  const config = readProjectConfig(projectPath) ?? {}
  if (toolId === null) {
    delete config[category]
  } else {
    config[category] = toolId
  }
  writeProjectConfig(projectPath, config)
}

/** Set a global default tool for a category */
export function setGlobalDefault(category: ToolCategory, toolId: string | null): void {
  const config = getGlobalConfig()
  if (toolId === null) {
    delete config.defaults[category]
  } else {
    config.defaults[category] = toolId
  }
  store.set("toolchain", config)
}

/**
 * Get full toolchain config for a project (used by renderer).
 *
 * @param projectOnly - When true, selections reflect ONLY the project file's
 *   explicit contents (no fallback to global/bundled defaults). Used by the
 *   toolchain panel in normal mode so users see exactly what's persisted, not
 *   phantom pre-checks from bundled defaults.
 */
export function getToolchainConfig(projectPath?: string, projectOnly = false): {
  selections: Partial<Record<ToolCategory, string | null>>
  installed: Record<string, boolean>
} {
  const categories: ToolCategory[] = ["sync", "linter", "formatter", "lsp"]
  const selections: Partial<Record<ToolCategory, string | null>> = {}
  const installed: Record<string, boolean> = {}

  const proj = projectOnly && projectPath ? readProjectConfig(projectPath) : null

  for (const cat of categories) {
    if (projectOnly) {
      selections[cat] = proj?.[cat] ?? null
    } else {
      selections[cat] = getActiveTool(cat, projectPath)
    }
  }

  for (const tool of Object.values(TOOL_REGISTRY)) {
    installed[tool.id] = isBinaryAvailable(tool.binaryName)
  }

  return { selections, installed }
}
