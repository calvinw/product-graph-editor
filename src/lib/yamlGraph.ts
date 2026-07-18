import { MarkerType, type Edge, type Node } from "@xyflow/react"
import { parse } from "yaml"
import type { ProcessNodeData } from "../components/ProcessNode"

type FlowAmount = { flow: string; amount: number }
type YamlProcess = {
  name: string
  reference_output: FlowAmount
  inputs?: FlowAmount[]
  emissions?: FlowAmount[]
}
type ProductGraph = {
  name?: string
  functional_unit?: { amount?: number; unit?: string }
  products?: Array<{ name: string; unit: string }>
  processes: YamlProcess[]
  reference_process: string
}

const colors = { material: "#38bdf8", process: "#a78bfa", component: "#fb923c", product: "#34d399" }
const emissionLabels: Record<string, string> = { "Carbon dioxide": "CO₂", Methane: "CH₄", "Nitrogen oxides": "NOₓ" }
const round = (value: number) => Number(value.toFixed(6))
const idFor = (name: string, index: number) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "process"}-${index}`

export function buildGraphFromYaml(source: string): { name: string; nodes: Node<ProcessNodeData>[]; edges: Edge[] } {
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
  const productUnits = new Map((graph.products ?? []).map((product) => [product.name, product.unit]))
  const reference = graph.processes.find((process) => process.name === graph.reference_process)
  if (!reference) throw new Error(`Reference process “${graph.reference_process}” was not found.`)

  const scales = new Map<string, number>([[reference.name, (graph.functional_unit?.amount ?? 1) / reference.reference_output.amount]])
  const queue = [reference]
  while (queue.length) {
    const consumer = queue.shift()!
    const consumerScale = scales.get(consumer.name) ?? 0
    for (const input of consumer.inputs ?? []) {
      const provider = providers.get(input.flow)
      if (!provider) continue
      const requiredScale = consumerScale * input.amount / provider.reference_output.amount
      if (requiredScale > (scales.get(provider.name) ?? 0)) {
        scales.set(provider.name, requiredScale)
        queue.push(provider)
      }
    }
  }

  const nodes: Node<ProcessNodeData>[] = graph.processes.map((process) => {
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
        color: colors[kind],
        detail: `Scaled contribution: ${outputAmount} ${outputUnit} ${process.reference_output.flow}`,
        emissions: (process.emissions ?? []).map((emission) => ({ label: emissionLabels[emission.flow] ?? emission.flow, amount: round(emission.amount * scale), unit: "kg" })),
      },
    }
  })

  const edges: Edge[] = []
  for (const consumer of graph.processes) {
    for (const input of consumer.inputs ?? []) {
      const provider = providers.get(input.flow)
      if (!provider) continue
      const amount = round(input.amount * (scales.get(consumer.name) ?? 0))
      edges.push({
        id: `${ids.get(provider.name)}-${ids.get(consumer.name)}-${input.flow}`,
        source: ids.get(provider.name)!, target: ids.get(consumer.name)!, label: `${input.flow} · ${amount}`,
        style: { stroke: "#343941", strokeWidth: 1.5 },
        labelStyle: { fill: "#7f8794", fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: "#111318", fillOpacity: 0.92 }, labelBgPadding: [5, 3], labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#343941", width: 16, height: 16 },
      })
    }
  }

  return { name: graph.name ?? "Product graph", nodes, edges }
}
