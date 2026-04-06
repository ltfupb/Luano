/**
 * electron/toolchain/darklua-runner.ts — Darklua code processor runner
 */

import { spawnSidecar } from "../sidecar"

interface RunResult {
  success: boolean
  output: string
}

export async function darkluaProcess(inputPath: string, outputPath?: string, configPath?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const args = ["process", inputPath]
    if (outputPath) args.push(outputPath)
    if (configPath) args.push("--config", configPath)

    const output: string[] = []
    try {
      const sidecar = spawnSidecar("darklua", args, {
        onData: (d) => output.push(d),
        onError: (d) => output.push(d)
      })
      sidecar.process.on("exit", (code) => {
        resolve({ success: code === 0, output: output.join("") })
      })
      sidecar.process.on("error", (err) => {
        resolve({ success: false, output: err.message })
      })
    } catch (err) {
      resolve({ success: false, output: (err as Error).message })
    }
  })
}
