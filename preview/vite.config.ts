import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Gallery server. Renders the BUILT dist-lib artifacts -- not src/ -- so what
// you see here is exactly what the design-system sync uploads.
// Run: npm run preview:ds  (build:lib must have run first)
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 5174, strictPort: true, open: true },
})
