/**
 * Wally → pesde migration helper.
 *
 * pesde supports Wally packages natively through its `wally` source, so
 * migration here means: read wally.toml, write a pesde.toml that points at
 * the same packages via pesde's wally adapter, and surface what changed for
 * the user. We keep wally.toml on disk as a backup so the user can revert.
 *
 * The reader is intentionally minimal — it only handles the subset of TOML
 * that wally.toml actually uses (simple key/value pairs grouped under
 * `[section]` headers, single-line values quoted with `"`). Pulling in a
 * full TOML library would mean a new runtime dep, an externalize entry, and
 * an update to package-lock.json across all platforms — overkill for
 * parsing one well-known schema.
 */

export interface WallyManifest {
  packageName: string | null
  version: string | null
  realm: string | null
  description: string | null
  license: string | null
  authors: string[]
  dependencies: Record<string, string>
  serverDependencies: Record<string, string>
  devDependencies: Record<string, string>
}

const STRING_RE = /^"((?:[^"\\]|\\.)*)"$/
const ARRAY_RE = /^\[(.*)\]$/

/**
 * Strip a trailing TOML line comment, but never inside a quoted string.
 * `name = "foo" # bar` → `name = "foo"`. `name = "with#in"` stays whole.
 * Without this, parseValue treats the whole tail (including `#`) as the
 * literal value — common case `Roact = "scope/name@1.0" # UI` then breaks
 * downstream consumers (splitWallySpec finds the wrong `@`).
 */
function stripLineComment(s: string): string {
  let inQuote = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (inQuote && ch === "\\") { escape = true; continue }
    if (ch === "\"") { inQuote = !inQuote; continue }
    if (ch === "#" && !inQuote) return s.slice(0, i).trimEnd()
  }
  return s
}

/**
 * Decode the common TOML basic-string escape sequences: `\\`, `\"`, `\n`,
 * `\r`, `\t`. \u#### / \U######## unicode escapes are NOT handled — wally.toml
 * almost never uses them and supporting them would mean either a real TOML
 * parser or a far longer regex. Anything else (e.g. `\b`, `\f`) is left as
 * the literal backslash sequence so we don't silently drop bytes.
 */
function unescapeTomlString(s: string): string {
  return s.replace(/\\(["\\nrt])/g, (_, ch) => {
    switch (ch) {
      case "\"": return "\""
      case "\\": return "\\"
      case "n": return "\n"
      case "r": return "\r"
      case "t": return "\t"
      default: return ch
    }
  })
}

function parseValue(raw: string): string | string[] {
  const trimmed = stripLineComment(raw).trim()
  const stringMatch = STRING_RE.exec(trimmed)
  if (stringMatch) return unescapeTomlString(stringMatch[1])
  const arrayMatch = ARRAY_RE.exec(trimmed)
  if (arrayMatch) {
    return arrayMatch[1]
      .split(",")
      .map((item) => {
        const m = STRING_RE.exec(item.trim())
        return m ? unescapeTomlString(m[1]) : item.trim()
      })
      .filter((s) => s.length > 0)
  }
  return trimmed
}

/** Parse a wally.toml string into a structured manifest. */
export function parseWallyToml(source: string): WallyManifest {
  const manifest: WallyManifest = {
    packageName: null,
    version: null,
    realm: null,
    description: null,
    license: null,
    authors: [],
    dependencies: {},
    serverDependencies: {},
    devDependencies: {}
  }

  let section: "package" | "dependencies" | "server-dependencies" | "dev-dependencies" | null = null

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === "" || line.startsWith("#")) continue

    const sectionMatch = /^\[(.+)\]$/.exec(line)
    if (sectionMatch) {
      const name = sectionMatch[1].trim()
      if (name === "package" || name === "dependencies" || name === "server-dependencies" || name === "dev-dependencies") {
        section = name
      } else {
        section = null
      }
      continue
    }

    const eqIdx = line.indexOf("=")
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim()
    const value = parseValue(line.slice(eqIdx + 1))

    if (section === "package") {
      if (key === "name" && typeof value === "string") manifest.packageName = value
      else if (key === "version" && typeof value === "string") manifest.version = value
      else if (key === "realm" && typeof value === "string") manifest.realm = value
      else if (key === "description" && typeof value === "string") manifest.description = value
      else if (key === "license" && typeof value === "string") manifest.license = value
      else if (key === "authors" && Array.isArray(value)) manifest.authors = value
      // Other [package] fields (private, registry, exclude, etc.) are
      // intentionally ignored — the converter only emits what pesde needs.
    } else if (section === "dependencies" || section === "server-dependencies" || section === "dev-dependencies") {
      // Only accept properly-formatted Wally string specs. If the value is
      // an inline table (`{ ... }`), a number, a boolean, or any other shape
      // parseValue couldn't decode as a quoted string, the spec is recorded
      // as the raw text so the migration step can flag it as unmapped — this
      // surfaces the problem to the user instead of silently producing a
      // broken pesde.toml.
      if (typeof value === "string") {
        const target = section === "dependencies" ? manifest.dependencies
          : section === "server-dependencies" ? manifest.serverDependencies
          : manifest.devDependencies
        target[key] = value
      }
    }
  }

  return manifest
}

/**
 * Split a Wally dependency spec like `Roblox/roact@^1.4.4` into
 * `{ wallyPackage, version }`. Wally uses `<scope>/<name>@<version>`.
 */
export function splitWallySpec(spec: string): { wallyPackage: string; version: string } | null {
  const at = spec.lastIndexOf("@")
  if (at === -1) return null
  const wallyPackage = spec.slice(0, at).trim()
  const version = spec.slice(at + 1).trim()
  if (wallyPackage.length === 0 || version.length === 0) return null
  return { wallyPackage, version }
}

/**
 * Escape a string for a TOML double-quoted value. Order matters: backslash
 * first so the subsequent escapes don't double up. Control chars (\n, \r,
 * \t) get escape-sequence form because TOML basic strings forbid raw control
 * bytes in the literal — a description carried over from wally.toml that
 * actually contained a newline would otherwise produce an invalid pesde.toml.
 */
function tomlString(s: string): string {
  return `"${s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`
}

/**
 * TOML "bare key" set: letters, digits, underscore, hyphen. Anything else
 * (whitespace, `=`, quotes, dots) needs quoted-key syntax which pesde may or
 * may not accept consistently. We refuse to emit such aliases and surface
 * them as unmapped so the user sees a manual-fix request rather than a
 * silently malformed pesde.toml.
 */
const BARE_KEY_RE = /^[A-Za-z0-9_-]+$/

export interface MigrationResult {
  pesdeToml: string
  /** Dependencies that couldn't be parsed (kept as raw strings under #migration-failed). */
  unmappedDependencies: { realm: "shared" | "server" | "dev"; alias: string; raw: string }[]
  /** Counts for the post-migration toast. */
  migratedCount: number
}

/**
 * Convert a parsed wally manifest into a pesde.toml string. Uses pesde's
 * native Wally adapter (`{ wally = "<scope>/<name>", version = "<range>" }`)
 * so the dependencies resolve from the same Wally registry the user was
 * already on — no separate "find the equivalent on pesde index" step.
 *
 * Wally's `[server-dependencies]` and `[dev-dependencies]` are mapped to
 * pesde's `target = "roblox_server"` / `target = "roblox_dev"` respectively.
 * `[dependencies]` is shared (default target).
 */
export function buildPesdeToml(manifest: WallyManifest): MigrationResult {
  const unmapped: MigrationResult["unmappedDependencies"] = []
  let count = 0

  const lines: string[] = []
  // Pesde requires `name`, `version`. Fall back to the wally name (with
  // sensible defaults) if either is missing in the source.
  const name = manifest.packageName ?? "user/migrated"
  const version = manifest.version ?? "0.1.0"
  lines.push(`name = ${tomlString(name)}`)
  lines.push(`version = ${tomlString(version)}`)
  if (manifest.description) lines.push(`description = ${tomlString(manifest.description)}`)
  if (manifest.license) lines.push(`license = ${tomlString(manifest.license)}`)
  if (manifest.authors.length > 0) {
    lines.push(`authors = [${manifest.authors.map(tomlString).join(", ")}]`)
  }
  lines.push("")
  lines.push("[indices]")
  lines.push(`default = ${tomlString("https://github.com/pesde-pkg/index")}`)
  lines.push("")
  lines.push("[wally_indices]")
  lines.push(`default = ${tomlString("https://github.com/UpliftGames/wally-index")}`)
  lines.push("")

  // Track aliases already emitted so a Wally project that re-declared the
  // same key under both `[dependencies]` and `[server-dependencies]` doesn't
  // produce a duplicate-key block in pesde's single `[dependencies]` table —
  // pesde would refuse to read that manifest. Same alias the second time
  // becomes an unmapped entry instead.
  const emittedAliases = new Set<string>()
  const emitDep = (
    alias: string,
    raw: string,
    realm: "shared" | "server" | "dev",
    target: string | null
  ): void => {
    if (!BARE_KEY_RE.test(alias)) {
      unmapped.push({ realm, alias, raw })
      lines.push(`# ${tomlString(alias)} = ${tomlString(raw)}  # alias contains characters that are not safe as a TOML bare key`)
      return
    }
    if (emittedAliases.has(alias)) {
      unmapped.push({ realm, alias, raw })
      lines.push(`# ${alias} = ${tomlString(raw)}  # duplicate alias across realms — pesde forbids duplicate keys in [dependencies]`)
      return
    }
    const split = splitWallySpec(raw)
    if (!split) {
      unmapped.push({ realm, alias, raw })
      lines.push(`# ${alias} = ${tomlString(raw)}  # could not parse <scope/name@version>`)
      return
    }
    const targetSuffix = target ? `, target = ${tomlString(target)}` : ""
    lines.push(`${alias} = { wally = ${tomlString(split.wallyPackage)}, version = ${tomlString(split.version)}${targetSuffix} }`)
    emittedAliases.add(alias)
    count += 1
  }

  // pesde groups runtime + server deps under [dependencies] (target
  // distinguishes realm), and dev deps under [dev_dependencies]. Emitting
  // the same TOML section header twice would be invalid, so we collapse
  // shared + server into one [dependencies] block.
  const sharedAliases = Object.keys(manifest.dependencies)
  const serverAliases = Object.keys(manifest.serverDependencies)
  if (sharedAliases.length > 0 || serverAliases.length > 0) {
    lines.push("[dependencies]")
    for (const alias of sharedAliases) emitDep(alias, manifest.dependencies[alias], "shared", null)
    for (const alias of serverAliases) emitDep(alias, manifest.serverDependencies[alias], "server", "roblox_server")
    lines.push("")
  }
  const devAliases = Object.keys(manifest.devDependencies)
  if (devAliases.length > 0) {
    lines.push("[dev_dependencies]")
    for (const alias of devAliases) emitDep(alias, manifest.devDependencies[alias], "dev", null)
    lines.push("")
  }

  return {
    pesdeToml: lines.join("\n").trimEnd() + "\n",
    unmappedDependencies: unmapped,
    migratedCount: count
  }
}
