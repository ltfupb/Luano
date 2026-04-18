interface MiscApi {
  perfStats: () => Promise<{
    heapUsed: number
    heapTotal: number
    rss: number
    uptime: number
  }>
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  off: (channel: string) => void
  setZoomFactor: (factor: number) => void
  sentryGetContext: () => {
    anonymousId: string
    version: string
    environment: string
    telemetryEnabled: boolean
  } | null
}
