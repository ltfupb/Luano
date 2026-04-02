/**
 * electron/pro/index.ts — Pro feature interface layer
 *
 * Attempts to load @luano/pro package. If present and licensed, Pro features
 * are available. Otherwise, the app runs in Community (free) mode.
 *
 * Community mode includes: editor, LSP, Rojo/Selene/StyLua, basic AI chat (BYOK Q&A).
 * Pro mode adds: Agent loop, inline edit, RAG, Studio bridge, cross-script analysis,
 * performance lint, DataStore schema generator, skills system.
 */

import type { ChatMessage, AgentChatResult } from "../ai/provider"
import { hasValidLicense } from "./license"

export interface LuanoProModule {
  validateLicense(): boolean
  agentChat(messages: ChatMessage[], systemPrompt: string, streamChannel: string): Promise<AgentChatResult>
  inlineEdit(filePath: string, fileContent: string, instruction: string, systemPrompt: string): Promise<string>
  getTools(): unknown[]
  buildSystemPrompt(context: unknown): string
}

let pro: LuanoProModule | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pro = require("@luano/pro")
} catch {
  pro = null
}

export function isPro(): boolean {
  // Dev override: LUANO_PRO=1 in env enables Pro features locally
  if (process.env.LUANO_PRO === "1") return true
  // LemonSqueezy license key
  if (hasValidLicense()) return true
  return pro !== null && pro.validateLicense()
}

export function getProModule(): LuanoProModule | null {
  if (!isPro()) return null
  return pro
}

/** Feature gate — returns true if the feature should be available */
export function hasFeature(feature: ProFeature): boolean {
  // All features require Pro except basic ones
  if (FREE_FEATURES.has(feature)) return true
  return isPro()
}

export type ProFeature =
  | "editor"
  | "lsp"
  | "rojo"
  | "selene"
  | "stylua"
  | "terminal"
  | "explorer"
  | "templates"
  | "basic-chat"
  | "agent"
  | "inline-edit"
  | "rag"
  | "studio-bridge"
  | "cross-script"
  | "perf-lint"
  | "datastore-schema"
  | "skills"

const FREE_FEATURES = new Set<ProFeature>([
  "editor",
  "lsp",
  "rojo",
  "selene",
  "stylua",
  "terminal",
  "explorer",
  "templates",
  "basic-chat"
])
