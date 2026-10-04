import { defineConfig } from "@playwright/test"

/** A dev server that starts like production: no model open. */
export const NO_DEFAULT_MODEL_URL = "http://127.0.0.1:5177"

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
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5178 --strictPort",
      env: {
        // The browser fixtures describe Jacket, so tests start with it open.
        // Production sets nothing and starts with no model open.
        VITE_DEFAULT_PRODUCT_GRAPH_ID: "jacket",
        // Browser tests do not sign in; see AuthGate. Has no effect on `vite build`.
        VITE_AUTH_DISABLED: "true",
      },
      url: "http://127.0.0.1:5178",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Production-like startup (no default model), for NO_DEFAULT_MODEL_URL.
      command: "npm run dev -- --host 127.0.0.1 --port 5177 --strictPort",
      env: { VITE_AUTH_DISABLED: "true" },
      url: "http://127.0.0.1:5177",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
