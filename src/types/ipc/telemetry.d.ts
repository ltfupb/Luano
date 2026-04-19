interface TelemetryApi {
  // AI sqlite collection (local only, opt-in)
  telemetryIsEnabled: () => Promise<boolean>
  telemetrySetEnabled: (enabled: boolean) => Promise<{ success: boolean }>
  telemetryStats: () => Promise<{ diffs: number; queries: number; errorFixes: number } | null>

  // Sentry crash reports (external, separate opt-in)
  crashReportsIsEnabled: () => Promise<boolean>
  crashReportsSetEnabled: (enabled: boolean) => Promise<{ success: boolean }>
  crashReportsIsPrompted: () => Promise<boolean>
  crashReportsMarkPrompted: () => Promise<{ success: boolean }>

  // Third-party license file (shell-opens bundled THIRD_PARTY_LICENSES.txt)
  licensesOpen: () => Promise<{ success: boolean; error?: string }>
}
