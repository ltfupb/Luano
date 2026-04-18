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

// Only native modules + electron stay external. Everything else is bundled
// into out/main/index.js so node_modules can be aggressively pruned from
// the final asar (see package.json build.files).
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
  "ws"
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
for (const f of proFiles) {
  if (existsSync(resolve(__dirname, f))) {
    proEntries[f.replace("electron/", "").replace(".ts", "")] = resolve(__dirname, f)
  }
}
const isPro = Object.keys(proEntries).length > 0

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
          ...proEntries
        },
        output: isPro
          ? {
              preserveModules: true,
              preserveModulesRoot: resolve(__dirname, "electron"),
              entryFileNames: (chunk) => {
                if (chunk.facadeModuleId?.replace(/\\/g, "/").endsWith("electron/main.ts"))
                  return "index.js"
                return "[name].js"
              }
            }
          : {}
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
