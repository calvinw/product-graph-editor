import { MarkerType, type Edge, type Node } from "@xyflow/react"
import { parse } from "yaml"
import type { ProcessNodeData } from "../components/ProcessNode"
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
  products?: Array<{ name: string; unit: string }>
  processes: YamlProcess[]
  reference_process: string
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

  graph.processes.forEach((process) => {
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
  const reference = graph.processes.find((process) => process.name === graph.reference_process)
  if (!reference) throw new Error(`Reference process “${graph.reference_process}” was not found.`)

  // Demand on a provider is the SUM of what every consumer needs, not the
  // largest single requirement. Walking in topological order guarantees a
  // consumer's own scale is final before it distributes demand upstream.
  const byName = new Map(graph.processes.map((process) => [process.name, process]))
  const providerEdges = new Map<string, Array<{ provider: YamlProcess; amount: number }>>()
  const reachable = new Set<string>([reference.name])
  const discovery = [reference]
  while (discovery.length) {
    const consumer = discovery.pop()!
    const edges: Array<{ provider: YamlProcess; amount: number }> = []
    for (const input of consumer.inputs ?? []) {
      if (input.database) continue
      const provider = providers.get(input.flow)
      if (!provider) continue
      edges.push({ provider, amount: input.amount })
      if (!reachable.has(provider.name)) {
        reachable.add(provider.name)
        discovery.push(provider)
      }
    }
    providerEdges.set(consumer.name, edges)
  }

  const remainingConsumers = new Map<string, number>([...reachable].map((name) => [name, 0]))
  for (const name of reachable) {
    for (const edge of providerEdges.get(name) ?? []) {
      remainingConsumers.set(edge.provider.name, (remainingConsumers.get(edge.provider.name) ?? 0) + 1)
    }
  }

  const requiredOutput = new Map<string, number>([[reference.name, graph.functional_unit?.amount ?? 1]])
  const scales = new Map<string, number>()
  const ready = [...reachable].filter((name) => (remainingConsumers.get(name) ?? 0) === 0)
  while (ready.length) {
    const consumer = byName.get(ready.shift()!)!
    const scale = (requiredOutput.get(consumer.name) ?? 0) / consumer.reference_output.amount
    scales.set(consumer.name, scale)
    for (const { provider, amount } of providerEdges.get(consumer.name) ?? []) {
      requiredOutput.set(provider.name, (requiredOutput.get(provider.name) ?? 0) + scale * amount)
      const remaining = (remainingConsumers.get(provider.name) ?? 0) - 1
      remainingConsumers.set(provider.name, remaining)
      if (remaining === 0) ready.push(provider.name)
    }
  }
  // A foreground cycle leaves nodes unresolved; show the demand accumulated so
  // far rather than nothing. The engine remains the authority for scaled mode.
  for (const name of reachable) {
    if (scales.has(name)) continue
    const process = byName.get(name)!
    scales.set(name, (requiredOutput.get(name) ?? 0) / process.reference_output.amount)
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
