import { DiffEditor } from "@monaco-editor/react"
import type * as Monaco from "monaco-editor"
import { useSettingsStore } from "../stores/settingsStore"

interface DiffViewProps {
  original: string
  modified: string
}

function defineDiffThemes(monaco: typeof Monaco): void {
  monaco.editor.defineTheme("luano-diff-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment",    foreground: "6a9955", fontStyle: "italic" },
      { token: "keyword",    foreground: "569cd6" },
      { token: "string",     foreground: "ce9178" },
      { token: "number",     foreground: "b5cea8" },
      { token: "identifier", foreground: "d4d4d4" }
    ],
    colors: {
      "editor.background":                   "#1e1e1e",
      "editor.foreground":                   "#d4d4d4",
      "editor.lineHighlightBackground":      "#252526",
      "editor.selectionBackground":          "#264f7840",
      "editorCursor.foreground":             "#569cd6",
      "editorLineNumber.foreground":         "#5a5a5a",
      "editorLineNumber.activeForeground":   "#c6c6c6",
      "diffEditor.insertedTextBackground":   "#4ec9b022",
      "diffEditor.removedTextBackground":    "#f4474722",
      "diffEditor.insertedLineBackground":   "#4ec9b012",
      "diffEditor.removedLineBackground":    "#f4474712",
      "diffEditorGutter.insertedLineBackground": "#4ec9b030",
      "diffEditorGutter.removedLineBackground":  "#f4474730",
      "scrollbarSlider.background":          "#4e4e4ea0",
      "scrollbarSlider.hoverBackground":     "#646464a0"
    }
  })

  monaco.editor.defineTheme("luano-diff-tokyo-night", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment",    foreground: "565f89", fontStyle: "italic" },
      { token: "keyword",    foreground: "9d7cd8" },
      { token: "string",     foreground: "9ece6a" },
      { token: "number",     foreground: "ff9e64" },
      { token: "identifier", foreground: "c0caf5" }
    ],
    colors: {
      "editor.background":                   "#1a1b26",
      "editor.foreground":                   "#c0caf5",
      "editor.lineHighlightBackground":      "#1f2133",
      "editor.selectionBackground":          "#33467c50",
      "editorCursor.foreground":             "#7aa2f7",
      "editorLineNumber.foreground":         "#3b3f5c",
      "editorLineNumber.activeForeground":   "#737aa2",
      "diffEditor.insertedTextBackground":   "#73daca22",
      "diffEditor.removedTextBackground":    "#f7768e22",
      "diffEditor.insertedLineBackground":   "#73daca12",
      "diffEditor.removedLineBackground":    "#f7768e12",
      "diffEditorGutter.insertedLineBackground": "#73daca30",
      "diffEditorGutter.removedLineBackground":  "#f7768e30",
      "scrollbarSlider.background":          "#363854a0",
      "scrollbarSlider.hoverBackground":     "#474a6ba0"
    }
  })
}

export function DiffView({ original, modified }: DiffViewProps): JSX.Element {
  const appTheme = useSettingsStore((s) => s.theme)
  const diffTheme = appTheme === "tokyo-night" ? "luano-diff-tokyo-night" : "luano-diff-dark"

  return (
    <DiffEditor
      height="100%"
      language="lua"
      theme={diffTheme}
      original={original}
      modified={modified}
      beforeMount={defineDiffThemes}
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontLigatures: true,
        scrollBeyondLastLine: false,
        wordWrap: "on",
        padding: { top: 10 },
        lineHeight: 22
      }}
    />
  )
}
