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
  platform: NodeJS.Platform
  setTitleBarOverlay: (opts: { color: string; symbolColor: string }) => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  sentryGetContext: () => {
    anonymousId: string
    version: string
    environment: string
    crashReportsEnabled: boolean
    analyticsEnabled: boolean
  } | null
  analyticsUsageIsEnabled: () => Promise<boolean>
  analyticsUsageSetEnabled: (enabled: boolean) => Promise<{ success: boolean }>
}
