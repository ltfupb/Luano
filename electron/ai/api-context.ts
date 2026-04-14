/**
 * API Context: Extract relevant Roblox API definitions for AI context injection.
 *
 * Detects which services/classes the current file uses (via GetService/variable names),
 * then extracts their full API signatures from the bundled Full-API-Dump.json.
 * This gives the AI accurate, complete API knowledge without hallucination.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { app } from "electron"

interface ApiMember {
  MemberType: string
  Name: string
  Parameters?: Array<{ Name: string; Type: { Name: string }; Default?: string }>
  ReturnType?: { Name: string }
  ValueType?: { Name: string }
  Tags?: string[]
  Security?: string | { Read: string; Write: string }
}

interface ApiClass {
  Name: string
  Superclass?: string
  Members: ApiMember[]
  Tags?: string[]
}

interface ApiDump {
  Classes: ApiClass[]
  Enums?: Array<{ Name: string; Items: Array<{ Name: string; Value: number }> }>
}

let cachedDump: ApiDump | null = null

function loadApiDump(): ApiDump | null {
  if (cachedDump) return cachedDump

  const devPath = join(app.getAppPath(), "resources", "roblox-docs", "api-dump.json")
  const prodPath = join(process.resourcesPath ?? app.getAppPath(), "roblox-docs", "api-dump.json")
  const dumpPath = existsSync(devPath) ? devPath : existsSync(prodPath) ? prodPath : null
  if (!dumpPath) return null

  try {
    cachedDump = JSON.parse(readFileSync(dumpPath, "utf-8"))
    return cachedDump
  } catch {
    return null
  }
}

function formatMember(cls: string, m: ApiMember): string {
  if (m.MemberType === "Function") {
    const params = m.Parameters?.map((p) => {
      const def = p.Default ? ` = ${p.Default}` : ""
      return `${p.Name}: ${p.Type?.Name ?? "any"}${def}`
    }).join(", ") ?? ""
    const ret = m.ReturnType?.Name ?? "void"
    return `  function ${cls}:${m.Name}(${params}): ${ret}`
  }
  if (m.MemberType === "Event") {
    const params = m.Parameters?.map((p) => `${p.Name}: ${p.Type?.Name ?? "any"}`).join(", ") ?? ""
    return `  event ${cls}.${m.Name}(${params})`
  }
  if (m.MemberType === "Property") {
    const readOnly = (typeof m.Security === "object" && m.Security.Write !== "None") ? " [readonly]" : ""
    return `  ${cls}.${m.Name}: ${m.ValueType?.Name ?? "any"}${readOnly}`
  }
  if (m.MemberType === "Callback") {
    const params = m.Parameters?.map((p) => `${p.Name}: ${p.Type?.Name ?? "any"}`).join(", ") ?? ""
    return `  callback ${cls}.${m.Name}(${params})`
  }
  return `  ${cls}.${m.Name}`
}

function formatClass(cls: ApiClass): string {
  const members = cls.Members
    .filter((m) => !m.Tags?.includes("Deprecated") && !m.Tags?.includes("Hidden"))
    .map((m) => formatMember(cls.Name, m))
    .join("\n")
  const ext = cls.Superclass && cls.Superclass !== "<<<ROOT>>>" ? ` extends ${cls.Superclass}` : ""
  return `class ${cls.Name}${ext}\n${members}`
}

/** Detect service names from Luau source code */
export function detectServices(code: string): string[] {
  const services = new Set<string>()

  // game:GetService("ServiceName")
  const getServicePattern = /GetService\s*\(\s*["'](\w+)["']\s*\)/g
  let match
  while ((match = getServicePattern.exec(code)) !== null) {
    services.add(match[1])
  }

  // game.ServiceName or game:FindService("ServiceName")
  const dotPattern = /game\.(\w+Service\w*)/g
  while ((match = dotPattern.exec(code)) !== null) {
    services.add(match[1])
  }

  return [...services]
}

/** Detect Enum names from code (Enum.Material, Enum.UserInputType, etc.) */
export function detectEnums(code: string): string[] {
  const enums = new Set<string>()
  const pattern = /Enum\.([A-Z][a-zA-Z0-9]+)/g
  let match
  while ((match = pattern.exec(code)) !== null) {
    enums.add(match[1])
  }
  return [...enums]
}

/** Detect non-service class names from code (Instance.new, :FindFirstChildOfClass, etc.) */
export function detectClasses(code: string): string[] {
  const classes = new Set<string>()

  // Instance.new("ClassName")
  const instanceNewPattern = /Instance\.new\s*\(\s*["'](\w+)["']\s*\)/g
  let match
  while ((match = instanceNewPattern.exec(code)) !== null) {
    classes.add(match[1])
  }

  // :IsA("ClassName"), :FindFirstChildOfClass("ClassName")
  const isAPattern = /:\w+\s*\(\s*["'](\w+)["']\s*\)/g
  while ((match = isAPattern.exec(code)) !== null) {
    // Filter to likely class names (PascalCase, no Luau keywords)
    if (/^[A-Z][a-zA-Z0-9]+$/.test(match[1])) {
      classes.add(match[1])
    }
  }

  return [...classes]
}

/**
 * Build API context string for the AI, based on what the current file uses.
 * Returns formatted API definitions for detected services, classes, and enums.
 */
export function buildApiContext(fileContent: string): string {
  const dump = loadApiDump()
  if (!dump) return ""

  const serviceNames = detectServices(fileContent)
  const classNames = detectClasses(fileContent)
  const allNames = new Set([...serviceNames, ...classNames])
  const enumNames = detectEnums(fileContent)

  if (allNames.size === 0 && enumNames.length === 0) return ""

  const sections: string[] = []

  // Classes and services
  if (allNames.size > 0) {
    const classMap = new Map(dump.Classes.map((c) => [c.Name, c]))
    for (const name of allNames) {
      const cls = classMap.get(name)
      if (!cls || cls.Tags?.includes("Deprecated")) continue
      sections.push(formatClass(cls))
    }
  }

  // Enums
  if (enumNames.length > 0 && dump.Enums) {
    const enumMap = new Map(dump.Enums.map((e) => [e.Name, e]))
    for (const name of enumNames) {
      const en = enumMap.get(name)
      if (!en) continue
      const items = en.Items.map((i) => `  ${i.Name} = ${i.Value}`).join("\n")
      sections.push(`enum ${en.Name}\n${items}`)
    }
  }

  if (sections.length === 0) return ""
  return sections.join("\n\n")
}
