// src/editor/monacoInit.ts
// Monaco bootstrap — imported only by EditorPane so the ~2.8MB Monaco bundle
// stays off the cold-start critical path (Welcome screen, Settings, etc.).

import { loader } from "@monaco-editor/react"
import * as monaco from "monaco-editor"
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"

// Use local bundle instead of CDN (CSP bypass)
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  }
}

loader.config({ monaco })
