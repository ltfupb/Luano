import { spawnSidecar } from "./index"
import { log } from "../logger"

export interface OneShotResult {
  exitCode: number
  output: string
}

export const RUN_TIMEOUT_MS = 5 * 60 * 1000

// Cap merged stdout+stderr — a misbehaving package manager (or a hostile
// registry response) producing GB of output would otherwise OOM the main
// process and overflow the IPC payload sent to the renderer. 1 MB is more
// than enough for real install / add output; anything beyond is truncated
// with a marker so the caller still has a recognisable result.
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024
const OUTPUT_TRUNCATED_MARKER = "\n[output truncated — exceeded 1 MB cap]\n"

export class CommandTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TimeoutError"
  }
}

/**
 * Run a one-shot CLI sidecar (no daemon — process exits when the command
 * completes). stdout + stderr are merged into `output` for the caller to
 * surface to the user. Output is capped at 1 MB and the process is killed
 * after RUN_TIMEOUT_MS to bound resource use.
 */
export async function runOneShotCli(
  binary: string,
  args: string[],
  cwd: string
): Promise<OneShotResult> {
  return new Promise<OneShotResult>((resolve, reject) => {
    let settled = false
    const chunks: string[] = []
    let bytes = 0
    let truncated = false
    const append = (data: string): void => {
      if (truncated) return
      if (bytes + data.length > MAX_OUTPUT_BYTES) {
        chunks.push(data.slice(0, MAX_OUTPUT_BYTES - bytes))
        chunks.push(OUTPUT_TRUNCATED_MARKER)
        truncated = true
        return
      }
      chunks.push(data)
      bytes += data.length
    }

    log.info(`[${binary}] run ${args.join(" ")} (cwd=${cwd})`)
    const t0 = Date.now()
    let sidecar: ReturnType<typeof spawnSidecar>
    try {
      sidecar = spawnSidecar(binary, args, {
        cwd,
        onData: append,
        onError: append
      })
    } catch (err) {
      // spawn failures (missing binary, permission denied) would otherwise
      // surface only as a rejected promise with no record on disk.
      log.error(`[${binary}] spawn failed:`, err)
      reject(err)
      return
    }

    const timeoutHandle = setTimeout(() => {
      if (settled) return
      settled = true
      sidecar.kill()
      log.warn(`[${binary}] timed out after ${RUN_TIMEOUT_MS}ms`)
      reject(new CommandTimeoutError(`${binary} ${args.join(" ")} timed out after ${RUN_TIMEOUT_MS}ms`))
    }, RUN_TIMEOUT_MS)

    sidecar.process.on("exit", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      log.info(`[${binary}] exit code=${code} (${Date.now() - t0}ms)`)
      resolve({ exitCode: code ?? 1, output: chunks.join("") })
    })
  })
}
