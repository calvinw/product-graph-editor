type LcaValue = { amount?: number; score?: number; unit: string; type?: string }

export type LcaResult = {
  name: string
  method: string
  functional_unit: string
  lci: Record<string, LcaValue>
  lcia: Record<string, LcaValue>
  scaling_vector: Record<string, number>
}

type ToolDefinition = {
  name: string
  rest?: { method: string; path: string }
}

const configuredBase = import.meta.env.VITE_LCA_API_BASE as string | undefined
const apiBase = (configuredBase ?? (import.meta.env.DEV ? "/lca-api" : "https://lca-mcp.mathplosion.com")).replace(/\/$/, "")

async function readJson(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body === "object" && "detail" in body ? String(body.detail) : `Request failed with status ${response.status}.`
    throw new Error(message)
  }
  return body
}

export async function calculateLca(productGraph: string): Promise<LcaResult> {
  const health = await readJson(await fetch(`${apiBase}/api/health`)) as { running?: boolean }
  if (!health.running) throw new Error("The LCA calculation engine is not ready.")

  const tools = await readJson(await fetch(`${apiBase}/api/tools`)) as ToolDefinition[]
  const operation = tools.find((tool) => tool.name === "run_lca")
  if (!operation?.rest || operation.rest.method !== "POST") throw new Error("The LCA calculation operation is unavailable.")

  return readJson(await fetch(`${apiBase}${operation.rest.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_graph: productGraph }),
  })) as Promise<LcaResult>
}

const formatNumber = (value: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 6 }).format(value)
const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ")

export function lcaResultToMarkdown(result: LcaResult) {
  const impactRows = Object.entries(result.lcia).map(([category, value]) => `| ${cell(category)} | ${formatNumber(value.score ?? 0)} | ${cell(value.unit)} |`)
  const inventoryRows = Object.entries(result.lci).map(([flow, value]) => `| ${cell(flow)} | ${formatNumber(value.amount ?? 0)} | ${cell(value.unit)} | ${cell(value.type ?? "—")} |`)
  const scalingRows = Object.entries(result.scaling_vector).map(([process, scale]) => `| ${cell(process)} | ${formatNumber(scale)} |`)

  return [
    `# ${result.name}`,
    "",
    `**Method:** ${result.method}  `,
    `**Functional unit:** ${result.functional_unit}`,
    "",
    "## Impact assessment",
    "",
    "| Impact category | Score | Unit |",
    "| --- | ---: | --- |",
    ...impactRows,
    "",
    "## Life cycle inventory",
    "",
    "| Flow | Amount | Unit | Type |",
    "| --- | ---: | --- | --- |",
    ...inventoryRows,
    "",
    "## Process scaling",
    "",
    "| Process | Scale |",
    "| --- | ---: |",
    ...scalingRows,
  ].join("\n")
}
