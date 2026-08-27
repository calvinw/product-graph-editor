import { parse, stringify } from "yaml"
import type { Plugin } from "vite"

/**
 * Dev-only shim that rebuilds `background_link_intensities`.
 *
 * The engine publishes that field only while its background intensity cache is
 * enabled, and the deployed server currently runs without it. The field is
 * optional in the response schema, so the app validates the reply and then
 * silently finds nothing draggable: no scenario edges, no scenario panel.
 *
 * Each row is recoverable, because an intensity is just the cumulative impact
 * of one unit of the provider. Running a one-process graph that draws a single
 * unit of the activity returns exactly that, under the parent graph's own LCIA
 * method, so the reconstructed numbers match what the engine would have sent.
 *
 * Delete this plugin once the server ships the field again.
 */

const UPSTREAM = "https://lca.mathplosion.com"
const SCORED_PATHS = ["/api/lca/base", "/api/lca/run"]

type Probe = { flow: string; database: string; location?: string; unit: string }
type YamlInput = { flow?: string; database?: string; location?: string; amount?: number; unit?: string }
type YamlProcess = { name?: string; inputs?: YamlInput[] }
type YamlGraph = { processes?: YamlProcess[]; lcia?: unknown }

/** Probes are pure functions of the activity, so one run each is enough. */
const intensityCache = new Map<string, Record<string, number>>()
const probeKey = (probe: Probe) => `${probe.database}|${probe.flow}|${probe.location ?? ""}|${probe.unit}`

async function postUpstream(path: string, body: unknown) {
  const response = await fetch(`${UPSTREAM}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path} responded ${response.status}`)
  return await response.json() as { lcia?: Record<string, { score: number }> }
}

async function probeIntensities(probe: Probe, lcia: unknown) {
  const cached = intensityCache.get(probeKey(probe))
  if (cached) return cached

  const graph = stringify({
    name: "intensity probe",
    functional_unit: { description: "probe", amount: 1.0, unit: "unit" },
    products: [{ name: "Probe output", unit: "unit" }],
    processes: [{
      name: "Probe",
      reference_output: { flow: "Probe output", amount: 1.0, unit: "unit" },
      inputs: [{
        flow: probe.flow,
        ...(probe.location ? { location: probe.location } : {}),
        database: probe.database,
        amount: 1.0,
        unit: probe.unit,
      }],
    }],
    reference_process: "Probe",
    lcia,
  })

  const result = await postUpstream("/api/lca/base", { product_graph: graph })
  const intensities = Object.fromEntries(
    Object.entries(result.lcia ?? {}).map(([label, impact]) => [label, impact.score]),
  )
  intensityCache.set(probeKey(probe), intensities)
  return intensities
}

async function rebuildIntensities(source: string) {
  const graph = parse(source) as YamlGraph
  const links: Array<{ row: Record<string, unknown>; probe: Probe }> = []

  graph.processes?.forEach((process, processIndex) => {
    process.inputs?.forEach((input, inputIndex) => {
      // A `database` key is what makes an input a background link; foreground
      // inputs name a product produced elsewhere in the same graph.
      if (!input.database || !input.flow) return
      const probe: Probe = {
        flow: input.flow,
        database: input.database,
        location: input.location,
        unit: input.unit ?? "unit",
      }
      links.push({
        probe,
        row: {
          link_id: `${processIndex}:${inputIndex}`,
          process_index: processIndex,
          input_index: inputIndex,
          process_name: process.name ?? "",
          flow: input.flow,
          database: input.database,
          code: "",
          location: input.location ?? null,
          amount: input.amount ?? 0,
          unit: probe.unit,
        },
      })
    })
  })

  const rows = await Promise.all(links.map(async ({ row, probe }) => {
    try {
      return { ...row, intensities: await probeIntensities(probe, graph.lcia) }
    } catch {
      // One unresolvable provider should cost only its own edge, not the
      // whole scenario feature, so the row is dropped rather than faked.
      return null
    }
  }))

  return rows.filter((row): row is Record<string, unknown> => row !== null)
}

export function lcaIntensityShim(): Plugin {
  return {
    name: "lca-intensity-shim",
    apply: "serve",
    configureServer(server) {
      // Registered here rather than in the returned hook so it runs ahead of
      // Vite's own proxy, which would otherwise stream the reply untouched.
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? ""
        const path = url.replace(/^\/lca-api/, "").split("?")[0]
        if (request.method !== "POST" || !url.startsWith("/lca-api") || !SCORED_PATHS.includes(path)) return next()

        const chunks: Buffer[] = []
        request.on("data", (chunk: Buffer) => chunks.push(chunk))
        request.on("end", () => {
          void (async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString()) as { product_graph?: string }
              const result = await postUpstream(path, body) as Record<string, unknown>

              if (!Array.isArray(result.background_link_intensities) && body.product_graph) {
                const rebuilt = await rebuildIntensities(body.product_graph)
                if (rebuilt.length) {
                  result.background_link_intensities = rebuilt
                  server.config.logger.info(
                    `  ➜  lca-intensity-shim: rebuilt ${rebuilt.length} link intensities for ${path}`,
                  )
                }
              }

              response.setHeader("Content-Type", "application/json")
              response.end(JSON.stringify(result))
            } catch (error) {
              response.statusCode = 502
              response.end(JSON.stringify({ detail: `intensity shim failed: ${String(error)}` }))
            }
          })()
        })
      })
    },
  }
}
