import { defineConfig } from "@playwright/test"
import baseConfig from "./playwright.base.config"

const viewports = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "large-desktop", width: 1920, height: 1080 },
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
