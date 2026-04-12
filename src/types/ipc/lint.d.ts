interface LintApi {
  formatFile: (path: string) => Promise<{ success: boolean }>
  lintFile: (path: string) => Promise<unknown>
  batchFormatAll: (projectPath: string) => Promise<{ formatted: number; failed: number; total: number }>
  batchLintAll: (projectPath: string) => Promise<{
    results: Array<{ file: string; diagnostics: unknown }>
    total: number
  }>
}
