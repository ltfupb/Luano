/**
 * scripts/download-binaries.ts
 *
 * Downloads sidecar binaries from GitHub Releases into resources/binaries/.
 * Run: npx ts-node scripts/download-binaries.ts [win|mac|linux|all]
 *
 * Uses curl (available on all CI runners) to handle redirects reliably.
 */

import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const VERSIONS = {
  rojo:       "7.6.1",
  selene:     "0.30.1",
  stylua:     "2.4.0",
  "luau-lsp": "1.64.0"
}

const TARGETS = {
  win: {
    rojo:       `https://github.com/rojo-rbx/rojo/releases/download/v${VERSIONS.rojo}/rojo-${VERSIONS.rojo}-windows-x86_64.zip`,
    selene:     `https://github.com/Kampfkarren/selene/releases/download/${VERSIONS.selene}/selene-${VERSIONS.selene}-windows.zip`,
    stylua:     `https://github.com/JohnnyMorganz/StyLua/releases/download/v${VERSIONS.stylua}/stylua-windows-x86_64.zip`,
    "luau-lsp": `https://github.com/JohnnyMorganz/luau-lsp/releases/download/${VERSIONS["luau-lsp"]}/luau-lsp-win64.zip`
  },
  mac: {
    rojo:       `https://github.com/rojo-rbx/rojo/releases/download/v${VERSIONS.rojo}/rojo-${VERSIONS.rojo}-macos-aarch64.zip`,
    selene:     `https://github.com/Kampfkarren/selene/releases/download/${VERSIONS.selene}/selene-${VERSIONS.selene}-macos.zip`,
    stylua:     `https://github.com/JohnnyMorganz/StyLua/releases/download/v${VERSIONS.stylua}/stylua-macos-aarch64.zip`,
    "luau-lsp": `https://github.com/JohnnyMorganz/luau-lsp/releases/download/${VERSIONS["luau-lsp"]}/luau-lsp-macos.zip`
  },
  linux: {
    rojo:       `https://github.com/rojo-rbx/rojo/releases/download/v${VERSIONS.rojo}/rojo-${VERSIONS.rojo}-linux-x86_64.zip`,
    selene:     `https://github.com/Kampfkarren/selene/releases/download/${VERSIONS.selene}/selene-${VERSIONS.selene}-linux.zip`,
    stylua:     `https://github.com/JohnnyMorganz/StyLua/releases/download/v${VERSIONS.stylua}/stylua-linux-x86_64.zip`,
    "luau-lsp": `https://github.com/JohnnyMorganz/luau-lsp/releases/download/${VERSIONS["luau-lsp"]}/luau-lsp-linux-x86_64.zip`
  }
}

const ROOT = path.join(__dirname, "..")
const TMP = path.join(ROOT, "tmp-bins")

function curlDownload(url: string, dest: string): void {
  execSync(`curl -fSL --retry 3 --retry-delay 2 -o "${dest}" "${url}"`, {
    stdio: "inherit",
    timeout: 120_000
  })
}

function extractZip(zipPath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  if (process.platform === "win32") {
    // Use tar (built into Windows 10+/Server 2019+) — more reliable than PowerShell Expand-Archive
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: "inherit" })
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "inherit" })
  }
}

async function downloadBinaries(platform: "win" | "mac" | "linux"): Promise<void> {
  const outDir = path.join(ROOT, "resources", "binaries", platform)
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(TMP, { recursive: true })

  const targets = TARGETS[platform]
  const ext = platform === "win" ? ".exe" : ""

  for (const [name, url] of Object.entries(targets)) {
    const outFile = path.join(outDir, `${name}${ext}`)
    if (fs.existsSync(outFile)) {
      console.log(`  ✓ ${name} already exists, skipping`)
      continue
    }

    console.log(`  ↓ ${name} (${platform})...`)

    // Download zip
    const zipPath = path.join(TMP, `${name}.zip`)
    curlDownload(url, zipPath)

    // Verify the file is not empty / corrupt
    const stat = fs.statSync(zipPath)
    if (stat.size < 1000) {
      throw new Error(`Downloaded file too small (${stat.size} bytes), likely corrupt: ${url}`)
    }

    // Extract
    const extracted = path.join(TMP, name)
    extractZip(zipPath, extracted)

    // Find the binary inside the extracted folder
    const files = fs.readdirSync(extracted).filter(f => !f.endsWith(".zip"))
    const binFile = files.find(f => f.startsWith(name) || f === name + ext || f === name)
    if (!binFile) {
      throw new Error(`Could not find binary in zip for ${name}. Files: ${files.join(", ")}`)
    }

    fs.copyFileSync(path.join(extracted, binFile), outFile)
    if (platform !== "win") {
      fs.chmodSync(outFile, 0o755)
    }

    console.log(`    ✓ ${name} → ${outFile}`)
  }

  // cleanup
  fs.rmSync(TMP, { recursive: true, force: true })
  console.log(`\n✅ ${platform} binaries ready in resources/binaries/${platform}/`)
}

// CLI usage: ts-node scripts/download-binaries.ts [win|mac|linux|all]
const arg = process.argv[2] ?? "all"
const platforms: Array<"win" | "mac" | "linux"> =
  arg === "all" ? ["win", "mac", "linux"] : [arg as "win" | "mac" | "linux"]

;(async () => {
  for (const p of platforms) {
    console.log(`\n[${p}]`)
    await downloadBinaries(p)
  }
})()
