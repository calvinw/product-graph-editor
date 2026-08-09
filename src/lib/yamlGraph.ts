import { MarkerType, type Edge, type Node } from "@xyflow/react"
import { parse } from "yaml"
import type { MaterialMetadata, ProcessNodeData } from "../components/ProcessNode"
import { chemicalFlowLabel } from "./flowLabels"

type FlowAmount = {
  flow: string
  amount: number
  unit?: string
  database?: string
  code?: string
  location?: string
}
type YamlProcess = {
  name: string
  stage?: string
  location?: string
  source?: { name?: string; dataset_code?: string }
  reference_output: FlowAmount
  inputs?: FlowAmount[]
  emissions?: FlowAmount[]
  extractions?: Array<FlowAmount & { unit?: string }>
  resources?: Array<FlowAmount & { unit?: string }>
  resource_inputs?: Array<FlowAmount & { unit?: string }>
}
type YamlProduct = {
  name: string
  unit: string
  category?: string
  material_family?: string
  composition?: Record<string, number>
  geography?: string
  data_year?: number
  source?: { name?: string; dataset_code?: string }
  recycled_content?: number
  data_quality?: { confidence?: string; notes?: string }
}
type ProductGraph = {
  name?: string
  functional_unit?: { amount?: number; unit?: string }
  products?: YamlProduct[]
  processes: YamlProcess[]
  reference_process: string
}

export type InventoryRequirement = {
  process: string
  product: string
  amount: number
  unit: string
}

export type MaterialCatalogRow = {
  name: string
  unit: string
  category: string
  materialFamily: string
  composition: string
  recycledContent: number | null
  geography: string
  dataYear: number | null
  source: string
  datasetCode: string
  confidence: string
  producedBy: string[]
  usedBy: string[]
  missingFields: string[]
}

export type ProcessCatalogRow = {
  name: string
  stage: string
  location: string
  inputCount: number
  output: string
  source: string
  datasetCode: string
  missingFields: string[]
}

export type ProductGraphDataCatalog = {
  materials: MaterialCatalogRow[]
  processes: ProcessCatalogRow[]
}

const csvCell = (value: string | number | null) => {
  const text = value === null ? "" : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const rowsToCsv = (rows: Array<Array<string | number | null>>) => (
  `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
)

export function materialCatalogToCsv(rows: MaterialCatalogRow[]) {
  return rowsToCsv([
    ["Material", "Unit", "Category", "Material family", "Composition", "Recycled content (%)", "Geography", "Data year", "Source", "Dataset code", "Confidence", "Produced by", "Used by", "Missing fields"],
    ...rows.map((row) => [
      row.name, row.unit, row.category, row.materialFamily, row.composition,
      row.recycledContent, row.geography, row.dataYear, row.source, row.datasetCode,
      row.confidence, row.producedBy.join("; "), row.usedBy.join("; "), row.missingFields.join("; "),
    ]),
  ])
}

export function processCatalogToCsv(rows: ProcessCatalogRow[]) {
  return rowsToCsv([
    ["Process", "Lifecycle stage", "Location", "Input count", "Reference output", "Source", "Dataset code", "Missing fields"],
    ...rows.map((row) => [
      row.name, row.stage, row.location, row.inputCount, row.output,
      row.source, row.datasetCode, row.missingFields.join("; "),
    ]),
  ])
}

export const lifecycleStages = ["raw-material", "manufacturing", "transport", "assembly", "use", "end-of-life"] as const

export function buildInventoryRequirements(source: string, scalingVector: Record<string, number>): InventoryRequirement[] {
  const graph = parse(source) as ProductGraph
  if (!graph || !Array.isArray(graph.processes)) throw new Error("YAML must include a processes list.")
  const productUnits = new Map((graph.products ?? []).map((product) => [product.name, product.unit]))
  return graph.processes.map((process) => ({
    process: process.name,
    product: process.reference_output.flow,
    amount: (scalingVector[process.name] ?? 0) * process.reference_output.amount,
    unit: process.reference_output.unit ?? productUnits.get(process.reference_output.flow) ?? "",
  }))
}

export const nodeScopeColors = { foreground: "#a78bfa", background: "#38bdf8" }
const round = (value: number) => Number(value.toFixed(6))
const idFor = (name: string, index: number) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "process"}-${index}`
const backgroundKeyFor = (input: FlowAmount) => input.code
  ? `${input.database}\u001f${input.code}`
  : `${input.database}\u001f${input.flow}\u001f${input.location ?? ""}`
const stableHash = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16).padStart(8, "0")
}
const backgroundIdFor = (input: FlowAmount) => {
  const slug = input.flow.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "activity"
  return `background-${slug}-${stableHash(backgroundKeyFor(input))}`
}

const optionalNonEmptyString = (value: unknown, path: string) => {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) throw new Error(`${path} must be a non-empty string.`)
}

const materialMetadataFor = (product: YamlProduct | undefined): MaterialMetadata | undefined => {
  if (!product) return undefined
  const metadata: MaterialMetadata = {
    category: product.category,
    materialFamily: product.material_family,
    composition: product.composition
      ? Object.entries(product.composition).map(([material, percentage]) => ({ material, percentage }))
      : undefined,
    geography: product.geography,
    dataYear: product.data_year,
    sourceName: product.source?.name,
    datasetCode: product.source?.dataset_code,
    recycledContent: product.recycled_content,
    confidence: product.data_quality?.confidence as MaterialMetadata["confidence"],
    qualityNotes: product.data_quality?.notes,
  }
  return Object.values(metadata).some((value) => value !== undefined) ? metadata : undefined
}

function validateProducts(products: YamlProduct[]) {
  const names = new Set<string>()
  products.forEach((product, index) => {
    const path = `products[${index}]`
    if (!product || typeof product !== "object") throw new Error(`${path} must be a mapping.`)
    if (typeof product.name !== "string" || !product.name.trim()) throw new Error(`${path}.name must be a non-empty string.`)
    if (names.has(product.name)) throw new Error(`Duplicate product name “${product.name}”.`)
    names.add(product.name)
    if (typeof product.unit !== "string" || !product.unit.trim()) throw new Error(`${path}.unit must be a non-empty string.`)
    optionalNonEmptyString(product.category, `${path}.category`)
    optionalNonEmptyString(product.material_family, `${path}.material_family`)
    optionalNonEmptyString(product.geography, `${path}.geography`)

    if (product.data_year !== undefined && (!Number.isInteger(product.data_year) || product.data_year < 1900 || product.data_year > new Date().getFullYear() + 1)) {
      throw new Error(`${path}.data_year must be a four-digit year between 1900 and ${new Date().getFullYear() + 1}.`)
    }
    if (product.recycled_content !== undefined && (!Number.isFinite(product.recycled_content) || product.recycled_content < 0 || product.recycled_content > 100)) {
      throw new Error(`${path}.recycled_content must be a percentage between 0 and 100.`)
    }
    if (product.composition !== undefined) {
      if (!product.composition || typeof product.composition !== "object" || Array.isArray(product.composition) || !Object.keys(product.composition).length) {
        throw new Error(`${path}.composition must be a non-empty mapping of material names to percentages.`)
      }
      let total = 0
      for (const [material, percentage] of Object.entries(product.composition)) {
        if (!material.trim() || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
          throw new Error(`${path}.composition entries must use non-empty material names and percentages between 0 and 100.`)
        }
        total += percentage
      }
      if (Math.abs(total - 100) > 0.001) throw new Error(`${path}.composition percentages must total 100; received ${total}.`)
    }
    if (product.source !== undefined) {
      if (!product.source || typeof product.source !== "object" || Array.isArray(product.source)) throw new Error(`${path}.source must be a mapping.`)
      optionalNonEmptyString(product.source.name, `${path}.source.name`)
      optionalNonEmptyString(product.source.dataset_code, `${path}.source.dataset_code`)
      if (!product.source.name) throw new Error(`${path}.source.name is required when source is provided.`)
    }
    if (product.data_quality !== undefined) {
      if (!product.data_quality || typeof product.data_quality !== "object" || Array.isArray(product.data_quality)) throw new Error(`${path}.data_quality must be a mapping.`)
      if (product.data_quality.confidence !== undefined && !["low", "medium", "high"].includes(product.data_quality.confidence)) {
        throw new Error(`${path}.data_quality.confidence must be low, medium, or high.`)
      }
      optionalNonEmptyString(product.data_quality.notes, `${path}.data_quality.notes`)
    }
  })
}

function validateProcessMetadata(process: YamlProcess, index: number) {
  const path = `processes[${index}]`
  optionalNonEmptyString(process.stage, `${path}.stage`)
  optionalNonEmptyString(process.location, `${path}.location`)
  if (process.stage && !lifecycleStages.includes(process.stage as (typeof lifecycleStages)[number])) {
    throw new Error(`${path}.stage must be one of: ${lifecycleStages.join(", ")}.`)
  }
  if (process.source !== undefined) {
    if (!process.source || typeof process.source !== "object" || Array.isArray(process.source)) throw new Error(`${path}.source must be a mapping.`)
    optionalNonEmptyString(process.source.name, `${path}.source.name`)
    optionalNonEmptyString(process.source.dataset_code, `${path}.source.dataset_code`)
    if (!process.source.name) throw new Error(`${path}.source.name is required when source is provided.`)
  }
}

export function buildProductGraphDataCatalog(source: string): ProductGraphDataCatalog {
  const graph = parse(source) as ProductGraph
  if (!graph || !Array.isArray(graph.processes)) throw new Error("YAML must include a processes list.")
  if (graph.products !== undefined && !Array.isArray(graph.products)) throw new Error("YAML products must be a list.")
  const products = graph.products ?? []
  validateProducts(products)
  graph.processes.forEach(validateProcessMetadata)

  const materials = products.map((product): MaterialCatalogRow => {
    const missingFields = [
      !product.category && "category",
      !product.material_family && "material family",
      !product.geography && "geography",
      product.data_year === undefined && "data year",
      !product.source?.name && "source",
      !product.data_quality?.confidence && "quality",
    ].filter((field): field is string => Boolean(field))
    return {
      name: product.name,
      unit: product.unit,
      category: product.category ?? "—",
      materialFamily: product.material_family ?? "—",
      composition: product.composition
        ? Object.entries(product.composition).map(([name, percentage]) => `${percentage}% ${name}`).join(", ")
        : "—",
      recycledContent: product.recycled_content ?? null,
      geography: product.geography ?? "—",
      dataYear: product.data_year ?? null,
      source: product.source?.name ?? "—",
      datasetCode: product.source?.dataset_code ?? "—",
      confidence: product.data_quality?.confidence ?? "—",
      producedBy: graph.processes.filter((process) => process.reference_output?.flow === product.name).map((process) => process.name),
      usedBy: graph.processes.filter((process) => process.inputs?.some((input) => input.flow === product.name)).map((process) => process.name),
      missingFields,
    }
  })
  const processes = graph.processes.map((process): ProcessCatalogRow => {
    const missingFields = [
      !process.stage && "lifecycle stage",
      !process.location && "location",
      !process.source?.name && "source",
    ].filter((field): field is string => Boolean(field))
    return {
      name: process.name,
      stage: process.stage ?? "—",
      location: process.location ?? "—",
      inputCount: process.inputs?.length ?? 0,
      output: process.reference_output?.flow ?? "—",
      source: process.source?.name ?? "—",
      datasetCode: process.source?.dataset_code ?? "—",
      missingFields,
    }
  })
  return { materials, processes }
}

export function buildGraphFromYaml(
  source: string,
  mode: "scaled" | "structure" = "structure",
  scalingVector?: Record<string, number>,
  decimalPlaces = 5,
): { name: string; nodes: Node<ProcessNodeData>[]; edges: Edge[] } {
  const displayNumber = (value: number) => value.toFixed(decimalPlaces)
  const graph = parse(source) as ProductGraph
  if (!graph || !Array.isArray(graph.processes) || !graph.processes.length) throw new Error("YAML must include a non-empty processes list.")
  if (!graph.reference_process) throw new Error("YAML must define reference_process.")
  if (graph.products !== undefined && !Array.isArray(graph.products)) throw new Error("YAML products must be a list.")
  validateProducts(graph.products ?? [])

  graph.processes.forEach((process, index) => {
    validateProcessMetadata(process, index)
    if (!process.name || !process.reference_output?.flow || !(process.reference_output.amount > 0)) {
      throw new Error("Every process needs a name and a positive reference_output.")
    }
  })

  const ids = new Map(graph.processes.map((process, index) => [process.name, idFor(process.name, index)]))
  const providers = new Map(graph.processes.map((process) => [process.reference_output.flow, process]))
  const backgroundInputs = new Map<string, FlowAmount>()
  graph.processes.forEach((process) => process.inputs?.forEach((input) => {
    if (input.database) backgroundInputs.set(backgroundKeyFor(input), input)
  }))
  const productUnits = new Map((graph.products ?? []).map((product) => [product.name, product.unit]))
  const productsByName = new Map((graph.products ?? []).map((product) => [product.name, product]))
  const reference = graph.processes.find((process) => process.name === graph.reference_process)
  if (!reference) throw new Error(`Reference process “${graph.reference_process}” was not found.`)

  const scales = new Map<string, number>([[reference.name, (graph.functional_unit?.amount ?? 1) / reference.reference_output.amount]])
  const queue = [reference]
  while (queue.length) {
    const consumer = queue.shift()!
    const consumerScale = scales.get(consumer.name) ?? 0
    for (const input of consumer.inputs ?? []) {
      if (input.database) continue
      const provider = providers.get(input.flow)
      if (!provider) continue
      const requiredScale = consumerScale * input.amount / provider.reference_output.amount
      if (requiredScale > (scales.get(provider.name) ?? 0)) {
        scales.set(provider.name, requiredScale)
        queue.push(provider)
      }
    }
  }

  if (mode === "scaled") {
    if (!scalingVector) throw new Error("Calculate LCA results before viewing the scaled graph.")
    graph.processes.forEach((process) => scales.set(process.name, scalingVector[process.name] ?? 0))
  }

  const backgroundDemands = new Map<string, { amount: number; unit?: string }>()
  graph.processes.forEach((consumer) => (consumer.inputs ?? []).forEach((input) => {
    if (!input.database) return
    const key = backgroundKeyFor(input)
    const current = backgroundDemands.get(key)
    backgroundDemands.set(key, {
      amount: (current?.amount ?? 0) + input.amount * (scales.get(consumer.name) ?? 0),
      unit: current?.unit ?? input.unit,
    })
  }))

  const foregroundNodes: Node<ProcessNodeData>[] = graph.processes.map((process) => {
    const scale = scales.get(process.name) ?? 0
    const isReference = process.name === graph.reference_process
    const outputUnit = productUnits.get(process.reference_output.flow) ?? "unit"
    const kind = isReference ? "product" : !process.inputs?.length ? (outputUnit === "unit" ? "component" : "material") : "process"
    const outputAmount = round(process.reference_output.amount * scale)
    return {
      id: ids.get(process.name)!, type: "process", position: { x: 0, y: 0 },
      data: {
        label: process.name,
        kind,
        color: nodeScopeColors.foreground,
        scope: "foreground",
        detail: mode === "scaled"
          ? `Scaled contribution: ${displayNumber(outputAmount)} ${outputUnit} ${process.reference_output.flow}`
          : `Output flow: ${process.reference_output.flow}`,
        showAmounts: mode === "scaled",
        referenceInputs: (process.inputs ?? []).map((input) => ({
          label: input.flow,
          kind: input.database ? "background input" : "foreground input",
          color: input.database ? nodeScopeColors.background : nodeScopeColors.foreground,
          amount: input.amount,
          unit: input.unit ?? productUnits.get(input.flow),
        })),
        referenceOutputs: [{
          label: process.reference_output.flow,
          kind: "reference output",
          color: nodeScopeColors.foreground,
          amount: process.reference_output.amount,
          unit: process.reference_output.unit ?? outputUnit,
        }],
        materialMetadata: materialMetadataFor(productsByName.get(process.reference_output.flow)),
        emissions: (process.emissions ?? []).map((emission) => ({ label: chemicalFlowLabel(emission.flow), amount: round(emission.amount * scale), unit: "kg" })),
        referenceEmissions: (process.emissions ?? []).map((emission) => ({
          label: chemicalFlowLabel(emission.flow), amount: emission.amount, unit: emission.unit ?? "kg",
        })),
        extractions: (process.extractions ?? process.resources ?? process.resource_inputs ?? []).map((extraction) => ({
          label: chemicalFlowLabel(extraction.flow),
          amount: round(extraction.amount * scale),
          unit: extraction.unit ?? "kg",
        })),
        referenceExtractions: (process.extractions ?? process.resources ?? process.resource_inputs ?? []).map((extraction) => ({
          label: chemicalFlowLabel(extraction.flow), amount: extraction.amount, unit: extraction.unit ?? "kg",
        })),
      },
    }
  })
  const backgroundNodes: Node<ProcessNodeData>[] = [...backgroundInputs.entries()].map(([key, input]) => {
    const demand = backgroundDemands.get(key)
    return {
      id: backgroundIdFor(input), type: "process", position: { x: 0, y: 0 },
      data: {
        label: input.flow,
        kind: "process",
        color: nodeScopeColors.background,
        scope: "background",
        database: input.database,
        code: input.code,
        location: input.location,
        backgroundDemand: demand?.amount ?? 0,
        backgroundDemandUnit: demand?.unit,
        detail: `Background activity · ${input.database}${input.location ? ` · ${input.location}` : ""}`,
        showAmounts: mode === "scaled",
      },
    }
  })
  const nodes = [...foregroundNodes, ...backgroundNodes]

  const edges: Edge[] = []
  for (const [consumerIndex, consumer] of graph.processes.entries()) {
    for (const [inputIndex, input] of (consumer.inputs ?? []).entries()) {
      const provider = input.database ? undefined : providers.get(input.flow)
      const source = input.database ? backgroundIdFor(input) : provider ? ids.get(provider.name)! : undefined
      if (!source) continue
      const amount = round(input.amount * (scales.get(consumer.name) ?? 0))
      const unit = input.unit ?? productUnits.get(input.flow)
      edges.push({
        id: `${source}-${ids.get(consumer.name)}-${consumerIndex}-${inputIndex}`,
        source, target: ids.get(consumer.name)!, label: mode === "scaled" ? `${input.flow} · ${displayNumber(amount)}${unit ? ` ${unit}` : ""}` : input.flow,
        style: { stroke: "#343941", strokeWidth: 1.5 },
        labelStyle: { fill: "#9aa2ae", fontSize: 12, fontWeight: 650 },
        labelBgStyle: { fill: "#111318", fillOpacity: 0.92 }, labelBgPadding: [5, 3], labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#343941", width: 16, height: 16 },
      })
    }
  }

  return { name: graph.name ?? "Product graph", nodes, edges }
}
