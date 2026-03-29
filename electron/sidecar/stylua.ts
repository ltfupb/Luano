import { spawnSidecar } from "./index"
import { readFileSync, writeFileSync } from "fs"

export async function formatFile(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sidecar = spawnSidecar("stylua", [filePath])
    sidecar.process.on("exit", (code) => resolve(code === 0))
  })
}

export async function formatContent(content: string): Promise<string> {
  return new Promise((resolve) => {
    const output: string[] = []
    const sidecar = spawnSidecar("stylua", ["-"], {
      onData: (data) => output.push(data)
    })

    sidecar.process.stdin?.write(content)
    sidecar.process.stdin?.end()

    sidecar.process.on("exit", (code) => {
      if (code === 0) {
        resolve(output.join(""))
      } else {
        resolve(content) // 포맷 실패 시 원본 반환
      }
    })
  })
}
