import { defineConfig } from "@playwright/test"
import baseConfig from "./playwright.base.config"

const viewports = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
]

export default defineConfig(baseConfig, {
  testDir: "./tests/responsive",
  projects: viewports.map(({ name, width, height }) => ({
    name,
    use: {
      viewport: { width, height },
      colorScheme: "dark",
    },
  })),
})
