import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"
import { lcaIntensityShim } from "./dev/lcaIntensityShim"

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), lcaIntensityShim()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/lca-api": {
        target: "https://lca.mathplosion.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lca-api/, ""),
      },
      "/lca-mcp": {
        target: "https://lca.mathplosion.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lca-mcp/, "/mcp"),
      },
    },
  },
})
