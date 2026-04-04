import { create } from "zustand"

type RojoStatus = "stopped" | "starting" | "running" | "error"

interface RojoStore {
  status: RojoStatus
  port: number | null
  setStatus: (s: RojoStatus) => void
  setPort: (p: number | null) => void
}

export const useRojoStore = create<RojoStore>((set) => ({
  status: "stopped",
  port: null,
  setStatus: (s) => set({ status: s }),
  setPort: (p) => set({ port: p })
}))
