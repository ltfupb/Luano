/**
 * electron/toolchain/registry.ts — Tool definitions and metadata
 *
 * Single source of truth for all supported Roblox development tools.
 * Each tool has download URLs, version info, and category classification.
 */

export type ToolCategory = "sync" | "linter" | "formatter" | "lsp"

export interface ToolDefinition {
  id: string
  name: string
  description: string
  category: ToolCategory
  recommended: boolean
  version: string
  github: string
  binaryName: string
  configFiles?: string[]
  /** Keywords to match GitHub release assets per platform */
  assetKeywords: {
    win: string[]
    mac: string[]
    linux: string[]
  }
  releaseUrls: {
    win: string
    mac: string
    linux: string
  }
  /**
   * SHA256 of the downloaded archive, per platform. Populated from the
   * official GitHub release at bundle time. The downloader refuses to
   * install an archive whose hash doesn't match — this is the fence
   * against CDN takeover / compromised release tooling.
   *
   * Only the pinned version in this registry is verified; `checkToolUpdates`
   * pulls newer versions by asset-keyword match and currently runs without
   * hash verification (see downloader.ts `downloadFromUrl`).
   */
  sha256?: {
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
    recommended: false,
    version: "7.6.1",
    github: "rojo-rbx/rojo",
    binaryName: "rojo",
    configFiles: ["default.project.json"],
    assetKeywords: {
      win:   ["windows", "x86_64"],
      mac:   ["macos"],
      linux: ["linux", "x86_64"]
    },
    releaseUrls: {
      win:   ghRelease("rojo-rbx/rojo", "v7.6.1", "rojo-7.6.1-windows-x86_64.zip"),
      mac:   ghRelease("rojo-rbx/rojo", "v7.6.1", "rojo-7.6.1-macos-aarch64.zip"),
      linux: ghRelease("rojo-rbx/rojo", "v7.6.1", "rojo-7.6.1-linux-x86_64.zip")
    },
    sha256: {
      win:   "e1c9a78193c609720f3afb38057d3909ed483ecbf5e9e3541313ba0dcbc4f1f8",
      mac:   "0755a2cb8a0d8a49d05f9253aba8dd3858fd3474896193bca5a2ffa96c570047",
      linux: "a9542a713036897fdbd0173e7a105ea409658333133c949025fcb6f1a7ca909d"
    }
  },
  argon: {
    id: "argon",
    name: "Argon",
    description: "Full-featured Roblox sync tool with two-way sync",
    category: "sync",
    recommended: true,
    version: "2.0.28",
    github: "argon-rbx/argon",
    binaryName: "argon",
    configFiles: ["default.project.json"],
    assetKeywords: {
      win:   ["windows", "x86_64"],
      mac:   ["macos"],
      linux: ["linux", "x86_64"]
    },
    releaseUrls: {
      win:   ghRelease("argon-rbx/argon", "2.0.28", "argon-2.0.28-windows-x86_64.zip"),
      mac:   ghRelease("argon-rbx/argon", "2.0.28", "argon-2.0.28-macos-aarch64.zip"),
      linux: ghRelease("argon-rbx/argon", "2.0.28", "argon-2.0.28-linux-x86_64.zip")
    },
    sha256: {
      win:   "82ca42dca24317dd113b143892f181696143959bbc4e5504acc7f23776d71e5a",
      mac:   "6623404d7af7bbff9d5747bb4cdd4a8215e20a9e970597061022d1de14722a93",
      linux: "1ea56c535fd7278acfd7e29c9fd82d50ada2f6f2b8a82c6b03b73a8127a8b2a9"
    }
  },
  selene: {
    id: "selene",
    name: "Selene",
    description: "A blazing-fast linter for Lua and Luau",
    category: "linter",
    recommended: true,
    version: "0.30.1",
    github: "Kampfkarren/selene",
    binaryName: "selene",
    configFiles: ["selene.toml"],
    assetKeywords: {
      win:   ["windows"],
      mac:   ["macos"],
      linux: ["linux"]
    },
    releaseUrls: {
      win:   ghRelease("Kampfkarren/selene", "0.30.1", "selene-0.30.1-windows.zip"),
      mac:   ghRelease("Kampfkarren/selene", "0.30.1", "selene-0.30.1-macos.zip"),
      linux: ghRelease("Kampfkarren/selene", "0.30.1", "selene-0.30.1-linux.zip")
    },
    sha256: {
      win:   "b55a8592ba6ffd54c88edd3396348e43d581494c2c255cd2d02c8c26b96080f4",
      mac:   "4858f5f732491680d361744977d7ef3e30c09f1bd454cb6e1e337c9c58fbbd94",
      linux: "c8c0f2102cb37e5e3ee2c984b51946b8ea8cf7804b5ea067afdb42fd2b95ff6e"
    }
  },
  stylua: {
    id: "stylua",
    name: "StyLua",
    description: "An opinionated Lua/Luau code formatter",
    category: "formatter",
    recommended: true,
    version: "2.4.0",
    github: "JohnnyMorganz/StyLua",
    binaryName: "stylua",
    configFiles: [".stylua.toml", "stylua.toml"],
    assetKeywords: {
      win:   ["windows", "x86_64"],
      mac:   ["macos"],
      linux: ["linux", "x86_64"]
    },
    releaseUrls: {
      win:   ghRelease("JohnnyMorganz/StyLua", "v2.4.0", "stylua-windows-x86_64.zip"),
      mac:   ghRelease("JohnnyMorganz/StyLua", "v2.4.0", "stylua-macos-aarch64.zip"),
      linux: ghRelease("JohnnyMorganz/StyLua", "v2.4.0", "stylua-linux-x86_64.zip")
    },
    sha256: {
      win:   "3803853280cb524560c6ce0d4140f6d9f02e03f55e1ce50bb4f5e51e07565794",
      mac:   "ec74ecdc30ec15aefa15f65cc55d6f10f91f97dd30c39c4347954af849e3f248",
      linux: "f9c84c210712061cb03ab8354a34a5d4f5fcf1f369d2ce916bea3ab9f7addac8"
    }
  },
  "luau-lsp": {
    id: "luau-lsp",
    name: "luau-lsp",
    description: "Language server for Luau with autocomplete, diagnostics, and hover",
    category: "lsp",
    recommended: true,
    version: "1.64.0",
    github: "JohnnyMorganz/luau-lsp",
    binaryName: "luau-lsp",
    assetKeywords: {
      win:   ["win64"],
      mac:   ["macos"],
      linux: ["linux", "x86_64"]
    },
    releaseUrls: {
      win:   ghRelease("JohnnyMorganz/luau-lsp", "1.64.0", "luau-lsp-win64.zip"),
      mac:   ghRelease("JohnnyMorganz/luau-lsp", "1.64.0", "luau-lsp-macos.zip"),
      linux: ghRelease("JohnnyMorganz/luau-lsp", "1.64.0", "luau-lsp-linux-x86_64.zip")
    },
    sha256: {
      win:   "3c08c31c3e1e546172919ff9c321c9a066fb96d37bc3872423055c8b45a3de7f",
      mac:   "df2a913f8c101683d56d802461ab2ac77c98cab6b03644d04506b6a78cec23ad",
      linux: "6cf618104dbe5a6d7c30784f7136ccb9d912cb1ca4942013df81d9ab9bd18921"
    }
  }
}

export const CATEGORIES: { id: ToolCategory; label: string; allowNone: boolean }[] = [
  // Required — app needs these to function (editor + Studio sync)
  { id: "lsp",             label: "Language Server",  allowNone: false },
  { id: "sync",            label: "Sync",             allowNone: false },
  // Optional — quality-of-life tools
  { id: "linter",          label: "Linter",           allowNone: true  },
  { id: "formatter",       label: "Formatter",        allowNone: true  }
]

export function getToolsForCategory(category: ToolCategory): ToolDefinition[] {
  return Object.values(TOOL_REGISTRY).filter(t => t.category === category)
}

export function getRecommendedToolIds(): string[] {
  return Object.values(TOOL_REGISTRY).filter(t => t.recommended).map(t => t.id)
}

export function getDefaultToolId(category: ToolCategory): string | null {
  const recommended = Object.values(TOOL_REGISTRY).find(t => t.category === category && t.recommended)
  return recommended?.id ?? null
}
