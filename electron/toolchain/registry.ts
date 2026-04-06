/**
 * electron/toolchain/registry.ts — Tool definitions and metadata
 *
 * Single source of truth for all supported Roblox development tools.
 * Each tool has download URLs, version info, and category classification.
 */

export type ToolCategory = "sync" | "linter" | "formatter" | "lsp" | "package-manager" | "processor"

export interface ToolDefinition {
  id: string
  name: string
  description: string
  category: ToolCategory
  bundled: boolean
  version: string
  github: string
  binaryName: string
  configFiles?: string[]
  releaseUrls: {
    win: string
    mac: string
    linux: string
  }
}

function ghRelease(repo: string, version: string, file: string): string {
  return `https://github.com/${repo}/releases/download/${version}/${file}`
}

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  rojo: {
    id: "rojo",
    name: "Rojo",
    description: "File sync between filesystem and Roblox Studio",
    category: "sync",
    bundled: true,
    version: "7.6.1",
    github: "rojo-rbx/rojo",
    binaryName: "rojo",
    configFiles: ["default.project.json"],
    releaseUrls: {
      win:   ghRelease("rojo-rbx/rojo", "v7.6.1", "rojo-7.6.1-windows-x86_64.zip"),
      mac:   ghRelease("rojo-rbx/rojo", "v7.6.1", "rojo-7.6.1-macos-aarch64.zip"),
      linux: ghRelease("rojo-rbx/rojo", "v7.6.1", "rojo-7.6.1-linux-x86_64.zip")
    }
  },
  argon: {
    id: "argon",
    name: "Argon",
    description: "Full-featured Roblox sync tool with two-way sync",
    category: "sync",
    bundled: false,
    version: "2.0.22",
    github: "argon-rbx/argon",
    binaryName: "argon",
    configFiles: ["default.project.json"],
    releaseUrls: {
      win:   ghRelease("argon-rbx/argon", "2.0.22", "argon-2.0.22-windows-x86_64.zip"),
      mac:   ghRelease("argon-rbx/argon", "2.0.22", "argon-2.0.22-macos-aarch64.zip"),
      linux: ghRelease("argon-rbx/argon", "2.0.22", "argon-2.0.22-linux-x86_64.zip")
    }
  },
  selene: {
    id: "selene",
    name: "Selene",
    description: "A blazing-fast linter for Lua and Luau",
    category: "linter",
    bundled: true,
    version: "0.30.1",
    github: "Kampfkarren/selene",
    binaryName: "selene",
    configFiles: ["selene.toml"],
    releaseUrls: {
      win:   ghRelease("Kampfkarren/selene", "0.30.1", "selene-0.30.1-windows.zip"),
      mac:   ghRelease("Kampfkarren/selene", "0.30.1", "selene-0.30.1-macos.zip"),
      linux: ghRelease("Kampfkarren/selene", "0.30.1", "selene-0.30.1-linux.zip")
    }
  },
  stylua: {
    id: "stylua",
    name: "StyLua",
    description: "An opinionated Lua/Luau code formatter",
    category: "formatter",
    bundled: true,
    version: "2.4.0",
    github: "JohnnyMorganz/StyLua",
    binaryName: "stylua",
    configFiles: [".stylua.toml", "stylua.toml"],
    releaseUrls: {
      win:   ghRelease("JohnnyMorganz/StyLua", "v2.4.0", "stylua-windows-x86_64.zip"),
      mac:   ghRelease("JohnnyMorganz/StyLua", "v2.4.0", "stylua-macos-aarch64.zip"),
      linux: ghRelease("JohnnyMorganz/StyLua", "v2.4.0", "stylua-linux-x86_64.zip")
    }
  },
  "luau-lsp": {
    id: "luau-lsp",
    name: "luau-lsp",
    description: "Language server for Luau with autocomplete, diagnostics, and hover",
    category: "lsp",
    bundled: true,
    version: "1.64.0",
    github: "JohnnyMorganz/luau-lsp",
    binaryName: "luau-lsp",
    releaseUrls: {
      win:   ghRelease("JohnnyMorganz/luau-lsp", "1.64.0", "luau-lsp-win64.zip"),
      mac:   ghRelease("JohnnyMorganz/luau-lsp", "1.64.0", "luau-lsp-macos.zip"),
      linux: ghRelease("JohnnyMorganz/luau-lsp", "1.64.0", "luau-lsp-linux-x86_64.zip")
    }
  },
  wally: {
    id: "wally",
    name: "Wally",
    description: "Package manager for Roblox projects",
    category: "package-manager",
    bundled: false,
    version: "0.3.2",
    github: "UpliftGames/wally",
    binaryName: "wally",
    configFiles: ["wally.toml"],
    releaseUrls: {
      win:   ghRelease("UpliftGames/wally", "v0.3.2", "wally-v0.3.2-windows-x86_64.zip"),
      mac:   ghRelease("UpliftGames/wally", "v0.3.2", "wally-v0.3.2-macos-x86_64.zip"),
      linux: ghRelease("UpliftGames/wally", "v0.3.2", "wally-v0.3.2-linux-x86_64.zip")
    }
  },
  pesde: {
    id: "pesde",
    name: "Pesde",
    description: "Modern package manager for Luau with workspaces",
    category: "package-manager",
    bundled: false,
    version: "0.5.3",
    github: "pesde-pkg/pesde",
    binaryName: "pesde",
    configFiles: ["pesde.toml"],
    releaseUrls: {
      win:   ghRelease("pesde-pkg/pesde", "v0.5.3", "pesde-0.5.3-windows-x86_64.zip"),
      mac:   ghRelease("pesde-pkg/pesde", "v0.5.3", "pesde-0.5.3-macos-aarch64.zip"),
      linux: ghRelease("pesde-pkg/pesde", "v0.5.3", "pesde-0.5.3-linux-x86_64.zip")
    }
  },
  darklua: {
    id: "darklua",
    name: "Darklua",
    description: "Lua/Luau code transformer, minifier, and bundler",
    category: "processor",
    bundled: false,
    version: "0.15.1",
    github: "seaofvoices/darklua",
    binaryName: "darklua",
    configFiles: [".darklua.json", ".darklua.json5"],
    releaseUrls: {
      win:   ghRelease("seaofvoices/darklua", "v0.15.1", "darklua-windows-x86_64.zip"),
      mac:   ghRelease("seaofvoices/darklua", "v0.15.1", "darklua-macos-aarch64.zip"),
      linux: ghRelease("seaofvoices/darklua", "v0.15.1", "darklua-linux-x86_64.zip")
    }
  }
}

export const CATEGORIES: { id: ToolCategory; label: string; allowNone: boolean }[] = [
  { id: "sync",            label: "Sync",            allowNone: false },
  { id: "linter",          label: "Linter",          allowNone: false },
  { id: "formatter",       label: "Formatter",       allowNone: false },
  { id: "lsp",             label: "Language Server",  allowNone: false },
  { id: "package-manager", label: "Package Manager",  allowNone: true },
  { id: "processor",       label: "Code Processor",   allowNone: true }
]

export function getToolsForCategory(category: ToolCategory): ToolDefinition[] {
  return Object.values(TOOL_REGISTRY).filter(t => t.category === category)
}

export function getDefaultToolId(category: ToolCategory): string | null {
  const bundled = Object.values(TOOL_REGISTRY).find(t => t.category === category && t.bundled)
  return bundled?.id ?? null
}
