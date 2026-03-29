import { readFileSync, writeFileSync, existsSync } from "fs"
import { searchDocs } from "./rag"
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
    description: "Read the full content of a file in the project",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the file" }
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
  input: Record<string, unknown>
): Promise<ToolResult> {
  try {
    switch (name) {
      // ── File tools ──────────────────────────────────────────────────────────
      case "read_file": {
        const path = String(input.path ?? "")
        if (!existsSync(path)) return { success: false, output: `File not found: ${path}` }
        return { success: true, output: readFileSync(path, "utf-8") }
      }

      case "edit_file": {
        const path = String(input.path ?? "")
        const oldText = String(input.old_text ?? "")
        const newText = String(input.new_text ?? "")
        if (!existsSync(path)) return { success: false, output: `File not found: ${path}` }
        const current = readFileSync(path, "utf-8")
        if (!current.includes(oldText)) {
          return { success: false, output: "Text not found in file — cannot apply edit" }
        }
        writeFileSync(path, current.replace(oldText, newText), "utf-8")
        return { success: true, output: "File updated successfully", filePath: path }
      }

      case "create_file": {
        const path = String(input.path ?? "")
        const content = String(input.content ?? "")
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

      default:
        return { success: false, output: `Unknown tool: ${name}` }
    }
  } catch (err) {
    return { success: false, output: `Tool execution error: ${String(err)}` }
  }
}
