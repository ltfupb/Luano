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

/** Normalize a binding into a deterministic string we can dedupe on. */
function comboKey(b: Keybinding): string {
  return [
    b.ctrl ? "ctrl" : "",
    b.meta ? "meta" : "",
    b.shift ? "shift" : "",
    b.alt ? "alt" : "",
    b.key.toLowerCase()
  ].filter(Boolean).join("+")
}

/**
 * Register global keyboard shortcuts.
 * Runs cleanup on unmount. Duplicate combos within the same bindings array
 * emit a console.warn — previously the first-registered combo silently won
 * (via `break`) and the duplicate was dead code, which hid real bugs when
 * two features raced to claim the same shortcut.
 */
export function useKeybindings(bindings: Keybinding[]): void {
  useEffect(() => {
    const seen = new Set<string>()
    for (const binding of bindings) {
      const combo = comboKey(binding)
      if (seen.has(combo)) {
        // eslint-disable-next-line no-console
        console.warn(`[useKeybindings] Duplicate binding for "${combo}" — only the first registration will fire.`)
      } else {
        seen.add(combo)
      }
    }

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
