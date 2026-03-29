// src/hooks/useFileWatcher.ts
// React hook for file system change events from the Electron watcher

import { useEffect } from "react"
import { useIpcEvent } from "./useIpc"

export interface FileWatcherCallbacks {
  onAdded?: (path: string) => void
  onRemoved?: (path: string) => void
  onChanged?: (path: string) => void
}

/**
 * Subscribe to file system watcher events.
 * Automatically unsubscribes on unmount.
 */
export function useFileWatcher({ onAdded, onRemoved, onChanged }: FileWatcherCallbacks): void {
  useIpcEvent("file:added", (path) => {
    onAdded?.(path as string)
  })

  useIpcEvent("file:removed", (path) => {
    onRemoved?.(path as string)
  })

  useIpcEvent("file:changed", (path) => {
    onChanged?.(path as string)
  })
}

/**
 * Refresh a file tree when any watched file changes.
 * Convenience wrapper around useFileWatcher.
 */
export function useAutoRefresh(refresh: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const cleanup1 = window.api.on("file:added",   () => refresh())
    const cleanup2 = window.api.on("file:removed", () => refresh())
    return () => { cleanup1(); cleanup2() }
  }, [refresh, enabled])
}
