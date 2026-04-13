import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
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
        lines: 12,
        functions: 32,
        branches: 55,
        statements: 12
      }
    }
  }
})
