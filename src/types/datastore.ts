/**
 * Shared DataStore schema types and validation rules — renderer-safe (no
 * Node.js imports). Imported by both the renderer panel and the Electron
 * main-process schema module so the two cannot diverge.
 */

export type FieldType =
  | "string" | "number" | "boolean"
  | "table" | "array"
  | "Instance" | "CFrame" | "Vector3" | "Color3"

/** Single source of truth for the field-type list (shared by renderer + main). */
export const FIELD_TYPES: readonly FieldType[] = [
  "string", "number", "boolean",
  "table", "array",
  "Instance", "CFrame", "Vector3", "Color3"
]

export const FIELD_TYPE_SET: ReadonlySet<FieldType> = new Set(FIELD_TYPES)

export interface SchemaField {
  name: string
  type: FieldType
  default: unknown
  description?: string
  /** Nested fields — only valid when type === "table" */
  children?: SchemaField[]
}

export interface DataStoreSchema {
  name: string
  version: number
  description?: string
  fields: SchemaField[]
}

export interface SchemaFile {
  schemas: DataStoreSchema[]
  createdAt?: string
  updatedAt?: string
}

// ── Identifier validation ─────────────────────────────────────────────────────

/** Luau identifier shape: starts with a letter or _, then letters/digits/_. */
export const LUAU_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Names reserved by the runtime layer (and Luau keywords). */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
  // Runtime-reserved
  "_session", "_version",
  // Luau / Lua keywords (would produce syntactically broken modules)
  "and", "break", "do", "else", "elseif", "end", "false", "for",
  "function", "if", "in", "local", "nil", "not", "or", "repeat",
  "return", "then", "true", "until", "while",
  // Luau-specific keywords
  "continue", "type", "export"
])

export function isValidLuauIdent(name: string): boolean {
  if (!name) return false
  if (RESERVED_FIELD_NAMES.has(name)) return false
  return LUAU_IDENT_RE.test(name)
}
