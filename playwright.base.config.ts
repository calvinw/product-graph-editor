import { defineConfig } from "@playwright/test"

export default defineConfig({
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5178",
    deviceScaleFactor: 1,
    contextOptions: {
      reducedMotion: "reduce",
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5178 --strictPort",
    env: {
      // The browser fixtures describe Jacket; production uses the app's Cotton Fiber default.
      VITE_DEFAULT_PRODUCT_GRAPH_ID: "jacket",
    },
    url: "http://127.0.0.1:5178",
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
