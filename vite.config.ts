import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/lca-api": {
        target: "https://lca-mcp.mathplosion.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lca-api/, ""),
      },
    },
  },
})
