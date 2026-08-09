import { MarkerType, type Edge, type Node } from "@xyflow/react"
import { parse } from "yaml"
import type { ProcessNodeData } from "../components/ProcessNode"
import { chemicalFlowLabel } from "./flowLabels"

type FlowAmount = {
  flow: string
  amount: number
  unit?: string
  product_id?: string
  provider_id?: string
  database?: string
  code?: string
  location?: string
}
type YamlProcess = {
  id?: string
  name: string
  reference_output: FlowAmount
  inputs?: FlowAmount[]
  emissions?: FlowAmount[]
  extractions?: Array<FlowAmount & { unit?: string }>
  resources?: Array<FlowAmount & { unit?: string }>
  resource_inputs?: Array<FlowAmount & { unit?: string }>
}
type ProductGraph = {
  name?: string
  functional_unit?: { amount?: number; unit?: string }
  products?: Array<{ id?: string; name: string; unit: string }>
  processes: YamlProcess[]
  reference_process: string
  reference_process_id?: string
}

export type InventoryRequirement = {
  process: string
  product: string
  amount: number
  unit: string
}

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
const processIdFor = (process: YamlProcess, index: number) => process.id ?? idFor(process.name, index)
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

type ValidatedProductGraph = {
  graph: ProductGraph
  processIds: Map<YamlProcess, string>
  processesById: Map<string, YamlProcess>
  providersByFlow: Map<string, YamlProcess[]>
  reference: YamlProcess
  providerFor: (input: FlowAmount, consumer: YamlProcess) => YamlProcess | undefined
}

const duplicateValues = (values: string[]) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]
const quotedList = (values: string[]) => values.map((value) => `“${value}”`).join(", ")

function parseAndValidateProductGraph(source: string): ValidatedProductGraph {
  const graph = parse(source) as ProductGraph
  if (!graph || !Array.isArray(graph.processes) || !graph.processes.length) throw new Error("YAML must include a non-empty processes list.")
  if (!graph.reference_process) throw new Error("YAML must define reference_process.")

  graph.processes.forEach((process, index) => {
    if (!process?.name?.trim()) throw new Error(`Process ${index + 1} must have a non-empty name.`)
    if (process.id !== undefined && !process.id.trim()) throw new Error(`Process “${process.name}” must not have an empty ID.`)
    if (!process.reference_output?.flow?.trim() || !Number.isFinite(process.reference_output.amount) || !(process.reference_output.amount > 0)) {
      throw new Error(`Process “${process.name}” needs a flow and a positive, finite reference_output amount.`)
    }
  })

  const duplicateNames = duplicateValues(graph.processes.map((process) => process.name))
  if (duplicateNames.length) throw new Error(`Duplicate process name${duplicateNames.length === 1 ? "" : "s"}: ${quotedList(duplicateNames)}.`)

  const processIds = new Map(graph.processes.map((process, index) => [process, processIdFor(process, index)]))
  const duplicateProcessIds = duplicateValues([...processIds.values()])
  if (duplicateProcessIds.length) throw new Error(`Duplicate process ID${duplicateProcessIds.length === 1 ? "" : "s"}: ${quotedList(duplicateProcessIds)}.`)
  const processesById = new Map(graph.processes.map((process) => [processIds.get(process)!, process]))

  const products = graph.products ?? []
  products.forEach((product, index) => {
    if (!product?.name?.trim()) throw new Error(`Product ${index + 1} must have a non-empty name.`)
    if (product.id !== undefined && !product.id.trim()) throw new Error(`Product “${product.name}” must not have an empty ID.`)
  })
  const duplicateProductNames = duplicateValues(products.map((product) => product.name))
  if (duplicateProductNames.length) throw new Error(`Duplicate product name${duplicateProductNames.length === 1 ? "" : "s"}: ${quotedList(duplicateProductNames)}.`)
  const productIds = products.filter((product) => product.id).map((product) => product.id!)
  const duplicateProductIds = duplicateValues(productIds)
  if (duplicateProductIds.length) throw new Error(`Duplicate product ID${duplicateProductIds.length === 1 ? "" : "s"}: ${quotedList(duplicateProductIds)}.`)
  const productsById = new Map(products.filter((product) => product.id).map((product) => [product.id!, product]))

  const providersByFlow = new Map<string, YamlProcess[]>()
  graph.processes.forEach((process) => providersByFlow.set(
    process.reference_output.flow,
    [...(providersByFlow.get(process.reference_output.flow) ?? []), process],
  ))

  const validateProductReference = (amount: FlowAmount, context: string) => {
    if (!amount.product_id) return
    const product = productsById.get(amount.product_id)
    if (!product) throw new Error(`${context} references unknown product_id “${amount.product_id}”.`)
    if (product.name !== amount.flow) {
      throw new Error(`${context} uses flow “${amount.flow}”, but product_id “${amount.product_id}” identifies “${product.name}”.`)
    }
  }

  graph.processes.forEach((process) => {
    validateProductReference(process.reference_output, `Reference output of process “${process.name}”`)
    for (const input of process.inputs ?? []) {
      const context = `Input “${input.flow || "(unnamed)"}” of process “${process.name}”`
      if (!input.flow?.trim()) throw new Error(`${context} must have a non-empty flow.`)
      if (!Number.isFinite(input.amount) || input.amount < 0) throw new Error(`${context} must have a non-negative, finite amount.`)
      validateProductReference(input, context)
      if (input.database && input.provider_id) throw new Error(`${context} cannot define both database and provider_id.`)
      if (input.database) continue
      if (input.provider_id) {
        const provider = processesById.get(input.provider_id)
        if (!provider) throw new Error(`${context} references unknown provider_id “${input.provider_id}”.`)
        if (provider.reference_output.flow !== input.flow) {
          throw new Error(`${context} selects provider “${input.provider_id}”, which produces “${provider.reference_output.flow}”.`)
        }
        continue
      }
      const candidates = providersByFlow.get(input.flow) ?? []
      if (!candidates.length) throw new Error(`${context} has no foreground provider. Add provider_id or a background database reference.`)
      if (candidates.length > 1) {
        throw new Error(`${context} is ambiguous because ${candidates.length} processes produce this flow (${quotedList(candidates.map((candidate) => processIds.get(candidate)!))}). Add provider_id.`)
      }
    }
  })

  const referenceByName = graph.processes.find((process) => process.name === graph.reference_process)
  if (!referenceByName) throw new Error(`Reference process “${graph.reference_process}” was not found.`)
  const referenceById = graph.reference_process_id ? processesById.get(graph.reference_process_id) : undefined
  if (graph.reference_process_id && !referenceById) throw new Error(`Reference process ID “${graph.reference_process_id}” was not found.`)
  if (referenceById && referenceById !== referenceByName) {
    throw new Error(`reference_process “${graph.reference_process}” and reference_process_id “${graph.reference_process_id}” identify different processes.`)
  }
  const reference = referenceById ?? referenceByName

  return {
    graph,
    processIds,
    processesById,
    providersByFlow,
    reference,
    providerFor: (input) => input.database
      ? undefined
      : input.provider_id
        ? processesById.get(input.provider_id)
        : providersByFlow.get(input.flow)?.[0],
  }
}

export function validateProductGraphYaml(source: string): void {
  parseAndValidateProductGraph(source)
}

export function buildGraphFromYaml(
  source: string,
  mode: "scaled" | "structure" = "structure",
  scalingVector?: Record<string, number>,
  decimalPlaces = 5,
): { name: string; nodes: Node<ProcessNodeData>[]; edges: Edge[] } {
  const displayNumber = (value: number) => value.toFixed(decimalPlaces)
  const { graph, processIds, reference, providerFor } = parseAndValidateProductGraph(source)
  const ids = new Map(graph.processes.map((process) => [process.name, processIds.get(process)!]))
  const backgroundInputs = new Map<string, FlowAmount>()
  graph.processes.forEach((process) => process.inputs?.forEach((input) => {
    if (input.database) backgroundInputs.set(backgroundKeyFor(input), input)
  }))
  const productUnits = new Map((graph.products ?? []).map((product) => [product.name, product.unit]))
  const scales = new Map<string, number>([[reference.name, (graph.functional_unit?.amount ?? 1) / reference.reference_output.amount]])
  const queue = [reference]
  while (queue.length) {
    const consumer = queue.shift()!
    const consumerScale = scales.get(consumer.name) ?? 0
    for (const input of consumer.inputs ?? []) {
      if (input.database) continue
      const provider = providerFor(input, consumer)
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
    const isReference = process === reference
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
      const provider = providerFor(input, consumer)
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
