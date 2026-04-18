import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

export interface FileEntry {
  name: string
  path: string
  type: "file" | "directory"
  ext?: string
  children?: FileEntry[]
}

export type LspStatus = "stopped" | "starting" | "running" | "error"

interface ProjectStore {
  projectPath: string | null
  fileTree: FileEntry[]
  openFiles: string[]
  activeFile: string | null
  fileContents: Record<string, string>
  lspPort: number | null
  lspStatus: LspStatus
  lspStartedAt: number | null
  dirtyFiles: string[]

  setProject: (path: string, tree: FileEntry[], lspPort: number) => void
  closeProject: () => void
  openFile: (path: string, content: string) => void
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void
  updateFileContent: (path: string, content: string) => void
  setFileTree: (tree: FileEntry[]) => void
  markClean: (path: string) => void
  reorderFiles: (from: number, to: number) => void
  setLspStatus: (status: LspStatus) => void
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projectPath: null,
      fileTree: [],
      openFiles: [],
      activeFile: null,
      fileContents: {},
      lspPort: null,
      lspStatus: "stopped",
      lspStartedAt: null,
      dirtyFiles: [],

      setProject: (path, tree, lspPort) =>
        set({
          projectPath: path,
          fileTree: tree,
          lspPort,
          lspStatus: "running",
          lspStartedAt: null
        }),

      closeProject: () =>
        set({
          projectPath: null,
          fileTree: [],
          openFiles: [],
          activeFile: null,
          fileContents: {},
          lspPort: null,
          lspStatus: "stopped",
          lspStartedAt: null,
          dirtyFiles: []
        }),

      openFile: (path, content) => {
        const { openFiles, fileContents } = get()
        set({
          openFiles: openFiles.includes(path) ? openFiles : [...openFiles, path],
          activeFile: path,
          fileContents: { ...fileContents, [path]: content }
        })
      },

      closeFile: (path) => {
        const { openFiles, activeFile, dirtyFiles } = get()
        const newFiles = openFiles.filter((f) => f !== path)
        set({
          openFiles: newFiles,
          activeFile: activeFile === path ? (newFiles[newFiles.length - 1] ?? null) : activeFile,
          dirtyFiles: dirtyFiles.filter((f) => f !== path)
        })
      },

      setActiveFile: (path) => set({ activeFile: path }),

      updateFileContent: (path, content) => {
        const { dirtyFiles } = get()
        set({
          fileContents: { ...get().fileContents, [path]: content },
          dirtyFiles: dirtyFiles.includes(path) ? dirtyFiles : [...dirtyFiles, path]
        })
      },

      setFileTree: (tree) => set({ fileTree: tree }),

      markClean: (path) =>
        set({ dirtyFiles: get().dirtyFiles.filter((f) => f !== path) }),

      reorderFiles: (from, to) => {
        const files = [...get().openFiles]
        const [moved] = files.splice(from, 1)
        files.splice(to, 0, moved)
        set({ openFiles: files })
      },

      setLspStatus: (status) => {
        const prev = get().lspStatus
        if (prev === status) return
        // Start the elapsed timer only when transitioning INTO "starting".
        // Clearing it on any non-starting transition keeps the StatusBar clock
        // from lingering after the process actually comes up.
        const lspStartedAt = status === "starting"
          ? (prev === "starting" ? get().lspStartedAt : Date.now())
          : null
        set({ lspStatus: status, lspStartedAt })
      }
    }),
    {
      name: "luano-project",
      storage: createJSONStorage(() => localStorage),
      // Exclude file contents (too large) — reloaded on restart
      partialize: (state) => ({
        projectPath: state.projectPath,
        openFiles: state.openFiles,
        activeFile: state.activeFile
      })
    }
  )
)
