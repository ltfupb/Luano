import { useRef, useCallback } from "react"

type Axis = "x" | "y"

/**
 * Reusable drag-resize hook for panels.
 * Returns a mouseDown handler to attach to the resize handle.
 */
export function usePanelResize(
  axis: Axis,
  min: number,
  max: number,
  setValue: React.Dispatch<React.SetStateAction<number>>,
  invert = false
): (e: React.MouseEvent) => void {
  const dragging = useRef(false)
  const startPos = useRef(0)
  const startVal = useRef(0)

  return useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startPos.current = axis === "x" ? e.clientX : e.clientY
    startVal.current = 0

    // Read current value from the setter's identity trick:
    // We call setValue with a function to capture current value
    setValue((current: number) => { startVal.current = current; return current })

    const onMove = (mv: MouseEvent) => {
      if (!dragging.current) return
      const pos = axis === "x" ? mv.clientX : mv.clientY
      const raw = pos - startPos.current
      const delta = invert ? -raw : raw
      setValue(Math.max(min, Math.min(max, startVal.current + delta)))
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [axis, min, max, setValue, invert])
}
