#!/usr/bin/env node
/**
 * scripts/trim-api-dump.js
 *
 * Strips api-dump.json down to the fields api-context.ts actually reads,
 * and drops deprecated/hidden members that api-context.ts filters at
 * runtime anyway. Cuts the bundled dump roughly in half.
 *
 * Run in-place on resources/roblox-docs/api-dump.json. Re-run whenever
 * the Roblox API dump is refreshed. Driven by `npm run trim-api` or from
 * the build pipeline.
 */

const fs = require("fs")
const path = require("path")

const DUMP_PATH = path.join(__dirname, "..", "resources", "roblox-docs", "api-dump.json")

function trimMember(m) {
  // Fields consumed by api-context.ts formatMember + ApiMember interface.
  const out = { MemberType: m.MemberType, Name: m.Name }
  if (m.Tags) out.Tags = m.Tags
  if (m.Parameters) {
    out.Parameters = m.Parameters.map((p) => {
      const pp = { Name: p.Name, Type: { Name: p.Type && p.Type.Name ? p.Type.Name : "any" } }
      if (p.Default !== undefined) pp.Default = p.Default
      return pp
    })
  }
  if (m.ReturnType && m.ReturnType.Name) out.ReturnType = { Name: m.ReturnType.Name }
  if (m.ValueType && m.ValueType.Name) out.ValueType = { Name: m.ValueType.Name }
  if (m.Security !== undefined) out.Security = m.Security
  return out
}

function trimClass(cls) {
  const out = { Name: cls.Name }
  if (cls.Superclass) out.Superclass = cls.Superclass
  if (cls.Tags) out.Tags = cls.Tags
  // Drop deprecated / hidden members upfront — api-context.ts already filters
  // them on every call, so removing here saves disk + runtime work.
  out.Members = (cls.Members || [])
    .filter((m) => !(m.Tags && (m.Tags.includes("Deprecated") || m.Tags.includes("Hidden"))))
    .map(trimMember)
  return out
}

function trimEnum(en) {
  return {
    Name: en.Name,
    Items: (en.Items || []).map((i) => ({ Name: i.Name, Value: i.Value }))
  }
}

function main() {
  const before = fs.statSync(DUMP_PATH).size
  const raw = fs.readFileSync(DUMP_PATH, "utf-8")
  const dump = JSON.parse(raw)

  const trimmed = {
    Classes: (dump.Classes || []).map(trimClass),
    Enums: (dump.Enums || []).map(trimEnum)
  }
  if (dump.Version !== undefined) trimmed.Version = dump.Version

  fs.writeFileSync(DUMP_PATH, JSON.stringify(trimmed), "utf-8")
  const after = fs.statSync(DUMP_PATH).size
  const pct = (((before - after) / before) * 100).toFixed(1)
  console.log(`api-dump.json: ${(before / 1024 / 1024).toFixed(2)}MB -> ${(after / 1024 / 1024).toFixed(2)}MB (-${pct}%)`)
}

main()
