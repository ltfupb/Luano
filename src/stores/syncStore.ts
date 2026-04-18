import { create } from "zustand"

type SyncStatus = "stopped" | "starting" | "running" | "error"

interface SyncStore {
  status: SyncStatus
  port: number | null
  toolName: string
  error: string | null
  /** Timestamp (ms) when sync entered the "starting" phase, or null otherwise. */
  startedAt: number | null
  setStatus: (s: SyncStatus) => void
  setPort: (p: number | null) => void
  setToolName: (n: string) => void
  setError: (e: string | null) => void
}

export const useSyncStore = create<SyncStore>((set, get) => ({
  status: "stopped",
  port: null,
  toolName: "Argon",
  error: null,
  startedAt: null,
  setStatus: (s) => {
    const prev = get().status
    if (prev === s) return
    // Record startedAt only when transitioning INTO "starting"; clear on any
    // other transition so the StatusBar clock stops ticking once sync is up.
    const startedAt = s === "starting"
      ? (prev === "starting" ? get().startedAt : Date.now())
      : null
    set({ status: s, startedAt })
  },
  setPort: (p) => set({ port: p }),
  setToolName: (n) => set({ toolName: n }),
  setError: (e) => set({ error: e })
}))
