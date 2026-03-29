import { DiffEditor } from "@monaco-editor/react"
import type * as Monaco from "monaco-editor"

interface DiffViewProps {
  original: string
  modified: string
}

function defineTheme(monaco: typeof Monaco): void {
  monaco.editor.defineTheme("luano-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment",    foreground: "3a5272", fontStyle: "italic" },
      { token: "keyword",    foreground: "6ba3f5" },
      { token: "string",     foreground: "7dd3a8" },
      { token: "number",     foreground: "c4a7fb" },
      { token: "identifier", foreground: "d4e2f4" }
    ],
    colors: {
      "editor.background":                   "#080d18",
      "editor.foreground":                   "#d4e2f4",
      "editor.lineHighlightBackground":      "#0c1423",
      "editor.selectionBackground":          "#1d4ed840",
      "editorCursor.foreground":             "#2563eb",
      "editorLineNumber.foreground":         "#1e3050",
      "editorLineNumber.activeForeground":   "#3a5272",
      "diffEditor.insertedTextBackground":   "#10b98122",
      "diffEditor.removedTextBackground":    "#e11d4822",
      "diffEditor.insertedLineBackground":   "#10b98112",
      "diffEditor.removedLineBackground":    "#e11d4812",
      "diffEditorGutter.insertedLineBackground": "#10b98130",
      "diffEditorGutter.removedLineBackground":  "#e11d4830",
      "scrollbarSlider.background":          "#1a2d4560",
      "scrollbarSlider.hoverBackground":     "#243f6280"
    }
  })
}

export function DiffView({ original, modified }: DiffViewProps): JSX.Element {
  return (
    <DiffEditor
      height="100%"
      language="lua"
      theme="luano-dark"
      original={original}
      modified={modified}
      beforeMount={defineTheme}
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
