import { defineConfig } from "vitest/config"
import path from "node:path"

/**
 * Unit tests for the pure parts of the app: reducers, the version list, and
 * validation helpers. Deliberately standalone rather than merged with
 * `vite.config.ts` -- these tests touch no DOM and no React, so loading the
 * react and tailwind plugins would only slow them down.
 *
 * Browser-level coverage stays in Playwright (`tests/visual`,
 * `tests/responsive`), whose testDirs do not overlap `tests/unit`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
})
