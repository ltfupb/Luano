import { resolve } from "path"
import { existsSync } from "fs"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"

// LUANO_PRO=1 → preserve module structure so dynamic require() finds Pro files
const isPro = process.env.LUANO_PRO === "1"

const proEntries: Record<string, string> = {}
if (isPro) {
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
  for (const f of proFiles) {
    if (existsSync(resolve(__dirname, f))) {
      proEntries[f.replace("electron/", "").replace(".ts", "")] = resolve(__dirname, f)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
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
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
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
