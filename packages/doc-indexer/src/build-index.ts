/**
 * Roblox API Docs Indexer
 *
 * 실행 방법:
 *   cd packages/doc-indexer
 *   npm install
 *   npm run build
 *
 * 결과: ../../resources/roblox-docs/roblox_docs.db
 *
 * 소스: Roblox ClientTracker API Dump (JSON)
 */

import * as https from "https"
import * as fs from "fs"
import * as path from "path"
import Database from "better-sqlite3"

const API_DUMP_URL =
  "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json"

const OUT_DIR = path.join(__dirname, "../../../resources/roblox-docs")
const DB_PATH = path.join(OUT_DIR, "roblox_docs.db")

interface ApiMember {
  MemberType: string
  Name: string
  Parameters?: Array<{ Name: string; Type: { Name: string } }>
  ReturnType?: { Name: string }
  ValueType?: { Name: string }
  EventType?: unknown
  Description?: string
  Tags?: string[]
}

interface ApiClass {
  Name: string
  Superclass?: string
  Members: ApiMember[]
  Description?: string
  Tags?: string[]
}

interface ApiDump {
  Classes: ApiClass[]
  Enums?: Array<{ Name: string; Items: Array<{ Name: string; Value: number }> }>
}

function fetchJson(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => resolve(data))
        res.on("error", reject)
      })
      .on("error", reject)
  })
}

function memberSignature(cls: string, member: ApiMember): string {
  if (member.MemberType === "Function") {
    const params =
      member.Parameters?.map((p) => `${p.Name}: ${p.Type?.Name ?? "any"}`).join(", ") ?? ""
    const ret = member.ReturnType?.Name ?? "void"
    return `${cls}:${member.Name}(${params}): ${ret}`
  }
  if (member.MemberType === "Event") {
    const params =
      member.Parameters?.map((p) => `${p.Name}: ${p.Type?.Name ?? "any"}`).join(", ") ?? ""
    return `${cls}.${member.Name}(${params}) [Event]`
  }
  if (member.MemberType === "Property") {
    return `${cls}.${member.Name}: ${member.ValueType?.Name ?? "any"} [Property]`
  }
  return `${cls}.${member.Name}`
}

async function main(): Promise<void> {
  console.log("Fetching Roblox API dump...")
  const raw = await fetchJson(API_DUMP_URL)
  const dump: ApiDump = JSON.parse(raw)

  fs.mkdirSync(OUT_DIR, { recursive: true })

  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  const db = new Database(DB_PATH)

  // 일반 docs 테이블 + FTS5 가상 테이블
  db.exec(`
    CREATE TABLE docs (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      url TEXT
    );
    CREATE VIRTUAL TABLE docs_fts USING fts5(title, content, url, content=docs, content_rowid=id);
  `)

  const insert = db.prepare("INSERT INTO docs (title, content, url) VALUES (?, ?, ?)")
  const insertFts = db.prepare(
    "INSERT INTO docs_fts (rowid, title, content, url) VALUES (?, ?, ?, ?)"
  )

  let count = 0

  // 클래스별 문서 생성
  for (const cls of dump.Classes) {
    if (cls.Tags?.includes("Deprecated")) continue

    const clsTitle = cls.Name
    const memberLines = cls.Members.filter((m) => !m.Tags?.includes("Deprecated"))
      .map((m) => `  ${memberSignature(cls.Name, m)}`)
      .join("\n")

    const content = `Class: ${cls.Name}${cls.Superclass ? ` extends ${cls.Superclass}` : ""}\n\nMembers:\n${memberLines}`
    const url = `https://create.roblox.com/docs/reference/engine/classes/${cls.Name}`

    const info = insert.run(clsTitle, content, url)
    insertFts.run(info.lastInsertRowid, clsTitle, content, url)
    count++

    // 중요 멤버는 개별 항목으로도 인덱싱
    for (const member of cls.Members) {
      if (member.Tags?.includes("Deprecated")) continue
      if (member.MemberType === "Property") continue // 프로퍼티는 너무 많음

      const memberTitle = `${cls.Name}.${member.Name}`
      const memberContent = memberSignature(cls.Name, member)
      const memberInfo = insert.run(memberTitle, memberContent, url)
      insertFts.run(memberInfo.lastInsertRowid, memberTitle, memberContent, url)
      count++
    }
  }

  // 인덱스 재빌드
  db.exec("INSERT INTO docs_fts(docs_fts) VALUES ('rebuild')")
  db.close()

  console.log(`Done! Indexed ${count} entries → ${DB_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
