interface FileApi {
  // Resolves with file contents, or null on ENOENT (file deleted between
  // reads). Any other failure (sandbox traversal block, EACCES, EISDIR,
  // etc.) rejects with a sanitized Error("read_failed") whose message does
  // NOT include the path — see `electron/ipc/project-handlers.ts` for
  // rationale. NOTE: the typed return is `string` for back-compat with
  // existing callers that already optional-chain the result; the runtime
  // shape is `string | null` and callers should treat null as missing.
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
  isDirectory: (path: string) => Promise<boolean>
  probeRojo: (folderPath: string) => Promise<boolean>
  projectExists: (folderPath: string) => Promise<boolean>
}
