// src/hooks/useKeybindings.ts
// Global keyboard shortcut management

import { useEffect } from "react"

export interface Keybinding {
  key: string      // e.g. "k", "s", "`"
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
  handler: (e: KeyboardEvent) => void
}

/**
 * Register global keyboard shortcuts.
 * Runs cleanup on unmount.
 */
export function useKeybindings(bindings: Keybinding[]): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      for (const binding of bindings) {
        const ctrlMatch  = binding.ctrl  ? (e.ctrlKey  || e.metaKey) : !e.ctrlKey && !e.metaKey
        const metaMatch  = binding.meta  ? e.metaKey   : true   // meta alone is rarely used
        const shiftMatch = binding.shift ? e.shiftKey  : !e.shiftKey
        const altMatch   = binding.alt   ? e.altKey    : !e.altKey
        const keyMatch   = e.key.toLowerCase() === binding.key.toLowerCase()

        // For ctrl/cmd shortcuts, don't enforce metaMatch separately
        const modMatch = binding.ctrl
          ? (e.ctrlKey || e.metaKey) && shiftMatch && altMatch
          : ctrlMatch && metaMatch && shiftMatch && altMatch

        if (keyMatch && modMatch) {
          e.preventDefault()
          binding.handler(e)
          break
        }
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
