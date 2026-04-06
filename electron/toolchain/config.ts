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

/** Get full toolchain config for a project (used by renderer) */
export function getToolchainConfig(projectPath?: string): {
  selections: Partial<Record<ToolCategory, string | null>>
  installed: Record<string, boolean>
} {
  const categories: ToolCategory[] = ["sync", "linter", "formatter", "lsp", "package-manager", "processor"]
  const selections: Partial<Record<ToolCategory, string | null>> = {}
  const installed: Record<string, boolean> = {}

  for (const cat of categories) {
    selections[cat] = getActiveTool(cat, projectPath)
  }

  for (const tool of Object.values(TOOL_REGISTRY)) {
    installed[tool.id] = tool.bundled || isBinaryAvailable(tool.binaryName)
  }

  return { selections, installed }
}
