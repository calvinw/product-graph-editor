import { chemicalFlowLabel } from "./flowLabels"

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

export type ContributionScope = "foreground" | "background"

export type ContributionGraphNode = {
  id: string
  kind: "functional_unit" | "process"
  activity_id: string | null
  process_name: string
  database: string | null
  code: string | null
  location: string | null
  scope: ContributionScope | null
  depth: number
  supply_amount: number
  unit: string
  direct_score: number
  cumulative_score: number
  cumulative_percentage: number | null
  unexpanded_score: number
  terminal: boolean
}

export type ContributionGraphEdge = {
  id: string
  source: string
  target: string
  consumer_id: string
  producer_id: string
  flow_name: string
  amount: number
  unit: string
}

export type ContributionGraphFlow = {
  id: string
  process_occurrence_id: string
  flow_name: string
  categories: string[]
  kind: "extraction" | "emission"
  amount: number
  unit: string
  score: number
  percentage: number | null
}

export type ActivityContribution = {
  activity_id: string
  process_name: string
  database: string
  code: string
  location: string | null
  scope: ContributionScope
  direct_score: number
  percentage: number | null
  occurrence_count: number
}

export type ContributionGraph = {
  id: string
  label: string
  unit: string
  total_score: number
  cutoff: number
  biosphere_cutoff: number
  max_depth: number | null
  max_calculations: number
  calculation_count: number
  coverage: number | null
  unexpanded_score: number
  status: "complete" | "partial" | "zero_total"
  nodes: ContributionGraphNode[]
  edges: ContributionGraphEdge[]
  flows: ContributionGraphFlow[]
  activity_contributions: ActivityContribution[]
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
  result_id: string
  name: string
  method: string
  functional_unit: string
  lci: Record<string, LciValue>
  lcia: Record<string, LciaValue>
  scaling_vector: Record<string, number>
  result_schema_version: 3
  process_contributions: {
    categories: ProcessContributionCategory[]
  }
  contribution_graphs: ContributionGraph[]
  sankey: {
    nodes: SankeyNode[]
    links: SankeyLink[]
    available_units: string[]
  }
}

export type ContributionBatchResult = {
  result_id: string
  method: string
  contribution_graphs: ContributionGraph[]
}

export type ActivityExchange = {
  input_database: string
  input_code: string
  input_name: string
  input_product: string | null
  input_location: string | null
  exchange_type: "technosphere" | "biosphere" | "production"
  amount: number
  unit: string | null
}

export type BackgroundActivityDetails = {
  database: string
  code: string
  name: string
  location: string | null
  referenceProduct: string | null
  unit: string | null
  exchanges: ActivityExchange[]
}

export type ProductGraphCatalogEntry = {
  id: string
  filename: string
  name: string
  product_graph: string
}

export type ProductGraphCatalog = {
  default_id: string
  product_graphs: ProductGraphCatalogEntry[]
}

type ActivitySearchResult = {
  name: string
  reference_product: string | null
  location: string | null
  unit: string | null
  key: [string, string]
}

type ToolDefinition = {
  name: string
  rest?: { method: string; path: string }
}

const configuredBase = import.meta.env.VITE_LCA_API_BASE as string | undefined
const apiBase = (configuredBase ?? (import.meta.env.DEV ? "/lca-api" : "https://lca.mathplosion.com")).replace(/\/$/, "")

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

function readProductGraphCatalog(value: unknown): ProductGraphCatalog {
  if (!isObject(value) || typeof value.default_id !== "string" || !Array.isArray(value.product_graphs)) {
    throw new Error("The LCA server returned an invalid product-graph catalog.")
  }
  const productGraphs = value.product_graphs.map((item) => {
    if (
      !isObject(item)
      || typeof item.id !== "string"
      || typeof item.filename !== "string"
      || typeof item.name !== "string"
      || typeof item.product_graph !== "string"
    ) {
      throw new Error("The LCA server returned an invalid product-graph catalog entry.")
    }
    return item as ProductGraphCatalogEntry
  })
  if (!productGraphs.some((item) => item.id === value.default_id)) {
    throw new Error("The product-graph catalog does not contain its default entry.")
  }
  if (new Set(productGraphs.map((item) => item.id)).size !== productGraphs.length) {
    throw new Error("The product-graph catalog contains duplicate identifiers.")
  }
  return { default_id: value.default_id, product_graphs: productGraphs }
}

export async function getProductGraphCatalog(signal?: AbortSignal): Promise<ProductGraphCatalog> {
  return readProductGraphCatalog(await readJson(
    await fetch(`${apiBase}/api/product-graphs`, { signal }),
  ))
}

function readLcaResult(value: unknown): LcaResult {
  if (!isObject(value) || value.result_schema_version !== 3) {
    throw new Error("The LCA calculation engine returned an unsupported result version.")
  }
  if (typeof value.result_id !== "string" || !value.result_id) {
    throw new Error("The LCA calculation response is missing its result identifier.")
  }
  if (!isObject(value.process_contributions) || !Array.isArray(value.process_contributions.categories)) {
    throw new Error("The LCA calculation response is missing process contributions.")
  }
  if (!isObject(value.sankey) || !Array.isArray(value.sankey.nodes) || !Array.isArray(value.sankey.links) || !Array.isArray(value.sankey.available_units)) {
    throw new Error("The LCA calculation response is missing Sankey data.")
  }
  if (value.contribution_graphs !== undefined && !Array.isArray(value.contribution_graphs)) {
    throw new Error("The LCA calculation response contains invalid contribution graphs.")
  }
  return {
    ...value,
    contribution_graphs: value.contribution_graphs ?? [],
  } as LcaResult
}

export async function calculateLca(productGraph: string, signal?: AbortSignal): Promise<LcaResult> {
  const health = await readJson(await fetch(`${apiBase}/api/health`, { signal })) as { running?: boolean }
  if (!health.running) throw new Error("The LCA calculation engine is not ready.")

  const tools = await readJson(await fetch(`${apiBase}/api/tools`, { signal })) as ToolDefinition[]
  const operation = tools.find((tool) => tool.name === "run_lca_base")
  if (!operation?.rest || operation.rest.method !== "POST") throw new Error("The LCA calculation operation is unavailable.")

  const result = await readJson(await fetch(`${apiBase}${operation.rest.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_graph: productGraph }),
    signal,
  }))
  return readLcaResult(result)
}

export async function calculateContributionGraphs(
  productGraph: string,
  categories: string[],
  resultId: string,
  signal?: AbortSignal,
): Promise<ContributionBatchResult> {
  if (!categories.length) throw new Error("Choose at least one impact category.")
  const tools = await readJson(await fetch(`${apiBase}/api/tools`, { signal })) as ToolDefinition[]
  const operation = tools.find((tool) => tool.name === "get_lca_contribution_graphs")
  if (!operation?.rest || operation.rest.method !== "POST") {
    throw new Error("The cumulative contribution operation is unavailable.")
  }
  const value = await readJson(await fetch(`${apiBase}${operation.rest.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product_graph: productGraph,
      categories,
      result_id: resultId,
    }),
    signal,
  }))
  if (
    !isObject(value)
    || value.result_id !== resultId
    || typeof value.method !== "string"
    || !Array.isArray(value.contribution_graphs)
  ) {
    throw new Error("The calculation engine returned invalid contribution graphs.")
  }
  return value as ContributionBatchResult
}

export async function getBackgroundActivityDetails({
  database,
  code,
  name,
  location,
}: {
  database: string
  code?: string
  name: string
  location?: string
}): Promise<BackgroundActivityDetails> {
  let activity: ActivitySearchResult | undefined
  let resolvedCode = code

  if (!resolvedCode) {
    const searchResult = await readJson(await fetch(`${apiBase}/api/database/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: name, database, limit: 25 }),
    }))
    if (!Array.isArray(searchResult)) throw new Error("The activity search response was invalid.")
    const exactMatches = (searchResult as ActivitySearchResult[]).filter((candidate) => (
      candidate.name === name
      && candidate.key?.[0] === database
      && (!location || candidate.location === location)
    ))
    if (exactMatches.length !== 1) {
      throw new Error(exactMatches.length
        ? `Background activity “${name}” is ambiguous; add its code to the YAML.`
        : `Background activity “${name}” was not found in ${database}.`)
    }
    activity = exactMatches[0]
    resolvedCode = activity.key[1]
  } else {
    // activity-inputs identifies exchanges but may omit activity metadata such
    // as the reference unit. Enrich code-based lookups from the stable search
    // key so background graphs retain the database's exact labels and units.
    const searchResult = await readJson(await fetch(`${apiBase}/api/database/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: name, database, limit: 25 }),
    }))
    if (Array.isArray(searchResult)) {
      activity = (searchResult as ActivitySearchResult[]).find((candidate) => (
        candidate.key?.[0] === database && candidate.key?.[1] === resolvedCode
      ))
    }
  }

  const exchanges = await readJson(await fetch(`${apiBase}/api/database/activity-inputs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ database, code: resolvedCode, limit: 500 }),
  }))
  if (!Array.isArray(exchanges)) throw new Error("The activity-input response was invalid.")

  const production = (exchanges as ActivityExchange[]).find((exchange) => exchange.exchange_type === "production")
  return {
    database,
    code: resolvedCode,
    name: activity?.name ?? production?.input_name ?? name,
    location: activity?.location ?? production?.input_location ?? location ?? null,
    referenceProduct: activity?.reference_product ?? production?.input_product ?? null,
    unit: activity?.unit ?? production?.unit ?? null,
    exchanges: exchanges as ActivityExchange[],
  }
}

const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ")
const inventoryFlowLabel = (name: string) => {
  const base = name.split(/[|,]/)[0].trim()
  const symbol = chemicalFlowLabel(base)
    .replaceAll("₂", "2")
    .replaceAll("₃", "3")
    .replaceAll("₄", "4")
    .replaceAll("ₓ", "x")
  return symbol === base ? name : `${name} (${symbol})`
}
const indicatorAbbreviations: Record<string, string> = {
  "ecotoxicity: freshwater": "FETP",
  "eutrophication potential": "EP",
  "human toxicity: carcinogenic": "HTPC",
  "human toxicity: non-carcinogenic": "HTPNC",
}

export const impactCategoryAbbreviation = (category: string) => {
  const indicator = category.split("|").at(-1)?.trim() || category
  const parenthetical = indicator.match(/\(([^()]*)\)\s*$/)
  if (parenthetical) return parenthetical[1].toUpperCase()
  const known = indicatorAbbreviations[indicator.toLowerCase()]
  if (known) return known
  const words = indicator.match(/[A-Za-z0-9]+/g) ?? []
  const significant = words.filter((word) => !["and", "of", "to", "in", "the", "potential"].includes(word.toLowerCase()))
  return (significant.map((word) => word[0]).join("") || indicator).toUpperCase()
}

const sentenceCase = (value: string) => value ? `${value[0].toUpperCase()}${value.slice(1)}` : value

const spreadsheetImpactNames: Record<string, string> = {
  "acidification": "Acidification",
  "climate change": "Climate change",
  "climate change: biogenic": "Climate change (biogenic)",
  "climate change: fossil": "Climate change (fossil)",
  "climate change: land use and land use change": "Climate change (land use)",
  "ecotoxicity: freshwater": "Ecotoxicity freshwater",
  "ecotoxicity: freshwater, inorganics": "Ecotoxicity freshwater (inorganics)",
  "ecotoxicity: freshwater, organics": "Ecotoxicity freshwater (organics)",
  "energy resources: non-renewable": "Resource use fossils",
  "eutrophication: freshwater": "Eutrophication freshwater",
  "eutrophication: marine": "Eutrophication marine",
  "eutrophication: terrestrial": "Eutrophication terrestrial",
  "human toxicity: carcinogenic": "Human toxicity cancer",
  "human toxicity: carcinogenic, inorganics": "Human toxicity cancer (inorganics)",
  "human toxicity: carcinogenic, organics": "Human toxicity cancer (organics)",
  "human toxicity: non-carcinogenic": "Human toxicity non-cancer",
  "human toxicity: non-carcinogenic, inorganics": "Human toxicity non-cancer (inorganics)",
  "human toxicity: non-carcinogenic, organics": "Human toxicity non-cancer (organics)",
  "ionising radiation: human health": "Ionising radiation (human health)",
  "land use": "Land use",
  "material resources: metals/minerals": "Resource use minerals and metals",
  "ozone depletion": "Ozone depletion",
  "particulate matter formation": "Particulate matter",
  "photochemical oxidant formation: human health": "Photochemical ozone formation (human health)",
  "water use": "Water use",
}

export const impactCategoryDisplayName = (category: string) => {
  const parts = category.split("|").map((part) => part.trim()).filter(Boolean)
  const categoryName = parts[0] || category.trim()
  const spreadsheetName = spreadsheetImpactNames[categoryName.toLowerCase()]
  if (spreadsheetName) return spreadsheetName
  const climateMatch = categoryName.match(/^climate change\s*(?::|[-–—])\s*(.+)$/i)
  if (climateMatch) return `Climate change (${climateMatch[1].trim().toLowerCase()})`

  const normalized = parts.join(" ").toLowerCase()
  if (/climate change|global warming/.test(normalized)) {
    const subtype = normalized.match(/\b(fossil|biogenic|land use(?: and land use change)?|luluc)\b/)
    if (subtype) return `Climate change (${subtype[1] === "luluc" ? "land use" : subtype[1]})`
    return "Climate change"
  }

  return sentenceCase(categoryName.replace(/\s*\([^()]*(?:gwp|ctp|ftp|htp|irp|odp|pmp|ep|ap)[^()]*\)\s*$/i, "").trim())
}

export function lcaResultToMarkdown(result: LcaResult, decimalPlaces = 5, showAllDecimalPlaces = false) {
  const formatNumber = (value: number) => new Intl.NumberFormat("en", {
    minimumFractionDigits: showAllDecimalPlaces ? 0 : decimalPlaces,
    maximumFractionDigits: showAllDecimalPlaces ? 20 : decimalPlaces,
  }).format(value)
  const impactRows = Object.entries(result.lcia)
    .sort(([, left], [, right]) => Number((left.score ?? 0) === 0) - Number((right.score ?? 0) === 0))
    .map(([category, value]) => `| ${cell(impactCategoryDisplayName(category))} | ${formatNumber(value.score ?? 0)} | ${cell(value.unit)} |`)
  const inventoryRows = Object.entries(result.lci).map(([flow, value]) => `| ${cell(inventoryFlowLabel(flow))} | ${formatNumber(value.amount ?? 0)} | ${cell(value.unit)} | ${cell(value.type ?? "—")} |`)

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
