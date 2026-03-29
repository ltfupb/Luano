import { useEffect } from "react"

export function useIpcEvent(channel: string, callback: (...args: unknown[]) => void): void {
  useEffect(() => {
    const cleanup = window.api.on(channel, callback)
    return cleanup
  }, [channel, callback])
}

export const api = {
  get: () => window.api
}
