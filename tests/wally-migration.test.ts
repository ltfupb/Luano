/**
 * Tests for the Wally → pesde migration helper.
 *
 * The parser is intentionally minimal — it only handles the subset of TOML
 * that wally.toml uses. These tests exercise the shapes we actually expect
 * to encounter, plus a few edge cases around malformed input.
 */

import { describe, it, expect } from "vitest"
import {
  parseWallyToml,
  splitWallySpec,
  buildPesdeToml
} from "../electron/file/wally-migration"

describe("parseWallyToml", () => {
  it("reads [package] section fields", () => {
    const source = `
[package]
name = "user/repo"
version = "1.2.3"
realm = "shared"
description = "Test package"
license = "MIT"
authors = ["Alice <a@example.com>", "Bob"]

[dependencies]
`
    const m = parseWallyToml(source)
    expect(m.packageName).toBe("user/repo")
    expect(m.version).toBe("1.2.3")
    expect(m.realm).toBe("shared")
    expect(m.description).toBe("Test package")
    expect(m.license).toBe("MIT")
    expect(m.authors).toEqual(["Alice <a@example.com>", "Bob"])
  })

  it("reads [dependencies], [server-dependencies], [dev-dependencies]", () => {
    const source = `
[package]
name = "u/r"
version = "0.1.0"
realm = "shared"

[dependencies]
Roact = "Roblox/roact@^1.4.4"
Promise = "evaera/promise@4.0.0"

[server-dependencies]
DataStore = "Roblox/datastore@1.0.0"

[dev-dependencies]
TestEZ = "Roblox/testez@^0.4.0"
`
    const m = parseWallyToml(source)
    expect(m.dependencies).toEqual({
      Roact: "Roblox/roact@^1.4.4",
      Promise: "evaera/promise@4.0.0"
    })
    expect(m.serverDependencies).toEqual({ DataStore: "Roblox/datastore@1.0.0" })
    expect(m.devDependencies).toEqual({ TestEZ: "Roblox/testez@^0.4.0" })
  })

  it("ignores comments and blank lines", () => {
    const source = `
# Top-level comment
[package]
# A comment inside the package section
name = "u/r"
version = "0.1.0"
realm = "shared"

[dependencies]
# a leading comment
Roact = "Roblox/roact@^1.4.4"
`
    const m = parseWallyToml(source)
    expect(m.packageName).toBe("u/r")
    expect(m.dependencies).toEqual({ Roact: "Roblox/roact@^1.4.4" })
  })

  it("strips end-of-line comments without losing the quoted value", () => {
    // Common in real wally.toml: `Roact = "scope/name@1.0" # UI library`.
    // Without comment stripping, parseValue would return the whole tail
    // including the comment, and downstream splitWallySpec would find the
    // wrong @ (the one inside the comment doesn't matter, but the trailing
    // junk would corrupt the version range).
    const source = `
[package]
name = "u/r" # comment after name
version = "0.1.0"
realm = "shared"

[dependencies]
Roact = "Roblox/roact@^1.4.4" # UI library
Promise = "evaera/promise@4.0.0"   #  with extra spaces
`
    const m = parseWallyToml(source)
    expect(m.packageName).toBe("u/r")
    expect(m.dependencies).toEqual({
      Roact: "Roblox/roact@^1.4.4",
      Promise: "evaera/promise@4.0.0"
    })
  })

  it("preserves '#' inside a quoted string value", () => {
    // The comment stripper must not truncate a `#` that's inside quotes —
    // otherwise a legitimate description / license / package name with a
    // hash character would be silently mangled.
    const source = `
[package]
name = "u/r"
version = "0.1.0"
realm = "shared"
description = "Issue #42 fix"
`
    const m = parseWallyToml(source)
    expect(m.description).toBe("Issue #42 fix")
  })

  it("records inline-table dep specs as unmapped instead of silently mangling them", () => {
    // Future-proofing: if a user wrote a pesde-style inline table by
    // accident under [dependencies], the migrator should not coerce it
    // through splitWallySpec and produce malformed output. The whole-line
    // value lands in unmappedDependencies and gets a # comment in the
    // emitted pesde.toml so the user sees what we couldn't translate.
    const source = `
[package]
name = "u/r"
version = "0.1.0"
realm = "shared"

[dependencies]
Roact = "Roblox/roact@^1.4.4"
Weird = { wally = "scope/name", version = "^1" }
`
    const m = parseWallyToml(source)
    expect(m.dependencies.Roact).toBe("Roblox/roact@^1.4.4")
    expect(m.dependencies.Weird).toBe('{ wally = "scope/name", version = "^1" }')
    const result = buildPesdeToml(m)
    expect(result.unmappedDependencies).toContainEqual(
      expect.objectContaining({ alias: "Weird", realm: "shared" })
    )
    expect(result.pesdeToml).toContain("# Weird")
    expect(result.pesdeToml).toContain("could not parse")
  })

  it("handles missing sections without throwing", () => {
    const m = parseWallyToml("")
    expect(m.packageName).toBeNull()
    expect(m.version).toBeNull()
    expect(m.dependencies).toEqual({})
  })

  it("ignores unknown sections", () => {
    const source = `
[package]
name = "u/r"
version = "0.1.0"
realm = "shared"

[place]
shared = "game.Client"

[dependencies]
Roact = "Roblox/roact@^1.4.4"
`
    const m = parseWallyToml(source)
    expect(m.packageName).toBe("u/r")
    expect(m.dependencies).toEqual({ Roact: "Roblox/roact@^1.4.4" })
  })
})

describe("splitWallySpec", () => {
  it("splits scope/name@version", () => {
    expect(splitWallySpec("Roblox/roact@^1.4.4")).toEqual({
      wallyPackage: "Roblox/roact",
      version: "^1.4.4"
    })
  })

  it("returns null for malformed input", () => {
    expect(splitWallySpec("Roblox/roact")).toBeNull()
    expect(splitWallySpec("@")).toBeNull()
    expect(splitWallySpec("")).toBeNull()
  })

  it("uses the LAST @ to allow scoped names with embedded @", () => {
    // Real wally specs don't have embedded @, but the splitter is defensive.
    expect(splitWallySpec("user/foo@bar@1.0.0")).toEqual({
      wallyPackage: "user/foo@bar",
      version: "1.0.0"
    })
  })
})

describe("buildPesdeToml", () => {
  it("produces a valid pesde manifest with name, version, indices, and dependencies", () => {
    const manifest = parseWallyToml(`
[package]
name = "user/repo"
version = "1.0.0"
realm = "shared"
license = "MIT"

[dependencies]
Roact = "Roblox/roact@^1.4.4"
Promise = "evaera/promise@4.0.0"
`)
    const result = buildPesdeToml(manifest)
    expect(result.migratedCount).toBe(2)
    expect(result.unmappedDependencies).toEqual([])

    expect(result.pesdeToml).toContain('name = "user/repo"')
    expect(result.pesdeToml).toContain('version = "1.0.0"')
    expect(result.pesdeToml).toContain('license = "MIT"')
    expect(result.pesdeToml).toContain("[indices]")
    expect(result.pesdeToml).toContain("https://github.com/pesde-pkg/index")
    expect(result.pesdeToml).toContain("[wally_indices]")
    expect(result.pesdeToml).toContain("https://github.com/UpliftGames/wally-index")
    expect(result.pesdeToml).toContain("[dependencies]")
    expect(result.pesdeToml).toContain('Roact = { wally = "Roblox/roact", version = "^1.4.4" }')
    expect(result.pesdeToml).toContain('Promise = { wally = "evaera/promise", version = "4.0.0" }')
  })

  it("places server-dependencies under [dependencies] with target = roblox_server", () => {
    const manifest = parseWallyToml(`
[package]
name = "user/repo"
version = "0.1.0"
realm = "shared"

[dependencies]
Roact = "Roblox/roact@^1.4.4"

[server-dependencies]
DataStore = "Roblox/datastore@1.0.0"
`)
    const result = buildPesdeToml(manifest)
    // Both should land under a single [dependencies] block — TOML doesn't
    // allow duplicate section headers.
    const depsSectionCount = (result.pesdeToml.match(/^\[dependencies\]$/gm) ?? []).length
    expect(depsSectionCount).toBe(1)
    expect(result.pesdeToml).toContain('Roact = { wally = "Roblox/roact", version = "^1.4.4" }')
    expect(result.pesdeToml).toContain('DataStore = { wally = "Roblox/datastore", version = "1.0.0", target = "roblox_server" }')
  })

  it("places dev-dependencies under [dev_dependencies]", () => {
    const manifest = parseWallyToml(`
[package]
name = "user/repo"
version = "0.1.0"
realm = "shared"

[dev-dependencies]
TestEZ = "Roblox/testez@^0.4.0"
`)
    const result = buildPesdeToml(manifest)
    expect(result.pesdeToml).toContain("[dev_dependencies]")
    expect(result.pesdeToml).toContain('TestEZ = { wally = "Roblox/testez", version = "^0.4.0" }')
    // The dev section should NOT appear inside [dependencies].
    expect(result.pesdeToml).not.toMatch(/\[dependencies\][\s\S]*TestEZ/)
  })

  it("comments out unparseable specs and reports them in unmappedDependencies", () => {
    const manifest = parseWallyToml(`
[package]
name = "u/r"
version = "0.1.0"
realm = "shared"

[dependencies]
Good = "Roblox/roact@1.0.0"
Bad = "this-is-not-a-real-spec"
`)
    const result = buildPesdeToml(manifest)
    expect(result.migratedCount).toBe(1)
    expect(result.unmappedDependencies).toEqual([
      { realm: "shared", alias: "Bad", raw: "this-is-not-a-real-spec" }
    ])
    expect(result.pesdeToml).toContain('Good = { wally = "Roblox/roact", version = "1.0.0" }')
    expect(result.pesdeToml).toContain("# Bad")
    expect(result.pesdeToml).toContain("could not parse")
  })

  it("falls back to safe defaults when name/version are missing", () => {
    const manifest = parseWallyToml(`
[dependencies]
Roact = "Roblox/roact@1.0.0"
`)
    const result = buildPesdeToml(manifest)
    expect(result.pesdeToml).toContain('name = "user/migrated"')
    expect(result.pesdeToml).toContain('version = "0.1.0"')
  })

  it("emits no [dependencies] block when there are no shared / server deps", () => {
    const manifest = parseWallyToml(`
[package]
name = "u/r"
version = "0.1.0"
realm = "shared"

[dev-dependencies]
TestEZ = "Roblox/testez@^0.4.0"
`)
    const result = buildPesdeToml(manifest)
    expect(result.pesdeToml).not.toMatch(/^\[dependencies\]$/m)
    expect(result.pesdeToml).toContain("[dev_dependencies]")
  })

  it("escapes embedded quotes and backslashes in TOML strings", () => {
    const manifest = parseWallyToml(`
[package]
name = "u/r"
version = "0.1.0"
realm = "shared"
description = "Has a \\"quoted\\" word"
`)
    const result = buildPesdeToml(manifest)
    expect(result.pesdeToml).toContain('description = "Has a \\"quoted\\" word"')
  })

  it("round-trips \\n / \\t escape sequences without doubling the backslash", () => {
    const manifest = parseWallyToml(`
[package]
name = "u/r"
version = "0.1.0"
realm = "shared"
description = "first line\\nsecond\\ttabbed"
`)
    const result = buildPesdeToml(manifest)
    // The decoded value contains an actual newline + tab. The emitter then
    // re-encodes them as \n / \t so the resulting pesde.toml is valid.
    expect(manifest.description).toBe("first line\nsecond\ttabbed")
    expect(result.pesdeToml).toContain('description = "first line\\nsecond\\ttabbed"')
  })

  it("flags duplicate alias across realms as unmapped instead of emitting duplicate keys", () => {
    const manifest = parseWallyToml(`
[package]
name = "u/r"
version = "0.1.0"
realm = "shared"

[dependencies]
Net = "Roblox/net@^1.0.0"

[server-dependencies]
Net = "Roblox/net-server@^1.0.0"
`)
    const result = buildPesdeToml(manifest)
    // First Net wins; second goes to unmapped so the output is valid TOML.
    expect(result.pesdeToml).toContain('Net = { wally = "Roblox/net", version = "^1.0.0" }')
    expect(result.unmappedDependencies).toContainEqual(
      expect.objectContaining({ alias: "Net", realm: "server" })
    )
    // Sanity: only one assignment to Net (no duplicate-key emission).
    const assignments = result.pesdeToml.match(/^Net = /gm) ?? []
    expect(assignments).toHaveLength(1)
  })

  it("flags aliases that aren't TOML bare keys as unmapped", () => {
    const manifest: import("../electron/file/wally-migration").WallyManifest = {
      packageName: "u/r",
      version: "0.1.0",
      realm: "shared",
      description: null,
      license: null,
      authors: [],
      dependencies: { "weird name": "scope/name@1.0.0" },
      serverDependencies: {},
      devDependencies: {}
    }
    const result = buildPesdeToml(manifest)
    expect(result.unmappedDependencies).toContainEqual(
      expect.objectContaining({ alias: "weird name" })
    )
    expect(result.pesdeToml).not.toMatch(/^weird name = /m)
  })
})
