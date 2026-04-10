// src/editor/languages.ts
// File-extension → Monaco language id mapping and custom language registration.
// Monaco 0.50 ships with lua, json, yaml, markdown. TOML is not built-in, so we
// register a minimal Monarch tokenizer for it.

import type * as Monaco from "monaco-editor"

const EXT_TO_LANG: Record<string, string> = {
  lua: "lua",
  luau: "lua",
  json: "json",
  jsonc: "json",
  luaurc: "json",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown"
}

export function getLanguageFromPath(path: string | null | undefined): string {
  if (!path) return "plaintext"
  const name = path.replace(/\\/g, "/").split("/").pop() ?? ""
  const dot = name.lastIndexOf(".")
  if (dot < 0) return "plaintext"
  const ext = name.slice(dot + 1).toLowerCase()
  return EXT_TO_LANG[ext] ?? "plaintext"
}

let _customLanguagesRegistered = false

export function registerCustomLanguages(monaco: typeof Monaco): void {
  if (_customLanguagesRegistered) return
  _customLanguagesRegistered = true

  monaco.languages.register({
    id: "toml",
    extensions: [".toml"],
    aliases: ["TOML", "toml"]
  })

  monaco.languages.setLanguageConfiguration("toml", {
    comments: { lineComment: "#" },
    brackets: [
      ["[", "]"],
      ["{", "}"]
    ],
    autoClosingPairs: [
      { open: "[", close: "]" },
      { open: "{", close: "}" },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ],
    surroundingPairs: [
      { open: "[", close: "]" },
      { open: "{", close: "}" },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ]
  })

  monaco.languages.setMonarchTokensProvider("toml", {
    defaultToken: "",
    tokenPostfix: ".toml",

    tokenizer: {
      root: [
        [/\s+/, "white"],
        [/#.*$/, "comment"],

        // Table / array-of-tables headers
        [/^\s*\[\[[^\]]+\]\]/, "type"],
        [/^\s*\[[^\]]+\]/, "type"],

        // Keys (bare, quoted, or dotted) followed by =
        [/[A-Za-z0-9_-]+(?=\s*=)/, "identifier"],
        [/"[^"]*"(?=\s*=)/, "identifier"],
        [/'[^']*'(?=\s*=)/, "identifier"],

        // Booleans
        [/\b(true|false)\b/, "keyword"],

        // Dates/times (RFC 3339, rough)
        [/\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?/, "number"],

        // Numbers (int, float, hex, oct, bin, with optional underscores)
        [/[+-]?0x[0-9A-Fa-f_]+/, "number.hex"],
        [/[+-]?0o[0-7_]+/, "number.octal"],
        [/[+-]?0b[01_]+/, "number.binary"],
        [/[+-]?\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d[\d_]*)?/, "number"],
        [/[+-]?(inf|nan)/, "number"],

        // Strings
        [/"""/, { token: "string", next: "@mlbasic" }],
        [/'''/, { token: "string", next: "@mlliteral" }],
        [/"/, { token: "string", next: "@basic" }],
        [/'/, { token: "string", next: "@literal" }],

        [/[=,]/, "delimiter"],
        [/[{}[\]]/, "@brackets"]
      ],

      basic: [
        [/[^"\\]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, { token: "string", next: "@pop" }]
      ],

      literal: [
        [/[^']+/, "string"],
        [/'/, { token: "string", next: "@pop" }]
      ],

      mlbasic: [
        [/[^"\\]+/, "string"],
        [/\\./, "string.escape"],
        [/"""/, { token: "string", next: "@pop" }],
        [/"/, "string"]
      ],

      mlliteral: [
        [/[^']+/, "string"],
        [/'''/, { token: "string", next: "@pop" }],
        [/'/, "string"]
      ]
    }
  })
}
