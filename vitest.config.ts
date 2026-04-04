import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      include: ["electron/**/*.ts"],
      exclude: ["electron/pro/**", "electron/main.ts"]
    }
  }
})
