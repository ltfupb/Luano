#!/usr/bin/env node
// translations.ts 안의 모든 `version: "Luano vX.Y.Z"` 문자열이
// package.json 버전과 일치하는지 텍스트 레벨로 검증.
// (이전 inline 스크립트는 .ts 를 require() 해서 깨졌음)

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
const v = pkg.version
const src = readFileSync(resolve(root, "src/i18n/translations.ts"), "utf8")

const totalRe = /version: "Luano v[^"]+"/g
const matchRe = new RegExp(`version: "Luano v${v.replace(/\./g, "\\.")}"`, "g")

const total = (src.match(totalRe) || []).length
const matched = (src.match(matchRe) || []).length

if (total === 0) {
  console.error("translations.ts: no `version: \"Luano v...\"` line found")
  process.exit(1)
}

if (total !== matched) {
  console.error(
    `translations.ts version mismatch: ${matched}/${total} locales at v${v}`,
  )
  process.exit(1)
}

console.log(`translations version ok: v${v} (${total} locales)`)
