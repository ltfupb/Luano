import { spawnSidecar } from "./index"
import { log } from "../logger"

export async function formatFile(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let sidecar: ReturnType<typeof spawnSidecar>
    try {
      sidecar = spawnSidecar("stylua", [filePath])
    } catch (err) {
      log.error("[stylua] spawn failed:", err)
      resolve(false)
      return
    }
    sidecar.process.on("exit", (code) => {
      log.debug(`[stylua] format ${filePath} exit=${code}`)
      resolve(code === 0)
    })
  })
}

export async function formatContent(content: string): Promise<string> {
  return new Promise((resolve) => {
    const output: string[] = []
    let sidecar: ReturnType<typeof spawnSidecar>
    try {
      sidecar = spawnSidecar("stylua", ["-"], {
        onData: (data) => output.push(data)
      })
    } catch (err) {
      log.error("[stylua] spawn failed:", err)
      resolve(content)
      return
    }

    sidecar.process.stdin?.write(content)
    sidecar.process.stdin?.end()

    sidecar.process.on("exit", (code) => {
      log.debug(`[stylua] format-stdin exit=${code} (${content.length} → ${output.join("").length})`)
      if (code === 0) {
        resolve(output.join(""))
      } else {
        resolve(content) // Return original on format failure
      }
    })
  })
}
