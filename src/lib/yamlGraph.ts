import { MarkerType, type Edge, type Node } from "@xyflow/react"
import { parse } from "yaml"
import type { ProcessNodeData } from "../components/ProcessNode"

/**
 * Makes background-input edges draggable.
 *
 * `draggableKeys` lists the links the engine published intensities for; only
 * those can be scored locally, so only those become scenario edges.
 */
export type ScenarioDecoration = {
  overrides: Record<string, number>
  draggableKeys: Set<string>
  baselineAmounts: Record<string, number>
  onChange?: (key: string, amount: number) => void
}
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

export type GraphStructure = {
  graph: ProductGraph
  ids: Map<string, string>
  providers: Map<string, YamlProcess>
  backgroundInputs: Map<string, FlowAmount>
  productUnits: Map<string, string>
  reference: YamlProcess
  byName: Map<string, YamlProcess>
}

/**
 * Parse and index the product graph. This is the expensive half -- it reads
 * YAML -- and it depends on nothing that a scenario drag changes, so it runs
 * once when new source is applied rather than once per frame.
 */
export function buildGraphStructure(source: string): GraphStructure {
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
  const byName = new Map(graph.processes.map((process) => [process.name, process]))
  return { graph, ids, providers, backgroundInputs, productUnits, reference, byName }
}

/**
 * Fill in every amount-derived value: scales, background demand, node data and
 * edge labels. Cheap, and safe to run on each frame of a drag.
 *
 * Node ids and ordering are stable across calls, so a caller may merge the
 * returned `data` onto already-positioned nodes without re-running layout.
 */
export function decorateAmounts(
  structure: GraphStructure,
  { mode = "structure", scalingVector, decimalPlaces = 5, scenario }: {
    mode?: "scaled" | "structure"
    scalingVector?: Record<string, number>
    decimalPlaces?: number
    scenario?: ScenarioDecoration
  } = {},
): { name: string; nodes: Node<ProcessNodeData>[]; edges: Edge[] } {
  const { graph, ids, providers, backgroundInputs, productUnits, reference, byName } = structure
  const displayNumber = (value: number) => value.toFixed(decimalPlaces)
  // An override stands in for the spec amount at every point it is consumed:
  // background demand, node rows, and edge labels. Showing it in one place only
  // would leave the rest of the graph disagreeing with the number being dragged.
  const amountFor = (processIndex: number, inputIndex: number, input: FlowAmount) => {
    if (!input.database || !scenario) return input.amount
    const override = scenario.overrides[`${processIndex}:${inputIndex}`]
    return Number.isFinite(override) ? override : input.amount
  }

  // Demand on a provider is the SUM of what every consumer needs, not the
  // largest single requirement. Walking in topological order guarantees a
  // consumer's own scale is final before it distributes demand upstream.
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
  graph.processes.forEach((consumer, consumerIndex) => (consumer.inputs ?? []).forEach((input, inputIndex) => {
    if (!input.database) return
    const key = backgroundKeyFor(input)
    const current = backgroundDemands.get(key)
    backgroundDemands.set(key, {
      amount: (current?.amount ?? 0) + amountFor(consumerIndex, inputIndex, input) * (scales.get(consumer.name) ?? 0),
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
        referenceInputs: (process.inputs ?? []).map((input, inputIndex) => ({
          label: input.flow,
          kind: input.database ? "background input" : "foreground input",
          color: input.database ? nodeScopeColors.background : nodeScopeColors.foreground,
          amount: amountFor(graph.processes.indexOf(process), inputIndex, input),
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
      const scenarioKey = `${consumerIndex}:${inputIndex}`
      const currentAmount = amountFor(consumerIndex, inputIndex, input)
      const amount = round(currentAmount * (scales.get(consumer.name) ?? 0))
      const unit = input.unit ?? productUnits.get(input.flow)
      const label = mode === "scaled" ? `${displayNumber(amount)}${unit ? ` ${unit}` : ""}` : input.flow
      const draggable = mode === "scaled" && Boolean(scenario?.draggableKeys.has(scenarioKey))
      edges.push({
        ...(draggable ? {
          type: "scenario",
          data: {
            scenarioKey,
            baselineAmount: scenario!.baselineAmounts[scenarioKey] ?? input.amount,
            amount: currentAmount,
            unit,
            scale: scales.get(consumer.name) ?? 0,
            label,
            onScenarioChange: scenario!.onChange,
          },
        } : {}),
        id: `${source}-${ids.get(consumer.name)}-${consumerIndex}-${inputIndex}`,
        source, target: ids.get(consumer.name)!, label: draggable ? undefined : label,
        style: { stroke: "#343941", strokeWidth: 2.5 },
        labelStyle: { fill: "#9aa2ae", fontSize: 19, fontWeight: 700 },
        labelBgStyle: { fill: "#111318", fillOpacity: 0.92 }, labelBgPadding: [7, 5], labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#343941", width: 18, height: 18 },
      })
    }
  }

  return { name: graph.name ?? "Product graph", nodes, edges }}

/** Backwards-compatible one-shot build: structure then decoration. */
export function buildGraphFromYaml(
  source: string,
  mode: "scaled" | "structure" = "structure",
  scalingVector?: Record<string, number>,
  decimalPlaces = 5,
): { name: string; nodes: Node<ProcessNodeData>[]; edges: Edge[] } {
  return decorateAmounts(buildGraphStructure(source), { mode, scalingVector, decimalPlaces })
}
