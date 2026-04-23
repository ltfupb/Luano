/**
 * electron/pro/index.ts — Pro feature interface layer
 *
 * Attempts to load @luano/pro package. If present and licensed, Pro features
 * are available. Otherwise, the app runs in Free mode.
 *
 * Free mode includes: editor, LSP, Rojo/Selene/StyLua, basic AI chat (BYOK Q&A).
 * Pro mode adds: Agent loop, inline edit, RAG, Studio bridge, cross-script analysis,
 * performance lint, DataStore schema generator, skills system.
 */

import { app } from "electron"
import { hasValidLicense } from "./license"

export function isPro(): boolean {
  // Dev override: LUANO_PRO=1 only enables Pro in unpackaged (dev) builds.
  // A packaged install must go through a real license — otherwise any user
  // can flip Pro on by setting an env var.
  if (!app.isPackaged && process.env.LUANO_PRO === "1") return true
  // LemonSqueezy license key
  return hasValidLicense()
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
