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
}
