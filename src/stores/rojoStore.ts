import { create } from "zustand"

type RojoStatus = "stopped" | "starting" | "serving" | "error"

// 로그에서 포트 파싱: "Listening on port 34872" 또는 "34872" 포함 패턴
function parsePort(log: string): number | null {
  const m = log.match(/(?:port|localhost:|:)(\d{4,5})/i)
  return m ? parseInt(m[1], 10) : null
}

interface RojoStore {
  status: RojoStatus
  logs: string[]
  port: number | null
  setStatus: (s: RojoStatus) => void
  addLog: (log: string) => void
  clearLogs: () => void
}

export const useRojoStore = create<RojoStore>((set, get) => ({
  status: "stopped",
  logs: [],
  port: null,
  setStatus: (s) => set({ status: s }),
  addLog: (log) => {
    const newLogs = [...get().logs.slice(-200), log]
    const port = parsePort(log) ?? get().port
    set({ logs: newLogs, port })
  },
  clearLogs: () => set({ logs: [] })
}))
