// Global type augmentations for Luano renderer
// Non-module .d.ts — all declarations are automatically global

// ── Vite ?worker imports ──────────────────────────────────────────────────────
declare module "*?worker" {
  const WorkerConstructor: new () => Worker
  export default WorkerConstructor
}

// ── IPC domain types ─────────────────────────────────────────────────────────
/// <reference path="types/ipc/project.d.ts" />
/// <reference path="types/ipc/file.d.ts" />
/// <reference path="types/ipc/ai.d.ts" />
/// <reference path="types/ipc/sync.d.ts" />
/// <reference path="types/ipc/lint.d.ts" />
/// <reference path="types/ipc/bridge.d.ts" />
/// <reference path="types/ipc/terminal.d.ts" />
/// <reference path="types/ipc/analysis.d.ts" />
/// <reference path="types/ipc/datastore.d.ts" />
/// <reference path="types/ipc/skills.d.ts" />
/// <reference path="types/ipc/memory.d.ts" />
/// <reference path="types/ipc/toolchain.d.ts" />
/// <reference path="types/ipc/license.d.ts" />
/// <reference path="types/ipc/updater.d.ts" />
/// <reference path="types/ipc/telemetry.d.ts" />
/// <reference path="types/ipc/misc.d.ts" />

// ── Window.api augmentation ───────────────────────────────────────────────────
interface Window {
  api: ProjectApi
    & FileApi
    & AiApi
    & SyncApi
    & LintApi
    & BridgeApi
    & TerminalApi
    & AnalysisApi
    & DatastoreApi
    & SkillsApi
    & MemoryApi
    & ToolchainApi
    & LicenseApi
    & UpdaterApi
    & TelemetryApi
    & MiscApi
}
