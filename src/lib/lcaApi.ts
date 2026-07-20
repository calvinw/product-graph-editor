export type LciValue = {
  amount: number
  unit: string
  type: string
}

export type LciaValue = {
  score: number
  unit: string
}

export type ProcessContribution = {
  process_id: string
  process_name: string
  direct_score: number
  percentage: number | null
  scope: "foreground" | "background"
}

export type ProcessContributionCategory = {
  id: string
  label: string
  unit: string
  total_score: number
  processes: ProcessContribution[]
  residual_score: number
}

export type SankeyNode = {
  id: string
  label: string
  kind: "process" | "resource" | "emission" | "final_product"
  process_name?: string
  flow_name?: string
  scope?: "foreground" | "background"
}

export type SankeyLink = {
  id: string
  source: string
  target: string
  kind: "technosphere" | "extraction" | "emission" | "final_product"
  flow_name: string
  amount: number
  unit: string
}

export type LcaResult = {
  name: string
  method: string
  functional_unit: string
  lci: Record<string, LciValue>
  lcia: Record<string, LciaValue>
  scaling_vector: Record<string, number>
  result_schema_version: 2
  process_contributions: {
    categories: ProcessContributionCategory[]
  }
  sankey: {
    nodes: SankeyNode[]
    links: SankeyLink[]
    available_units: string[]
  }
  svg_scaled: string
  svg_structure: string
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

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
)

function readLcaResult(value: unknown): LcaResult {
  if (!isObject(value) || value.result_schema_version !== 2) {
    throw new Error("The LCA calculation engine returned an unsupported result version.")
  }
  if (!isObject(value.process_contributions) || !Array.isArray(value.process_contributions.categories)) {
    throw new Error("The LCA calculation response is missing process contributions.")
  }
  if (!isObject(value.sankey) || !Array.isArray(value.sankey.nodes) || !Array.isArray(value.sankey.links) || !Array.isArray(value.sankey.available_units)) {
    throw new Error("The LCA calculation response is missing Sankey data.")
  }
  if (typeof value.svg_scaled !== "string" || typeof value.svg_structure !== "string") {
    throw new Error("The LCA calculation response is missing graph SVGs.")
  }
  return value as LcaResult
}

export async function calculateLca(productGraph: string): Promise<LcaResult> {
  const health = await readJson(await fetch(`${apiBase}/api/health`)) as { running?: boolean }
  if (!health.running) throw new Error("The LCA calculation engine is not ready.")

  const tools = await readJson(await fetch(`${apiBase}/api/tools`)) as ToolDefinition[]
  const operation = tools.find((tool) => tool.name === "run_lca")
  if (!operation?.rest || operation.rest.method !== "POST") throw new Error("The LCA calculation operation is unavailable.")

  const result = await readJson(await fetch(`${apiBase}${operation.rest.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_graph: productGraph }),
  }))
  return readLcaResult(result)
}

const formatNumber = (value: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 6 }).format(value)
const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ")
const indicatorAbbreviations: Record<string, string> = {
  "ecotoxicity: freshwater": "FETP",
  "eutrophication potential": "EP",
  "human toxicity: carcinogenic": "HTPC",
  "human toxicity: non-carcinogenic": "HTPNC",
}

const impactIndicator = (category: string) => {
  const indicator = category.split("|").at(-1)?.trim() || category
  const abbreviation = indicator.match(/\(([^()]*)\)\s*$/)
  if (!abbreviation) {
    const code = indicatorAbbreviations[indicator.toLowerCase()]
    if (code) return `${indicator[0].toUpperCase()}${indicator.slice(1)} / (${code})`
    return indicator
  }
  const fullName = indicator.slice(0, abbreviation.index).trim()
  return `${fullName[0].toUpperCase()}${fullName.slice(1)} / (${abbreviation[1].toUpperCase()})`
}

export function lcaResultToMarkdown(result: LcaResult) {
  const impactRows = Object.entries(result.lcia)
    .sort(([, left], [, right]) => Number((left.score ?? 0) === 0) - Number((right.score ?? 0) === 0))
    .map(([category, value]) => `| ${cell(impactIndicator(category))} | ${formatNumber(value.score ?? 0)} | ${cell(value.unit)} |`)
  const inventoryRows = Object.entries(result.lci).map(([flow, value]) => `| ${cell(flow)} | ${formatNumber(value.amount ?? 0)} | ${cell(value.unit)} | ${cell(value.type ?? "—")} |`)

  return [
    `# ${result.name}`,
    "",
    `**Method:** ${result.method}  `,
    `**Functional unit:** ${result.functional_unit}`,
    "",
    "## Life cycle inventory",
    "",
    "| Flow | Amount | Unit | Type |",
    "| --- | ---: | --- | --- |",
    ...inventoryRows,
    "",
    "## Impact assessment",
    "",
    "| Impact category | Score | Unit |",
    "| --- | ---: | --- |",
    ...impactRows,
  ].join("\n")
}
