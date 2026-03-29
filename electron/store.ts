import { app } from "electron"
import { join } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"

// electron-store 대체 — 단순 JSON 파일 기반 저장소
class SimpleStore {
  private data: Record<string, unknown> = {}
  private filePath: string

  constructor(name = "config") {
    const userDataPath = app.getPath("userData")
    mkdirSync(userDataPath, { recursive: true })
    this.filePath = join(userDataPath, `${name}.json`)
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        this.data = JSON.parse(readFileSync(this.filePath, "utf-8"))
      }
    } catch {
      this.data = {}
    }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8")
    } catch {}
  }

  get<T>(key: string): T | undefined {
    return this.data[key] as T | undefined
  }

  set(key: string, value: unknown): void {
    this.data[key] = value
    this.save()
  }

  delete(key: string): void {
    delete this.data[key]
    this.save()
  }
}

export const store = new SimpleStore()
