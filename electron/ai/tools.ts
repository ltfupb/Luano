import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs"
import { dirname, relative, join } from "path"
import { validatePath } from "../file/sandbox"
import { searchDocs } from "./rag"
import { lintFile as seleneCheck } from "../sidecar/selene"
import {
  getBridgeTree,
  getBridgeLogs,
  isBridgeConnected,
  queueScript,
  getCommandResult,
  type InstanceNode
} from "../bridge/server"
import type Anthropic from "@anthropic-ai/sdk"

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read the content of a file. Optionally specify line range for large files.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        start_line: { type: "number", description: "Start line number (1-based, optional)" },
        end_line: { type: "number", description: "End line number (inclusive, optional)" }
      },
      required: ["path"]
    }
  },
  {
    name: "edit_file",
    description:
      "Replace an exact string in a file with new content. old_text must be unique in the file.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        old_text: { type: "string", description: "Exact string to find (must be unique in file)" },
        new_text: { type: "string", description: "Replacement string" }
      },
      required: ["path", "old_text", "new_text"]
    }
  },
  {
    name: "create_file",
    description: "Create a new Luau file with the given content",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path for the new file" },
        content: { type: "string", description: "Complete file content" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "search_docs",
    description:
      "Search Roblox API documentation for classes, methods, events, and concepts",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search term (e.g. 'TweenService', 'Humanoid.Died', 'RemoteEvent')"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "read_instance_tree",
    description:
      "Read the current Roblox Studio DataModel instance tree. Returns the live hierarchy of services and instances. Only usable when the Studio plugin is connected.",
    input_schema: {
      type: "object" as const,
      properties: {
        max_depth: {
          type: "number",
          description: "How many levels deep to traverse (default 4, max 8)"
        }
      },
      required: []
    }
  },
  {
    name: "get_runtime_logs",
    description:
      "Get recent Roblox Studio console output, warnings, and errors. Only usable when the Studio plugin is connected.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Max number of recent entries to return (default 50)"
        },
        kind: {
          type: "string",
          description: "Filter by kind: 'output', 'warn', 'error', or 'all' (default 'all')"
        }
      },
      required: []
    }
  },
  {
    name: "run_studio_script",
    description:
      "Execute a Luau script in the live Roblox Studio session and return its output. Use print() to return values. Useful for inspecting runtime state, testing logic, or mutating instances. Only usable when the Studio plugin is connected.",
    input_schema: {
      type: "object" as const,
      properties: {
        code: {
          type: "string",
          description: "Luau code to run in Studio (runs in plugin context — use print() to surface values)"
        }
      },
      required: ["code"]
    }
  },
  {
    name: "set_property",
    description:
      "Set a property on a live Roblox Studio instance. Path is dot-separated from game root (e.g. 'Workspace.MyPart'). Value is a Luau expression. Only usable when the Studio plugin is connected.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Dot-separated path from game root, e.g. 'Workspace.MyPart' or 'ServerScriptService.MyScript'"
        },
        property: {
          type: "string",
          description: "Property name to set, e.g. 'Anchored', 'BrickColor', 'Position'"
        },
        value: {
          type: "string",
          description: "Luau expression for the value, e.g. 'true', '42', 'BrickColor.new(\"Bright red\")', 'Vector3.new(0,10,0)'"
        }
      },
      required: ["path", "property", "value"]
    }
  },
  {
    name: "list_files",
    description:
      "List files and directories at the given path. Use to explore and understand project structure before making changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the directory" },
        recursive: {
          type: "boolean",
          description: "List recursively up to 3 levels deep (default: false)"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "grep_files",
    description:
      "Search for a text pattern across project files. Returns matching lines with file paths and line numbers. Useful for finding usages, references, or patterns.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Text pattern to search for (literal string match)"
        },
        path: {
          type: "string",
          description: "Absolute path to the directory to search in"
        },
        file_pattern: {
          type: "string",
          description:
            "Comma-separated file extensions to search, e.g. '.lua,.luau,.json' (default: '.lua,.luau')"
        }
      },
      required: ["pattern", "path"]
    }
  },
  {
    name: "delete_file",
    description: "Delete a file from the project",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the file to delete" }
      },
      required: ["path"]
    }
  },
  {
    name: "lint_file",
    description: "Run Selene linter on a Luau file and return diagnostics. Use this after creating or editing a .lua/.luau file to verify code quality.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the .lua/.luau file" }
      },
      required: ["path"]
    }
  }
]

export interface ToolResult {
  success: boolean
  output: string
  filePath?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeTree(node: InstanceNode, depth: number, maxDepth: number): string {
  const indent = "  ".repeat(depth)
  let out = `${indent}${node.name} [${node.class}]\n`
  if (depth < maxDepth && node.children && node.children.length > 0) {
    const shown = node.children.slice(0, 25)
    for (const child of shown) {
      out += serializeTree(child, depth + 1, maxDepth)
    }
    if (node.children.length > 25) {
      out += `${indent}  … (${node.children.length - 25} more children)\n`
    }
  }
  return out
}

async function pollCommandResult(id: string, attempts = 20, intervalMs = 500): Promise<ToolResult> {
  for (let i = 0; i < attempts; i++) {
    await new Promise<void>((r) => setTimeout(r, intervalMs))
    const res = getCommandResult(id)
    if (res) {
      return {
        success: res.success,
        output: res.result || (res.success ? "(no output)" : "Execution failed with no message")
      }
    }
  }
  return { success: false, output: `Timed out waiting for Studio response (${(attempts * intervalMs) / 1000}s)` }
}

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  projectRoot?: string
): Promise<ToolResult> {
  try {
    // Path traversal protection: validate file paths stay within project
    const FILE_PATH_TOOLS = new Set(["read_file", "edit_file", "create_file", "delete_file", "lint_file"])
    if (projectRoot && FILE_PATH_TOOLS.has(name) && input.path) {
      try {
        input.path = validatePath(String(input.path), projectRoot)
      } catch (e) {
        return { success: false, output: String((e as Error).message) }
      }
    }
    switch (name) {
      // ── File tools ──────────────────────────────────────────────────────────
      case "read_file": {
        const path = String(input.path ?? "")
        if (!existsSync(path)) return { success: false, output: `File not found: ${path}` }
        const content = readFileSync(path, "utf-8")
        const startLine = Number(input.start_line) || 0
        const endLine = Number(input.end_line) || 0
        if (startLine > 0 || endLine > 0) {
          const lines = content.split("\n")
          const start = Math.max(0, startLine - 1)
          const end = endLine > 0 ? Math.min(lines.length, endLine) : lines.length
          return {
            success: true,
            output: lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n")
          }
        }
        return { success: true, output: content }
      }

      case "edit_file": {
        const path = String(input.path ?? "")
        const oldText = String(input.old_text ?? "")
        const newText = String(input.new_text ?? "")
        if (!existsSync(path)) return { success: false, output: `File not found: ${path}` }
        const current = readFileSync(path, "utf-8")
        const occurrences = current.split(oldText).length - 1
        if (occurrences === 0) {
          return { success: false, output: "Text not found in file — cannot apply edit" }
        }
        if (occurrences > 1) {
          return {
            success: false,
            output: `old_text matches ${occurrences} locations in the file. Include more surrounding context to make it unique.`
          }
        }
        writeFileSync(path, current.replace(oldText, newText), "utf-8")
        return { success: true, output: "File updated successfully", filePath: path }
      }

      case "create_file": {
        const path = String(input.path ?? "")
        const content = String(input.content ?? "")
        const dir = dirname(path)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(path, content, "utf-8")
        return { success: true, output: "File created successfully", filePath: path }
      }

      case "search_docs": {
        const results = searchDocs(String(input.query ?? ""), 3)
        if (results.length === 0) return { success: true, output: "No documentation found." }
        return {
          success: true,
          output: results.map((r) => `### ${r.title}\n${r.content}`).join("\n\n---\n\n")
        }
      }

      // ── Bridge tools ────────────────────────────────────────────────────────
      case "read_instance_tree": {
        if (!isBridgeConnected()) {
          return {
            success: false,
            output: "Studio bridge not connected. Open Roblox Studio with the Luano plugin installed and running."
          }
        }
        const tree = getBridgeTree()
        if (!tree) return { success: false, output: "Instance tree not yet received from Studio." }
        const maxDepth = Math.min(8, Math.max(1, Number(input.max_depth) || 4))
        return { success: true, output: serializeTree(tree, 0, maxDepth) }
      }

      case "get_runtime_logs": {
        if (!isBridgeConnected()) {
          return { success: false, output: "Studio bridge not connected." }
        }
        const logs = getBridgeLogs()
        const limit = Math.max(1, Number(input.limit) || 50)
        const kind = String(input.kind ?? "all")
        const filtered =
          kind === "all" ? logs : logs.filter((l) => l.kind === kind)
        const recent = filtered.slice(-limit)
        if (recent.length === 0) return { success: true, output: "No logs." }
        return {
          success: true,
          output: recent.map((l) => `[${l.kind.toUpperCase()}] ${l.text}`).join("\n")
        }
      }

      case "run_studio_script": {
        if (!isBridgeConnected()) {
          return {
            success: false,
            output: "Studio bridge not connected. Open Roblox Studio with the Luano plugin installed."
          }
        }
        const code = String(input.code ?? "")
        if (!code.trim()) return { success: false, output: "No code provided." }
        const id = queueScript(code)
        return await pollCommandResult(id)
      }

      case "set_property": {
        if (!isBridgeConnected()) {
          return { success: false, output: "Studio bridge not connected." }
        }
        const path = String(input.path ?? "")
        const property = String(input.property ?? "")
        const value = String(input.value ?? "nil")
        if (!path || !property) {
          return { success: false, output: "path and property are required." }
        }

        // Build safe Luau that traverses the path then sets the property
        const code = [
          `local ok, err = pcall(function()`,
          `  local inst = game.${path}`,
          `  inst.${property} = ${value}`,
          `end)`,
          `if ok then`,
          `  print("[Luano] Set ${path}.${property} = ${value}")`,
          `else`,
          `  error(tostring(err))`,
          `end`
        ].join("\n")

        const id = queueScript(code)
        return await pollCommandResult(id)
      }

      // ── 탐색 도구 ──────────────────────────────────────────────────────────
      case "list_files": {
        const dirPath = String(input.path ?? "")
        const recursive = Boolean(input.recursive)
        if (!existsSync(dirPath)) return { success: false, output: `Directory not found: ${dirPath}` }
        const results: string[] = []
        const maxDepth = recursive ? 3 : 1
        const walkDir = (dir: string, depth: number): void => {
          if (depth > maxDepth || results.length > 200) return
          try {
            const entries = readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
              if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "Packages") continue
              const rel = relative(dirPath, join(dir, entry.name))
              if (entry.isDirectory()) {
                results.push(`${rel}/`)
                if (recursive) walkDir(join(dir, entry.name), depth + 1)
              } else {
                results.push(rel)
              }
            }
          } catch { /* skip unreadable dirs */ }
        }
        walkDir(dirPath, 0)
        return { success: true, output: results.join("\n") || "(empty directory)" }
      }

      case "grep_files": {
        const pattern = String(input.pattern ?? "")
        const searchPath = String(input.path ?? "")
        const filePatternStr = String(input.file_pattern ?? ".lua,.luau")
        if (!pattern || !searchPath) return { success: false, output: "pattern and path are required" }
        const exts = filePatternStr.split(",").map((e) => e.trim())
        const results: string[] = []
        const searchDir = (dir: string): void => {
          if (results.length > 50) return
          try {
            const entries = readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
              if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "Packages") continue
              const fullPath = join(dir, entry.name)
              if (entry.isDirectory()) {
                searchDir(fullPath)
              } else if (exts.some((ext) => entry.name.endsWith(ext))) {
                try {
                  const lines = readFileSync(fullPath, "utf-8").split("\n")
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(pattern)) {
                      results.push(`${relative(searchPath, fullPath)}:${i + 1}: ${lines[i].trim()}`)
                      if (results.length > 50) return
                    }
                  }
                } catch { /* skip unreadable files */ }
              }
            }
          } catch { /* skip unreadable dirs */ }
        }
        searchDir(searchPath)
        return { success: true, output: results.join("\n") || "No matches found" }
      }

      case "delete_file": {
        const path = String(input.path ?? "")
        if (!existsSync(path)) return { success: false, output: `File not found: ${path}` }
        unlinkSync(path)
        return { success: true, output: "File deleted successfully", filePath: path }
      }

      case "lint_file": {
        const path = String(input.path ?? "")
        if (!existsSync(path)) return { success: false, output: `File not found: ${path}` }
        const diags = await seleneCheck(path, dirname(path))
        if (diags.length === 0) return { success: true, output: "No lint errors found." }
        const lines = diags.map((d) =>
          `${d.severity.toUpperCase()} line ${d.line}: ${d.message} [${d.code}]`
        )
        return { success: true, output: `Found ${diags.length} issue(s):\n${lines.join("\n")}` }
      }

      default:
        return { success: false, output: `Unknown tool: ${name}` }
    }
  } catch (err) {
    return { success: false, output: `Tool execution error: ${String(err)}` }
  }
}
