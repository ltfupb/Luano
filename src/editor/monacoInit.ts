// src/editor/monacoInit.ts
// Monaco bootstrap — imported only by EditorPane so the Monaco bundle
// stays off the cold-start critical path (Welcome screen, Settings, etc.).
//
// Import edcore.main (editor features + standalone contributions) instead of
// the full monaco-editor entry point, then add only the four languages Luano
// actually needs.  This avoids bundling ~80 basic-language tokenizers, the
// TypeScript/JavaScript language service, and the CSS/HTML language services
// (~12-15 MB saved from the renderer bundle).

import { loader } from "@monaco-editor/react"
import * as monaco from "monaco-editor/esm/vs/editor/edcore.main"
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"

// Language contributions — only what Luano uses
import "monaco-editor/esm/vs/basic-languages/lua/lua.contribution"
import "monaco-editor/esm/vs/language/json/monaco.contribution"
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution"
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution"

// Use local bundle instead of CDN (CSP bypass)
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === "json") return new jsonWorker()
    return new editorWorker()
  }
}

loader.config({ monaco })
