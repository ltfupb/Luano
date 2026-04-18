import { useState, useEffect } from "react"

/** Returns seconds elapsed since startedAt, or null. Updates every second. */
export function useElapsed(startedAt: number | null): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null)
  useEffect(() => {
    if (startedAt === null) {
      setElapsed(null)
      return
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return elapsed
}
