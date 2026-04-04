import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./styles/globals.css"

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
