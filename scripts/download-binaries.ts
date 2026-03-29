/**
 * scripts/download-binaries.ts
 *
 * Downloads sidecar binaries from GitHub Releases into resources/binaries/.
 * Run: npx ts-node scripts/download-binaries.ts
 *
 * Binary versions — update here when new versions release.
 */

import https from "https"
import fs from "fs"
import path from "path"
import { execSync } from "child_process"

const VERSIONS = {
  rojo:       "7.6.1",
  selene:     "0.30.1",
  stylua:     "2.4.0",
  "luau-lsp": "1.63.0"
}

const TARGETS = {
  win: {
    rojo:       `https://github.com/rojo-rbx/rojo/releases/download/v${VERSIONS.rojo}/rojo-${VERSIONS.rojo}-windows-x86_64.zip`,
    selene:     `https://github.com/Kampfkarren/selene/releases/download/${VERSIONS.selene}/selene-${VERSIONS.selene}-windows.zip`,
    stylua:     `https://github.com/JohnnyMorganz/StyLua/releases/download/v${VERSIONS.stylua}/stylua-windows-x86_64.zip`,
    "luau-lsp": `https://github.com/JohnnyMorganz/luau-lsp/releases/download/v${VERSIONS["luau-lsp"]}/luau-lsp-win64.zip`
  },
  mac: {
    rojo:       `https://github.com/rojo-rbx/rojo/releases/download/v${VERSIONS.rojo}/rojo-${VERSIONS.rojo}-macos-aarch64.zip`,
    selene:     `https://github.com/Kampfkarren/selene/releases/download/${VERSIONS.selene}/selene-${VERSIONS.selene}-macos.zip`,
    stylua:     `https://github.com/JohnnyMorganz/StyLua/releases/download/v${VERSIONS.stylua}/stylua-macos-aarch64.zip`,
    "luau-lsp": `https://github.com/JohnnyMorganz/luau-lsp/releases/download/v${VERSIONS["luau-lsp"]}/luau-lsp-macos.zip`
  },
  linux: {
    rojo:       `https://github.com/rojo-rbx/rojo/releases/download/v${VERSIONS.rojo}/rojo-${VERSIONS.rojo}-linux-x86_64.zip`,
    selene:     `https://github.com/Kampfkarren/selene/releases/download/${VERSIONS.selene}/selene-${VERSIONS.selene}-linux.zip`,
    stylua:     `https://github.com/JohnnyMorganz/StyLua/releases/download/v${VERSIONS.stylua}/stylua-linux-x86_64.zip`,
    "luau-lsp": `https://github.com/JohnnyMorganz/luau-lsp/releases/download/v${VERSIONS["luau-lsp"]}/luau-lsp-linux.zip`
  }
}

const ROOT = path.join(__dirname, "..")
const TMP = path.join(ROOT, "tmp-bins")

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close()
        fs.unlinkSync(dest)
        download(res.headers.location!, dest).then(resolve).catch(reject)
        return
      }
      res.pipe(file)
      file.on("finish", () => { file.close(); resolve() })
    }).on("error", (err) => {
      fs.unlinkSync(dest)
      reject(err)
    })
  })
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

    if (url.endsWith(".exe")) {
      await download(url, outFile)
    } else {
      // zip — download then extract
      const zipPath = path.join(TMP, `${name}.zip`)
      await download(url, zipPath)

      // Use system unzip/7z
      if (process.platform === "win32") {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${TMP}\\${name}' -Force"`)
      } else {
        execSync(`unzip -o "${zipPath}" -d "${TMP}/${name}"`)
      }

      // Find the binary inside the extracted folder
      const extracted = path.join(TMP, name)
      const files = fs.readdirSync(extracted).filter(f => !f.endsWith(".zip"))
      const binFile = files.find(f => f.startsWith(name) || f === name + ext || f === name)
      if (!binFile) {
        console.error(`    ✗ Could not find binary in zip for ${name}`)
        continue
      }

      fs.copyFileSync(path.join(extracted, binFile), outFile)
      if (platform !== "win") {
        fs.chmodSync(outFile, 0o755)
      }
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
