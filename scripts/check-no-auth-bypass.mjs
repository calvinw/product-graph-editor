// Fails the build if the dev-only sign-in bypass (see src/components/AuthGate.tsx)
// ever reaches the production bundle.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const markers = ["local-test-user", "Local Test User"]
const files = readdirSync("dist", { recursive: true }).filter((file) => String(file).endsWith(".js"))
const leaks = files.filter((file) => {
  const source = readFileSync(join("dist", String(file)), "utf8")
  return markers.some((marker) => source.includes(marker))
})
if (leaks.length) {
  console.error(`Sign-in bypass found in production build: ${leaks.join(", ")}`)
  process.exit(1)
}
console.log("Checked: no sign-in bypass in the production build.")
