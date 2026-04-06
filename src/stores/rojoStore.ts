import { create } from "zustand"

type SyncStatus = "stopped" | "starting" | "running" | "error"

interface SyncStore {
  status: SyncStatus
  port: number | null
  toolName: string
  setStatus: (s: SyncStatus) => void
  setPort: (p: number | null) => void
  setToolName: (n: string) => void
}

export const useRojoStore = create<SyncStore>((set) => ({
  status: "stopped",
  port: null,
  toolName: "Rojo",
  setStatus: (s) => set({ status: s }),
  setPort: (p) => set({ port: p }),
  setToolName: (n) => set({ toolName: n })
}))
