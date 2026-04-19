#!/usr/bin/env node
/**
 * scripts/generate-third-party-licenses.js
 *
 * Walks every production dependency (direct + transitive), reads each
 * package's LICENSE file, and concatenates them into one text blob shipped
 * as resources/THIRD_PARTY_LICENSES.txt. This satisfies the notice-
 * preservation clauses of MIT / Apache-2.0 / BSD that require the original
 * copyright + permission text travel with any binary redistribution.
 *
 * Re-run with `npm run licenses` whenever dependencies change.
 */

const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const ROOT = path.join(__dirname, "..")
const OUT = path.join(ROOT, "resources", "THIRD_PARTY_LICENSES.txt")

// License filenames differ across packages. British spelling, dotted
// extensions, all-lowercase, etc. Try them in order; first hit wins.
const LICENSE_FILES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "license",
  "license.md",
  "license.txt"
]

function collectProdDeps() {
  // `npm ls --prod --all --json` gives us the entire transitive closure of
  // production deps, including ones that won't make it into the bundle
  // (we externalize aggressively). Over-including in a licenses file is
  // never a violation — under-including is — so err on the inclusive side.
  //
  // npm ls exits non-zero on peer-dep warnings or missing optionals even
  // though it still prints a usable tree on stdout. We swallow the non-zero
  // exit via try/catch and keep reading what npm gave us. If stdout is
  // empty too, that's a real failure and we bail.
  let raw = ""
  try {
    raw = execSync("npm ls --prod --all --json", {
      encoding: "utf-8",
      cwd: ROOT,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    })
  } catch (err) {
    raw = (err && err.stdout && err.stdout.toString()) || ""
    if (!raw) throw err
  }

  const tree = JSON.parse(raw)
  const names = new Set()
  const seen = new Set()  // guard against circular dep metadata

  function walk(deps, depth) {
    if (!deps || depth > 50) return  // defensive depth cap
    for (const [name, info] of Object.entries(deps)) {
      // Reject anything that could path-traverse out of node_modules/.
      // npm itself forbids these names, but this JSON is parsed from a
      // subprocess's stdout — treat it as semi-trusted.
      if (name.includes("..") || name.includes("/") && !name.startsWith("@")) continue
      if (seen.has(name)) continue
      seen.add(name)
      names.add(name)
      if (info && info.dependencies) walk(info.dependencies, depth + 1)
    }
  }
  walk(tree.dependencies, 0)
  return Array.from(names).sort()
}

function findLicenseFile(pkgDir) {
  for (const candidate of LICENSE_FILES) {
    const p = path.join(pkgDir, candidate)
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
  }
  return null
}

function readPkgJson(pkgDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"))
  } catch {
    return {}
  }
}

function main() {
  const deps = collectProdDeps()
  const entries = []
  const missing = []

  for (const name of deps) {
    const pkgDir = path.join(ROOT, "node_modules", name)
    if (!fs.existsSync(pkgDir)) continue

    const pkg = readPkgJson(pkgDir)
    const licenseFile = findLicenseFile(pkgDir)

    if (!licenseFile) {
      missing.push(`${name}@${pkg.version || "?"} (${pkg.license || "?"})`)
      continue
    }

    const licenseText = fs.readFileSync(licenseFile, "utf-8").trim()
    const header =
      "=".repeat(72) +
      "\n" +
      `${name}@${pkg.version || "?"}\n` +
      (pkg.license ? `License: ${pkg.license}\n` : "") +
      (pkg.homepage ? `Homepage: ${pkg.homepage}\n` : pkg.repository?.url ? `Repository: ${pkg.repository.url}\n` : "") +
      "=".repeat(72) +
      "\n\n"

    entries.push(header + licenseText + "\n\n")
  }

  // CC BY 4.0 for the Roblox docs snapshot lives in a non-npm location.
  // Inline it so the file is self-contained.
  const robloxDocs =
    "=".repeat(72) +
    "\n" +
    "Roblox Creator Documentation (bundled as roblox_docs.db)\n" +
    "License: CC BY 4.0\n" +
    "Copyright: © Roblox Corporation\n" +
    "Source: https://github.com/Roblox/creator-docs\n" +
    "=".repeat(72) +
    "\n\n" +
    "This work is licensed under the Creative Commons Attribution 4.0\n" +
    "International License. To view a copy of this license, visit\n" +
    "https://creativecommons.org/licenses/by/4.0/ or send a letter to\n" +
    "Creative Commons, PO Box 1866, Mountain View, CA 94042, USA.\n\n" +
    "The bundled file roblox_docs.db is an indexed snapshot of the\n" +
    "documentation at create.roblox.com/docs, prepared for offline AI\n" +
    "context retrieval. Individual result rows retain the upstream URL in\n" +
    "their `url` column so attribution points back to the original page.\n\n"

  const header =
    "Luano third-party software licenses\n" +
    "=" .repeat(72) + "\n\n" +
    "This file accompanies the Luano binary to satisfy the notice-\n" +
    "preservation obligations of MIT / Apache-2.0 / BSD and similar\n" +
    "permissive licenses of the packages bundled in the application.\n\n" +
    `Generated: ${new Date().toISOString()}\n` +
    `Packages: ${entries.length}\n\n` +
    "Documentation attribution\n" +
    "-".repeat(72) + "\n\n" +
    robloxDocs +
    "\n\nBundled npm packages\n" +
    "-".repeat(72) + "\n\n"

  // Some packages ship only an SPDX identifier in package.json and no
  // LICENSE file. We can't reproduce the full notice here, but we can at
  // least record the SPDX id + repo link so a reader can track down the
  // original. Keeps the audit trail honest instead of silently dropping them.
  let missingBlock = ""
  if (missing.length) {
    missingBlock =
      "\n\nPackages without a LICENSE file in the package tarball\n" +
      "-".repeat(72) + "\n\n" +
      "The following packages declare an SPDX license identifier in their\n" +
      "package.json but did not ship a LICENSE file. The identifier below\n" +
      "governs; the full license text is available at spdx.org/licenses.\n\n" +
      missing.map((m) => `  - ${m}`).join("\n") +
      "\n"
  }

  fs.writeFileSync(OUT, header + entries.join("") + missingBlock, "utf-8")

  const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(1)
  console.log(`Wrote ${entries.length} license blocks + Roblox docs to THIRD_PARTY_LICENSES.txt (${sizeKb} KB)`)
  if (missing.length) {
    console.log(`\nNo LICENSE file found for ${missing.length} packages (SPDX id still recorded in package.json):`)
    for (const m of missing) console.log(`  - ${m}`)
  }
}

main()
