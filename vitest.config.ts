import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [
      ["tests/*store*.test.ts", "jsdom"],
      ["tests/**/*.test.tsx", "jsdom"],
      ["tests/smoke/**", "node"]
    ],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      include: ["electron/**/*.ts", "src/stores/**/*.ts"],
      exclude: [
        "electron/pro/**",
        "electron/main.ts",
        "**/*.d.ts",
        "**/types.ts"
      ],
      thresholds: {
        lines: 40,
        functions: 65,
        branches: 75,
        statements: 40
      }
    }
  }
})
