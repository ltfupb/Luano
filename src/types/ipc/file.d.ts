interface FileApi {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<{ success: boolean }>
  readDir: (path: string) => Promise<import("../../stores/projectStore").FileEntry[]>
  watchProject: (path: string) => Promise<{ success: boolean }>
  createFile: (dirPath: string, name: string) => Promise<{ success: boolean; path: string }>
  createFolder: (dirPath: string, name: string) => Promise<{ success: boolean; path: string }>
  renameEntry: (oldPath: string, newName: string) => Promise<{ success: boolean; path: string }>
  deleteEntry: (entryPath: string) => Promise<{ success: boolean }>
  moveEntry: (srcPath: string) => Promise<{ success: boolean; canceled?: boolean; path?: string }>
  searchFiles: (projectPath: string, query: string) => Promise<Array<{ file: string; line: number; text: string }>>
}
