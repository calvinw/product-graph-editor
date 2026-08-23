import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

// Library build for the design system in src/components/ui.
// Separate from vite.config.ts, which builds the application.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    outDir: "dist-lib",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: path.resolve(import.meta.dirname, "src/components/ui/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "radix-ui",
        "lucide-react",
      ],
    },
  },
})
