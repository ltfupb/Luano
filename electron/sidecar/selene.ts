import { existsSync } from "fs"
import { dirname, join } from "path"
import { spawnSidecar, type SidecarProcess } from "./index"
import { log } from "../logger"

export interface SelEneDiagnostic {
  file: string
  line: number
  col: number
  severity: "error" | "warning" | "info"
  message: string
  code: string
}

/** Walk up from startDir to find the directory containing selene.toml */
function findSeleneRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, "selene.toml"))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

const LINT_TIMEOUT_MS = 30_000

class LintTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TimeoutError"
  }
}

export async function lintFile(filePath: string, projectRoot?: string): Promise<SelEneDiagnostic[]> {
  const cwd = findSeleneRoot(projectRoot ?? dirname(filePath))

  // Capture the sidecar handle outside the promise so the timeout branch
  // can kill the child process. Previously a hung or pathological config
  // left the process alive — every save spawned a new one, orphaning the
  // old, leaking PIDs + sockets across a long session.
  // Use an object wrapper so TS control-flow analysis doesn't narrow the
  // reassignment inside the Promise executor back down to `never`.
  const sidecarRef: { current: SidecarProcess | null } = { current: null }

  const lintPromise = new Promise<SelEneDiagnostic[]>((resolve, reject) => {
    const output: string[] = []

    let sidecar: SidecarProcess
    try {
      sidecar = spawnSidecar("selene", ["--display-style=json2", filePath], {
        cwd,
        onData: (data) => output.push(data),
        onError: (data) => output.push(data)
      })
    } catch (err) {
      log.error("[selene] spawn failed:", err)
      reject(err)
      return
    }
    sidecarRef.current = sidecar

    sidecar.process.on("exit", (code) => {
      try {
        const raw = output.join("")
        const diags: SelEneDiagnostic[] = []
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line)
            // selene json2 emits Diagnostic, Summary, and InvalidConfig records.
            // Only Diagnostic carries a real lint hit — Summary and
            // InvalidConfig have no primary_label and empty code, which the
            // formatter would otherwise render as a phantom `WARNING line 1:
            // []` and the agent would (correctly) describe as "empty [] tag
            // on the --!strict line, false positive." Filter on type to drop
            // them. Pre-json2 output has no type field — fall through.
            if (parsed.type && parsed.type !== "Diagnostic") continue
            diags.push({
              file: filePath,
              line: parsed.primary_label?.span?.start_line ?? 1,
              col: parsed.primary_label?.span?.start_column ?? 1,
              severity: parsed.severity === "Error" ? "error" : "warning",
              message: parsed.message ?? "",
              code: parsed.code ?? ""
            })
          } catch {}
        }
        log.debug(`[selene] ${filePath}: ${diags.length} diag(s) (exit=${code})`)
        resolve(diags)
      } catch (err) {
        log.warn(`[selene] parse error for ${filePath}:`, err)
        resolve([])
      }
    })
  })

  // Race against a 30s timeout so a hung sidecar process doesn't leave
  // the promise pending forever (would leak watchers' handleFileChange
  // awaits across every save).
  let timeoutHandle: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<SelEneDiagnostic[]>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new LintTimeoutError(`selene lint timed out after ${LINT_TIMEOUT_MS}ms`)),
      LINT_TIMEOUT_MS
    )
  })

  try {
    return await Promise.race([lintPromise, timeoutPromise])
  } catch (err) {
    // Timeout fired — kill the sidecar so it doesn't linger. Also runs
    // for other rejections; kill() is a no-op if already exited.
    sidecarRef.current?.kill()
    log.warn(`[selene] lint failed for ${filePath}:`, err)
    throw err
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
