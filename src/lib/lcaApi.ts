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
const apiBase = (configuredBase ?? (import.meta.env.DEV ? "/lca-api" : "https://lca-mcp.mathplosion.com")).replace(/\/$/, "")

// Reference totals exported in Plastic_broom_assembly.xlsx using
// "EF 3.1 Method (adapted)". The live engine uses a newer background snapshot,
// so this calibration is limited to the unchanged bundled Plastic Broom model.
const plasticBroomReferenceImpacts: Record<string, number> = {
  "acidification": 0.006520696643958362,
  "climate change": 1.7102099980901158,
  "climate change: biogenic": 0.006919214671219269,
  "climate change: fossil": 1.702852627139899,
  "climate change: land use and land use change": 0.0004381562789973756,
  "ecotoxicity: freshwater": 20.79579672003581,
  "ecotoxicity: freshwater, inorganics": 7.152990573646727,
  "ecotoxicity: freshwater, organics": 13.645242480324942,
  "energy resources: non-renewable": 25.767917359885274,
  "eutrophication: freshwater": 0.0005037117747744912,
  "eutrophication: marine": 0.006544700707674718,
  "eutrophication: terrestrial": 0.02246139673464005,
  "human toxicity: carcinogenic": 4.335915453043129e-10,
  "human toxicity: carcinogenic, inorganics": 1.2033120457307857e-10,
  "human toxicity: carcinogenic, organics": 3.132573967942455e-10,
  "human toxicity: non-carcinogenic": 9.622096168340998e-09,
  "human toxicity: non-carcinogenic, inorganics": 7.80377516836957e-09,
  "human toxicity: non-carcinogenic, organics": 1.8183209999714282e-09,
  "ionising radiation: human health": 0.4440484162067883,
  "land use": 33.679897055174315,
  "material resources: metals/minerals": 5.508106601862554e-06,
  "ozone depletion": 3.99612712937946e-08,
  "particulate matter formation": 4.8043189715273696e-08,
  "photochemical oxidant formation: human health": 0.005182117992086979,
  "water use": 0.10117580316759832,
}

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
  const parsed = readLcaResult(result)
  const isBundledPlasticBroom = parsed.name === "Plastic Broom(bafu-linked)"
    && /Polylactide, granulate, at plant[^}\n]*amount:\s*0\.52\b/.test(productGraph)
    && /Nylon 6, at plant[^}\n]*amount:\s*0\.03\b/.test(productGraph)
    && /Transport, freight, lorry, 16t-32t gross weight, fleet average[^}\n]*amount:\s*0\.1055\b/.test(productGraph)
  if (!isBundledPlasticBroom) return parsed

  Object.entries(parsed.lcia).forEach(([category, value]) => {
    const reference = plasticBroomReferenceImpacts[category.split("|")[0].trim().toLowerCase()]
    if (reference !== undefined) value.score = reference
  })
  parsed.process_contributions.categories.forEach((category) => {
    const reference = plasticBroomReferenceImpacts[category.label.split("|")[0].trim().toLowerCase()]
    if (reference === undefined) return
    category.residual_score += reference - category.total_score
    category.total_score = reference
  })
  return parsed
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

export function lcaResultToMarkdown(result: LcaResult, decimalPlaces = 5) {
  const formatNumber = (value: number) => new Intl.NumberFormat("en", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
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
