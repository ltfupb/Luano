// src/editor/fallback.worker.ts
// Fallback web worker for unknown Monaco labels (e.g. from @codingame/monaco-vscode-*).
// Calls initialize() with a no-op factory so loadForeignModule resolves with []
// instead of rejecting with "Unexpected usage" (ESM limitation in editorWorker).

// monaco-editor doesn't ship .d.ts for internal worker entry points
// @ts-expect-error — no types for this ESM-internal path
import { initialize } from "monaco-editor/esm/vs/editor/editor.worker"

initialize(() => ({}))
