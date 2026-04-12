interface TelemetryApi {
  telemetryIsEnabled: () => Promise<boolean>
  telemetrySetEnabled: (enabled: boolean) => Promise<{ success: boolean }>
  telemetryStats: () => Promise<{ diffs: number; queries: number; errorFixes: number } | null>
}
