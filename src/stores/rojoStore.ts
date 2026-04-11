import { create } from "zustand"

type SyncStatus = "stopped" | "starting" | "running" | "error"

interface SyncStore {
  status: SyncStatus
  port: number | null
  toolName: string
  error: string | null
  setStatus: (s: SyncStatus) => void
  setPort: (p: number | null) => void
  setToolName: (n: string) => void
  setError: (e: string | null) => void
}

export const useRojoStore = create<SyncStore>((set) => ({
  status: "stopped",
  port: null,
  toolName: "Rojo",
  error: null,
  setStatus: (s) => set({ status: s }),
  setPort: (p) => set({ port: p }),
  setToolName: (n) => set({ toolName: n }),
  setError: (e) => set({ error: e })
}))
