/**
 * electron/toolchain/package-runner.ts — Wally/Pesde package manager runner
 */

import { spawnSidecar } from "../sidecar"
import { getActiveTool } from "./config"

interface RunResult {
  success: boolean
  output: string
}

function runCommand(tool: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const output: string[] = []
    try {
      const sidecar = spawnSidecar(tool, args, {
        cwd,
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

export async function packageInstall(projectPath: string): Promise<RunResult> {
  const tool = getActiveTool("package-manager", projectPath)
  if (!tool) return { success: false, output: "No package manager configured" }
  return runCommand(tool, ["install"], projectPath)
}

export async function packageInit(projectPath: string): Promise<RunResult> {
  const tool = getActiveTool("package-manager", projectPath)
  if (!tool) return { success: false, output: "No package manager configured" }
  return runCommand(tool, ["init"], projectPath)
}
