import { resolve } from "path"
import { existsSync, readFileSync } from "fs"
import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"
import { sentryVitePlugin } from "@sentry/vite-plugin"

// Read version once so source map upload can tag the right release.
const pkgVersion = (JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8")) as { version: string }).version
// CI-only: avoids dev builds accidentally uploading to prod if a developer
// sources a .env containing SENTRY_AUTH_TOKEN. GitHub Actions sets CI=true.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const sentrySourceMapsEnabled = !!sentryAuthToken && process.env.CI === "true"

// Externalized modules: loaded at runtime via require() from the installed
// node_modules. electron-builder ships these automatically as declared
// production dependencies.
//
// Why @sentry/electron + AI SDKs are external (not bundled): electron-builder
// aggressively filters any path containing `node_modules/` inside the app —
// including rollup's preserveModules output under `out/main/node_modules/`.
// No `files` pattern, `asarUnpack`, or re-include glob defeats this filter.
// Bundling these deps with preserveModules therefore produces broken installs.
// Externalizing keeps the build simple and predictable at a modest asar size cost.
const mainExternals = [
  "electron",
  /^node:/,
  "better-sqlite3",
  "node-pty",
  "electron-updater",
  "@electron-toolkit/utils",
  "chokidar",
  "fsevents",
  "bufferutil",
  "utf-8-validate",
  "ws",
  // Regexes needed for subpath imports — e.g. "@sentry/electron/main",
  // "openai/resources/chat/completions". Exact-string externals don't match
  // subpaths, so rollup would bundle them.
  /^@sentry\/electron(\/|$)/,
  /^@anthropic-ai\/sdk(\/|$)/,
  /^openai(\/|$)/,
  /^@google\/generative-ai(\/|$)/
]

// Auto-detect Pro files by checking if they exist on disk.
// Private repo has them, public mirror does not.
const proFiles = [
  "electron/ai/agent.ts",
  "electron/ai/tools.ts",
  "electron/ai/context.ts",
  "electron/ai/rag.ts",
  "electron/bridge/server.ts",
  "electron/mcp/client.ts",
  "electron/topology/analyzer.ts",
  "electron/analysis/cross-script.ts",
  "electron/analysis/performance-lint.ts",
  "electron/datastore/schema.ts",
  "electron/telemetry/collector.ts",
]

const proEntries: Record<string, string> = {}
const proPresent: string[] = []
const proMissing: string[] = []
for (const f of proFiles) {
  if (existsSync(resolve(__dirname, f))) {
    proEntries[f.replace("electron/", "").replace(".ts", "")] = resolve(__dirname, f)
    proPresent.push(f)
  } else {
    proMissing.push(f)
  }
}
const isPro = Object.keys(proEntries).length > 0

// Public modules loaded via tryRequire from pro/modules.ts. These are NOT
// Pro-gated — they ship in both private and public builds — but the dynamic
// require pattern means rollup can't see them via static analysis. Listed
// here so each is emitted as out/main/<path>.js for runtime resolution.
//
// Without this, pro/modules.ts's `tryRequire("../ai/evaluator")` resolves to
// a non-existent file at runtime; before the transitive-miss discrimination
// landed, that silently fell back to no-op stubs, but it now throws and
// crashes app boot. Bundling fixes the root cause.
const publicTryRequireEntries: Record<string, string> = {
  "ai/evaluator": resolve(__dirname, "electron/ai/evaluator.ts")
}

// Build-time assertion: every tryRequire("...") literal in pro/modules.ts
// must resolve to either a Pro file (present in proFiles) or a public module
// (listed in publicTryRequireEntries). Any unlisted target would fail silently
// at runtime — either swallowed as "Free edition fallback" (if the file
// doesn't exist) or as a boot crash (if transitive-miss discrimination fires).
// Detect the gap here with a clear remediation message.
;(() => {
  const modulesSrc = readFileSync(resolve(__dirname, "electron/pro/modules.ts"), "utf-8")
  // Match both single- and double-quoted string args to tryRequire<...>()
  const tryRequireRe = /tryRequire\s*<[\s\S]*?>\s*\(\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  const missing: string[] = []
  while ((m = tryRequireRe.exec(modulesSrc)) !== null) {
    const rawId = m[1]
    // Normalize relative prefix — tryRequire ids start with "../"
    // e.g. "../ai/context" → "ai/context", "../bridge/server" → "bridge/server"
    const id = rawId.replace(/^\.\.\//, "")
    const proFilePath = `electron/${id}.ts`
    const isProFile = proFiles.includes(proFilePath)
    const isPublicModule = Object.prototype.hasOwnProperty.call(publicTryRequireEntries, id)
    if (!isProFile && !isPublicModule) {
      missing.push(rawId)
    }
  }
  if (missing.length > 0) {
    throw new Error(
      [
        "pro/modules.ts has tryRequire() targets not covered by proFiles or publicTryRequireEntries.",
        "These will silently fall back to no-op stubs (or crash boot) at runtime.",
        `  Uncovered targets: ${missing.join(", ")}`,
        "Fix: add the file to proFiles (if Pro-only) OR add the id to publicTryRequireEntries (if always bundled).",
      ].join("\n")
    )
  }
})()

// Sanity assertion: the build is either fully private (all Pro files present)
// or fully public (none present). A partial state usually means a file was
// accidentally added to .mirror-exclude or accidentally dropped from the
// private tree — both will surface as broken imports at runtime via
// pro/modules.ts's tryRequire fallbacks, with no single place to notice.
// Fail the build here with a specific list instead.
if (proPresent.length > 0 && proMissing.length > 0) {
  const msg = [
    "Pro file state is inconsistent — expected either all present (private build) or all absent (public mirror).",
    `  Present (${proPresent.length}): ${proPresent.join(", ")}`,
    `  Missing (${proMissing.length}): ${proMissing.join(", ")}`,
    "Fix: either restore the missing files, or ensure pro/modules.ts has no-op fallbacks for every Pro import and remove the partial files.",
  ].join("\n")
  throw new Error(msg)
}

export default defineConfig({
  main: {
    define: {
      // DSN injected at build time from env — empty string disables Sentry in public builds
      __SENTRY_DSN__: JSON.stringify(process.env.SENTRY_DSN ?? "")
    },
    build: {
      minify: true,
      rollupOptions: {
        external: mainExternals,
        input: {
          index: resolve(__dirname, "electron/main.ts"),
          ...proEntries,
          ...publicTryRequireEntries
        },
        // preserveModules is required whenever there's more than one input —
        // the publicTryRequireEntries above always add at least one alongside
        // `index`, so this is unconditionally on. Pro and public builds both
        // emit the same out/main/<path>.js layout.
        output: {
          preserveModules: true,
          preserveModulesRoot: resolve(__dirname, "electron"),
          entryFileNames: (chunk) => {
            if (chunk.facadeModuleId?.replace(/\\/g, "/").endsWith("electron/main.ts"))
              return "index.js"
            return "[name].js"
          }
        }
      }
    }
  },
  preload: {
    build: {
      minify: true,
      rollupOptions: {
        external: mainExternals,
        input: {
          index: resolve(__dirname, "electron/preload.ts")
        }
      }
    }
  },
  renderer: {
    root: "src",
    build: {
      assetsInlineLimit: 100_000,
      // Source maps are generated so Sentry can unminify stack traces.
      // The vite plugin below uploads them and (optionally) deletes the
      // local .map files after upload so they don't ship in the asar.
      sourcemap: sentrySourceMapsEnabled ? "hidden" : false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/index.html")
        },
        output: {
          // Monaco (~6-8 MB when tree-shaken) was duplicated across the
          // EditorPane lazy chunk and the monacoInit chunk because
          // `@monaco-editor/react`'s dynamic loader API hides the import
          // from the static module graph. Force Monaco + the VSCode/LSP
          // glue + the markdown pipeline into dedicated shared chunks so
          // each is bundled exactly once and can be cached independently
          // across updates.
          manualChunks(id: string): string | undefined {
            const nm = id.replace(/\\/g, "/")
            if (nm.includes("/node_modules/monaco-editor/")) return "monaco"
            if (nm.includes("/node_modules/@codingame/")) return "monaco-vscode"
            if (nm.includes("/node_modules/monaco-languageclient/")) return "monaco-vscode"
            if (nm.includes("/node_modules/vscode-languageclient/")) return "monaco-vscode"
            if (nm.includes("/node_modules/vscode-jsonrpc/")) return "monaco-vscode"
            if (nm.includes("/node_modules/vscode-languageserver-")) return "monaco-vscode"
            if (nm.includes("/node_modules/react-markdown/")) return "markdown"
            if (nm.includes("/node_modules/remark-")) return "markdown"
            if (nm.includes("/node_modules/rehype-")) return "markdown"
            if (nm.includes("/node_modules/micromark")) return "markdown"
            if (nm.includes("/node_modules/mdast-")) return "markdown"
            if (nm.includes("/node_modules/hast-")) return "markdown"
            if (nm.includes("/node_modules/unist-")) return "markdown"
            return undefined
          }
        }
      }
    },
    plugins: [
      react(),
      // Only active in CI where SENTRY_AUTH_TOKEN is set. Locally this is
      // a no-op — source maps stay off and nothing is uploaded.
      ...(sentrySourceMapsEnabled
        ? [
            sentryVitePlugin({
              org: "luano",
              project: "electron",
              authToken: sentryAuthToken,
              release: { name: `luano@${pkgVersion}` },
              sourcemaps: {
                assets: "./out/renderer/**",
                filesToDeleteAfterUpload: "./out/renderer/**/*.map"
              },
              silent: false,
              telemetry: false
            })
          ]
        : [])
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@electron": resolve(__dirname, "electron")
      }
    }
  }
})
