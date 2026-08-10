import { defineConfig } from "@playwright/test"
import baseConfig from "./playwright.base.config"

export default defineConfig(baseConfig, {
  testDir: "./tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  use: {
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.001,
    },
  },
})
