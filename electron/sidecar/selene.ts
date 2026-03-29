import { spawnSidecar } from "./index"

export interface SelEneDiagnostic {
  file: string
  line: number
  col: number
  severity: "error" | "warning" | "info"
  message: string
  code: string
}

export async function lintFile(filePath: string, projectRoot?: string): Promise<SelEneDiagnostic[]> {
  return new Promise((resolve) => {
    const output: string[] = []

    const sidecar = spawnSidecar("selene", ["--display-style=json2", filePath], {
      cwd: projectRoot,
      onData: (data) => output.push(data),
      onError: (data) => output.push(data)
    })

    sidecar.process.on("exit", () => {
      try {
        const raw = output.join("")
        const diags: SelEneDiagnostic[] = []
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line)
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
        resolve(diags)
      } catch {
        resolve([])
      }
    })
  })
}
