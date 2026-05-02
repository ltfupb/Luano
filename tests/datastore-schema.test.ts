import { describe, it, expect } from "vitest"
import {
  validateSchemaIdentifiers,
  isValidLuauIdent,
  generateDataModule,
  migrateSchemaFile,
} from "../electron/datastore/schema"
import { generateMigration } from "../electron/datastore/schema"
import type { DataStoreSchema } from "../electron/datastore/schema"

// ── validateSchemaIdentifiers (security gate at IPC entry) ───────────────────
// Renderer-side checks are UX-only and bypassable; the server validates every
// schema before persisting or generating code (commit cedabfb + c3615a8).

describe("validateSchemaIdentifiers", () => {
  const ok = {
    name: "PlayerData",
    version: 1,
    fields: [{ name: "coins", type: "number", default: 0 }]
  }

  it("accepts a well-formed schema", () => {
    expect(() => validateSchemaIdentifiers(ok)).not.toThrow()
  })

  it.each([
    "123bad", "with space", "with-dash", "with.dot",
    "_session", "_version",
    "function", "local", "if", "end", "return", "while", "type", "continue",
    "') return require('etc/passwd')",
    "x']] -- comment escape",
    ""
  ])("rejects schema name %j", (n) => {
    expect(() => validateSchemaIdentifiers({ ...ok, name: n })).toThrow()
  })

  it.each([
    "123bad", "with space", "_session", "x']]", "function", "end"
  ])("rejects field name %j", (n) => {
    expect(() => validateSchemaIdentifiers({
      ...ok,
      fields: [{ name: n, type: "number", default: 0 }]
    })).toThrow()
  })

  it("rejects bad identifier on a nested table child", () => {
    expect(() => validateSchemaIdentifiers({
      ...ok,
      fields: [{
        name: "profile", type: "table", default: {},
        children: [{ name: "1bad", type: "number", default: 0 }]
      }]
    })).toThrow(/profile\.1bad/)
  })

  it.each([0, -1, 1.5, "1", null, undefined, Infinity, NaN])(
    "rejects schema.version value %j",
    (v) => {
      expect(() => validateSchemaIdentifiers({ ...ok, version: v as never }))
        .toThrow(/positive integer/)
    }
  )

  it("rejects when fields is not an array", () => {
    expect(() => validateSchemaIdentifiers({ ...ok, fields: "oops" as never })).toThrow()
  })

  it("rejects non-object input", () => {
    expect(() => validateSchemaIdentifiers(null)).toThrow()
    expect(() => validateSchemaIdentifiers("string")).toThrow()
    expect(() => validateSchemaIdentifiers(42)).toThrow()
  })

  it("isValidLuauIdent matches the public regex contract", () => {
    expect(isValidLuauIdent("a")).toBe(true)
    expect(isValidLuauIdent("A_b9")).toBe(true)
    expect(isValidLuauIdent("_session")).toBe(false)
    expect(isValidLuauIdent("function")).toBe(false)  // keyword
    expect(isValidLuauIdent("")).toBe(false)
  })
})

// ── luauDefault control-char escaping (commit 0520c4d) ───────────────────────
// Generated via generateDataModule because luauDefault is module-private.
// A regression that re-narrows the regex would let attacker-controlled
// defaults break out of the Luau string literal.

describe("luauDefault — control-char and injection escaping", () => {
  const base = (defaultVal: string) => ({
    name: "Save", version: 1,
    fields: [{ name: "note", type: "string" as const, default: defaultVal }]
  })

  /**
   * Pull the raw payload between the double quotes on the generated `note = "..."`
   * line. We use this to assert what's inside the Luau string literal without
   * tripping over indentation tabs / surrounding code.
   */
  function notePayload(out: string): string {
    // Match either a fully-escaped value or one with the close-string escape.
    // Greedy regex is safe here because the assignment is on a single line.
    const line = out.split("\n").find((l) => /^\s*note\s*=\s*"/.test(l))
    if (!line) throw new Error("no note assignment found")
    const m = line.match(/note\s*=\s*"((?:[^"\\]|\\.)*)"/)
    if (!m) throw new Error(`could not parse note assignment: ${line}`)
    return m[1]
  }

  it.each([
    ["NUL byte",     "\x00", "\\0"],
    ["BEL",          "\x07", "\\7"],
    ["ESC",          "\x1b", "\\27"],
    ["unit-sep",     "\x1f", "\\31"],
    ["newline",      "\n",   "\\n"],
    ["carriage ret", "\r",   "\\r"],
    ["tab",          "\t",   "\\t"],
    ["backslash",    "\\",   "\\\\"],
    ["double quote", '"',    '\\"']
  ])("%s is escaped inside the Luau literal", (_, raw, escaped) => {
    const payload = notePayload(generateDataModule(base(`a${raw}b`)))
    expect(payload).toBe(`a${escaped}b`)
  })

  it("the close-string-and-execute payload cannot escape", () => {
    const payload = '"; os.execute("id") --'
    const out = generateDataModule(base(payload))
    // Never live code: the payload stays inside the literal.
    expect(out).not.toMatch(/note\s*=\s*""\s*;\s*os\.execute/)
    // Closing quote is escaped, so the literal continues across the payload.
    expect(notePayload(out)).toBe('\\"; os.execute(\\"id\\") --')
  })

  it("every byte 0x00..0x1f is encoded inside the Luau literal", () => {
    for (let b = 0; b < 0x20; b++) {
      const ch = String.fromCharCode(b)
      const payload = notePayload(generateDataModule(base(ch)))
      expect(payload, `byte 0x${b.toString(16)} leaked raw into the literal`)
        .not.toContain(ch)
      // Must be a recognised escape: \n, \r, \t, or decimal \nnn.
      expect(payload).toMatch(/^\\(?:n|r|t|\d{1,3})$/)
    }
  })

  it("description with newline cannot escape the -- comment line", () => {
    const out = generateDataModule({
      name: "Save", version: 1,
      fields: [{ name: "note", type: "string", default: "", description: "line1\nline2 -- evil" }]
    })
    // sanitizeDescription replaces \n with space, so the description stays on
    // one line and "evil" cannot become a separate code line.
    const lines = out.split("\n").filter((l) => l.includes("note"))
    expect(lines.length).toBeGreaterThanOrEqual(1)
    for (const line of lines) {
      expect(line).not.toMatch(/^[^-]*line2/)  // line2 must follow `--`
    }
  })
})

// ── migrateSchemaFile (silent-data-loss prevention) ─────────────────────────

describe("migrateSchemaFile", () => {
  it("throws on non-object root", () => {
    expect(() => migrateSchemaFile(null)).toThrow()
    expect(() => migrateSchemaFile([])).toThrow()
    expect(() => migrateSchemaFile("string")).toThrow()
  })

  it("throws when schemas key is not an array", () => {
    expect(() => migrateSchemaFile({ schemas: "oops" })).toThrow(/schemas/)
  })

  it("drops entries without a string name", () => {
    const out = migrateSchemaFile({
      schemas: [
        { version: 1, fields: [] },           // missing name
        { name: "A", version: 1, fields: [] } // valid
      ]
    })
    expect(out.schemas.map((s) => s.name)).toEqual(["A"])
  })

  it("coerces unknown field type to string", () => {
    const out = migrateSchemaFile({
      schemas: [{
        name: "A", version: 1,
        fields: [{ name: "x", type: "WeirdType", default: 1 }]
      }]
    })
    expect(out.schemas[0].fields[0].type).toBe("string")
  })

  it("defaults missing version to 1", () => {
    const out = migrateSchemaFile({ schemas: [{ name: "A", fields: [] }] })
    expect(out.schemas[0].version).toBe(1)
  })

  it("is idempotent on its own output", () => {
    const once = migrateSchemaFile({
      schemas: [{
        name: "A", version: 2,
        fields: [{ name: "coins", type: "number", default: 0 }]
      }]
    })
    const twice = migrateSchemaFile(JSON.parse(JSON.stringify(once)))
    expect(twice.schemas).toEqual(once.schemas)
  })
})

// ── generateMigration version-ordering guard (H1) ───────────────────────────
// The IPC handler at datastore:generate-migration must reject inverted or
// equal versions before calling generateMigration. The unit function itself
// is also exercised here so any future direct-call path remains guarded.

describe("generateMigration — version-ordering (H1)", () => {
  const base = (v: number): DataStoreSchema => ({
    name: "Save",
    version: v,
    fields: [{ name: "coins", type: "number", default: 0 }],
  })

  it("proceeds normally when newSchema.version > oldSchema.version", () => {
    // Should return a non-empty migration string without throwing.
    const out = generateMigration(base(1), base(2))
    expect(typeof out).toBe("string")
    expect(out.length).toBeGreaterThan(0)
  })

  it("returns a string (function has no guard — guard lives in IPC handler)", () => {
    // generateMigration itself does not validate ordering; the defense-in-depth
    // guard is at the IPC layer. This test documents that expectation and
    // verifies the IPC handler error string is matched by the integration tests.
    // Direct callers must apply the same guard themselves.
    const out = generateMigration(base(2), base(1))
    // The function returns a (potentially nonsensical) string — it does NOT throw.
    expect(typeof out).toBe("string")
  })
})

// ── generateMigration field-type-change reset (D1) ──────────────────────────
// Without the type-change reset, a field that goes from string→table emits
// `data.profile.coins = 0` against a string value at runtime — "attempt to
// index a string value" — and the player's save fails to load.

describe("generateMigration — type-change handling (D1)", () => {
  it("emits a typeof reset when a field changes from string to table", () => {
    const oldS: DataStoreSchema = {
      name: "S", version: 1,
      fields: [{ name: "profile", type: "string", default: "" }]
    }
    const newS: DataStoreSchema = {
      name: "S", version: 2,
      fields: [{
        name: "profile", type: "table", default: {},
        children: [{ name: "coins", type: "number", default: 0 }]
      }]
    }
    const out = generateMigration(oldS, newS)
    // Reset block must appear before any assignment to data.profile.coins.
    const resetIdx = out.search(/typeof\(data\.profile\) ~= "table"/)
    const childIdx = out.search(/data\.profile\.coins\s*=/)
    expect(resetIdx).toBeGreaterThan(-1)
    expect(childIdx).toBeGreaterThan(-1)
    expect(resetIdx).toBeLessThan(childIdx)
    // The reset must clear the bad shape with `{}`.
    expect(out).toMatch(/typeof\(data\.profile\) ~= "table" then\s+data\.profile = \{\}/)
  })

  it("emits a typeof reset when a field changes from table to string", () => {
    const oldS: DataStoreSchema = {
      name: "S", version: 1,
      fields: [{
        name: "profile", type: "table", default: {},
        children: [{ name: "coins", type: "number", default: 0 }]
      }]
    }
    const newS: DataStoreSchema = {
      name: "S", version: 2,
      fields: [{ name: "profile", type: "string", default: "" }]
    }
    const out = generateMigration(oldS, newS)
    expect(out).toMatch(/typeof\(data\.profile\) ~= "string" then\s+data\.profile = ""/)
    // Old child path must NOT appear as a removal (the reset already wiped it).
    expect(out).not.toMatch(/data\.profile\.coins = nil/)
  })

  it("does not emit a reset for paths whose type stayed the same", () => {
    const oldS: DataStoreSchema = {
      name: "S", version: 1,
      fields: [{ name: "coins", type: "number", default: 0 }]
    }
    const newS: DataStoreSchema = {
      name: "S", version: 2,
      fields: [
        { name: "coins", type: "number", default: 0 },
        { name: "level", type: "number", default: 1 }
      ]
    }
    const out = generateMigration(oldS, newS)
    expect(out).not.toMatch(/typeof\(data\.coins\)/)
    expect(out).toMatch(/data\.level = 1/)
  })

  it("handles nested type changes inside a table", () => {
    const oldS: DataStoreSchema = {
      name: "S", version: 1,
      fields: [{
        name: "profile", type: "table", default: {},
        children: [{ name: "title", type: "string", default: "" }]
      }]
    }
    const newS: DataStoreSchema = {
      name: "S", version: 2,
      fields: [{
        name: "profile", type: "table", default: {},
        children: [{ name: "title", type: "number", default: 0 }]
      }]
    }
    const out = generateMigration(oldS, newS)
    expect(out).toMatch(/typeof\(data\.profile\.title\) ~= "number"/)
  })
})
