#!/usr/bin/env node
// Usage: node scripts/bump.mjs <patch|minor|major|x.y.z> [-- "Release summary"]
//
// 1) `npm version <bump> --no-git-tag-version` (package.json + package-lock.json)
// 2) src/i18n/translations.ts 의 `version: "Luano vX.Y.Z"` 두 줄 치환
// 3) CLAUDE.md 릴리즈 히스토리 맨 위에 placeholder 한 줄 삽입
//    (요약 인자가 있으면 채우고, 없으면 TODO 로 둠)

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const args = process.argv.slice(2)
const sepIdx = args.indexOf("--")
const bumpArg = args[0]
const summary =
  sepIdx >= 0 ? args.slice(sepIdx + 1).join(" ").trim() : ""

if (!bumpArg) {
  console.error('usage: npm run bump -- <patch|minor|major|x.y.z> [-- "Summary"]')
  process.exit(1)
}

// 1) bump (lock file included)
// H3: use execFileSync instead of execSync to prevent shell injection when
// bumpArg is user-supplied. No shell expansion — args passed as array.
execFileSync("npm", ["version", bumpArg, "--no-git-tag-version"], {
  cwd: root,
  stdio: "inherit",
})

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
const v = pkg.version
console.log(`→ new version: v${v}`)

// 2) translations.ts
const tPath = resolve(root, "src/i18n/translations.ts")
const before = readFileSync(tPath, "utf8")
const after = before.replace(/version: "Luano v[^"]+"/g, `version: "Luano v${v}"`)
if (before === after) {
  console.error("translations.ts: no version line matched")
  process.exit(1)
}
writeFileSync(tPath, after)
console.log(`→ translations.ts updated (${(before.match(/version: "Luano v/g) || []).length} lines)`)

// 3) CLAUDE.md release history
const cPath = resolve(root, "CLAUDE.md")
const claude = readFileSync(cPath, "utf8")
const marker = "## 릴리즈 히스토리\n\n"
const idx = claude.indexOf(marker)
if (idx === -1) {
  console.error("CLAUDE.md: '## 릴리즈 히스토리' 섹션을 찾지 못함")
  process.exit(1)
}
const insertAt = idx + marker.length
const line = `- **v${v}** — ${summary || "TODO summary"}\n`
const claudeNext = claude.slice(0, insertAt) + line + claude.slice(insertAt)
writeFileSync(cPath, claudeNext)
console.log(`→ CLAUDE.md release history: ${line.trim()}`)

console.log(`\nnext steps:`)
console.log(`  - CLAUDE.md 요약 채우기${summary ? " (이미 채움)" : ""}`)
console.log(`  - npm run check-version-sync`)
console.log(`  - 검증 → commit → tag v${v}`)
