// scripts/afterPack.js
// electron-builder afterPack hook — removes files that can't be excluded via
// the build.files glob list (files inside asarUnpack or top-level Electron files).
//
// B) LICENSES.chromium.html        ~9 MB  (Chromium license, not user-facing)
// D) better-sqlite3/deps + src    ~9.8 MB  (C source, build-time only)
//    node-pty cross-platform prebuilds ~28 MB  (only current platform kept)

const { rm } = require("fs/promises")
const path = require("path")

/** @param {import('electron-builder').AfterPackContext} context */
module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context
  const rmrf = (p) => rm(p, { recursive: true, force: true })

  // ── B: Chromium license file ─────────────────────────────────────────────
  await rmrf(path.join(appOutDir, "LICENSES.chromium.html"))

  // ── D: better-sqlite3 C source (not needed at runtime) ──────────────────
  const bsqlite = path.join(
    appOutDir,
    "resources/app.asar.unpacked/node_modules/better-sqlite3"
  )
  await rmrf(path.join(bsqlite, "deps"))
  await rmrf(path.join(bsqlite, "src"))

  // ── D: node-pty — keep only the current platform + arch prebuild ─────────
  // electron-builder Arch enum: ia32=0, x64=1, armv7l=2, arm64=3, universal=9
  // Explicit mapping + throw on unknown: silently falling back to "x64" on a
  // new arch (e.g. universal = 9) would ship a broken prebuild layout.
  const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64" }
  const archName = ARCH_NAMES[arch]
  if (!archName) {
    throw new Error(`afterPack: unknown electron-builder Arch enum value ${arch}. Update ARCH_NAMES.`)
  }
  const keep = `${electronPlatformName}-${archName}`
  const prebuilds = path.join(
    appOutDir,
    "resources/app.asar.unpacked/node_modules/node-pty/prebuilds"
  )
  for (const dir of ["darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64"]) {
    if (dir !== keep) {
      await rmrf(path.join(prebuilds, dir))
    }
  }
}
