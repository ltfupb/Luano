import { resolve } from "path"
import { existsSync } from "fs"
import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"

// Only native modules + electron stay external. Everything else is bundled
// into out/main/index.js so node_modules can be aggressively pruned from
// the final asar (see package.json build.files).
const mainExternals = [
  "electron",
  /^node:/,
  "better-sqlite3",
  "node-pty",
  "electron-updater",
  "chokidar",
  "fsevents"
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
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/index.html")
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@electron": resolve(__dirname, "electron")
      }
    }
  }
})
