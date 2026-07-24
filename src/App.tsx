import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant,
  Handle, Position, useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import * as Tooltip from "@radix-ui/react-tooltip"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  BarChart3, Box, Component, Scan, LayoutGrid, ChevronDown, Factory, Leaf,
  FileUp, Maximize, Minus, MousePointer2, Plus, Search, Settings2, Share2,
} from "lucide-react"
import { parse } from "yaml"
import { Button } from "./components/ui/button"
import { ProcessNode, type ProcessNodeData } from "./components/ProcessNode"
import { layoutNodes } from "./lib/layout"
import { chemicalFlowLabel } from "./lib/flowLabels"
import { buildGraphFromYaml, buildInventoryRequirements, nodeScopeColors } from "./lib/yamlGraph"
import { calculateLca, getBackgroundActivityDetails, impactCategoryAbbreviation, lcaResultToMarkdown, type LcaResult } from "./lib/lcaApi"
import { unitsAreCompatible } from "./lib/units"
import jacketYaml from "../case_studies/jacket.yaml?raw"
import cottonFiberYaml from "../case_studies/cotton_fiber.yaml?raw"
import mockPlasticBroomYaml from "../case_studies/mock_plastic_broom.yaml?raw"
import polyesterTshirtYaml from "../case_studies/polyester_tshirt.yaml?raw"
import woolYarnYaml from "../case_studies/wool_yarn.yaml?raw"

type NodeMeta = { label: string; kind: string; detail: string; color: string; scope?: "foreground" | "background" }

const defaultGraph = buildGraphFromYaml(jacketYaml, "structure")
const initialEdges: Edge[] = defaultGraph.edges
const initialNodes: Node<ProcessNodeData>[] = defaultGraph.nodes.map((node) => ({
  ...node,
  data: { ...node.data, canFold: initialEdges.some((edge) => edge.target === node.id) },
}))

const nodeTypes = { process: ProcessNode }
type SankeyProcessNodeData = {
  label: string
  direct: string
  upstream: string
  orientation: "vertical" | "horizontal"
  scope: "foreground" | "background"
}
function SankeyProcessNode({ data }: NodeProps<Node<SankeyProcessNodeData>>) {
  return <div className="pg-node is-expanded sankey-process-node" style={{ "--node-color": nodeScopeColors[data.scope] } as React.CSSProperties}>
    <Handle type="target" position={data.orientation === "vertical" ? Position.Bottom : Position.Right} />
    <div className="pg-node-head"><Component size={14} /><span className="pg-node-label">{data.label}</span><small className="pg-node-scope">{data.scope}</small></div>
    <div className="sankey-process-metrics">
      <div>{data.direct}</div>
      <div>{data.upstream}</div>
    </div>
    <Handle type="source" position={data.orientation === "vertical" ? Position.Top : Position.Left} />
  </div>
}
const sankeyNodeTypes = { sankeyProcess: SankeyProcessNode }
const inputHandleIdFor = (edgeId: string) => `input-${edgeId}`
const incomingEdgesFor = (nodeId: string, edges: Edge[], nodesById: Map<string, Node<ProcessNodeData>>) => (
  edges.filter((edge) => edge.target === nodeId).sort((left, right) => (
    (nodesById.get(left.source)?.position.y ?? 0) - (nodesById.get(right.source)?.position.y ?? 0)
  ))
)
const populateExpandedConnections = (nodes: Node<ProcessNodeData>[], edges: Edge[]) => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const flowItem = (id: string) => {
    const connected = nodesById.get(id)
    return connected ? { label: connected.data.label, kind: connected.data.scope ?? connected.data.kind, color: connected.data.color } : null
  }
  return nodes.map((node) => {
    if (!node.data.expanded || node.data.scope === "background") return node
    const inputs = incomingEdgesFor(node.id, edges, nodesById).map((edge) => {
      const item = flowItem(edge.source)
      return item ? { ...item, handleId: inputHandleIdFor(edge.id) } : null
    }).filter((item): item is NonNullable<typeof item> => item !== null)
    const outputs = edges.filter((edge) => edge.source === node.id).map((edge) => flowItem(edge.target)).filter((item): item is NonNullable<typeof item> => item !== null)
    return { ...node, data: { ...node.data, inputs, outputs } }
  })
}
const targetExpandedInputRows = (nodes: Node<ProcessNodeData>[], edges: Edge[]) => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  return edges.map((edge) => {
    const target = nodesById.get(edge.target)
    return target?.data.expanded && target.data.scope !== "background"
      ? { ...edge, targetHandle: inputHandleIdFor(edge.id) }
      : edge
  })
}
const caseStudies = {
  jacket: { label: "Jacket", yaml: jacketYaml },
  cottonFiber: { label: "Cotton Fiber", yaml: cottonFiberYaml },
  mockPlasticBroom: { label: "Mock Plastic Broom", yaml: mockPlasticBroomYaml },
  polyesterTshirt: { label: "Polyester T-shirt", yaml: polyesterTshirtYaml },
  woolYarn: { label: "Wool Yarn", yaml: woolYarnYaml },
} as const
type CaseStudyId = keyof typeof caseStudies

const inventoryNumber = new Intl.NumberFormat("en", { minimumFractionDigits: 5, maximumFractionDigits: 8 })
const processResultNumber = new Intl.NumberFormat("en", { minimumFractionDigits: 5, maximumFractionDigits: 5 })
const isInventoryInput = (type: string) => /resource|extraction|input/i.test(type)
const inventoryFlowName = (name: string) => {
  const base = name.split(/[|,]/)[0].trim()
  const symbol = chemicalFlowLabel(base)
    .replaceAll("₂", "2")
    .replaceAll("₃", "3")
    .replaceAll("₄", "4")
    .replaceAll("ₓ", "x")
  return symbol === base ? name : `${name} (${symbol})`
}

function InventoryView({ result, yaml, isCurrent, error }: {
  result: LcaResult | null
  yaml: string
  isCurrent: boolean
  error: string
}) {
  if (!result || !isCurrent) return <div className="results-panel inventory-panel">
    <div className="results-panel-head"><div><strong>Inventory results</strong><span>Calculated quantities for the current product graph.</span></div></div>
    <div className="results-placeholder">
      <div className="results-empty-icon"><BarChart3 size={22} /></div><strong>No current inventory results</strong>
      <p>Calculate the LCA to populate this view with values returned by the calculation engine.</p>
      {error ? <div className="results-error"><strong>Calculation failed</strong><p>{error}</p></div> : null}
    </div>
  </div>

  const flows = Object.entries(result.lci).map(([name, value]) => ({ name, ...value }))
  const inputs = flows.filter((flow) => isInventoryInput(flow.type))
  const outputs = flows.filter((flow) => !isInventoryInput(flow.type))
  let requirements: ReturnType<typeof buildInventoryRequirements> = []
  let requirementError = ""
  try { requirements = buildInventoryRequirements(yaml, result.scaling_vector) } catch (caught) { requirementError = caught instanceof Error ? caught.message : "Could not read process requirements." }
  const FlowTable = ({ rows, empty }: { rows: typeof flows; empty: string }) => <div className="inventory-table-wrap"><table className="inventory-table">
    <thead><tr><th>Name</th><th>Category</th><th className="number">Amount</th><th>Unit</th></tr></thead>
    <tbody>{rows.length ? rows.map((flow) => <tr key={`${flow.type}-${flow.name}`}><td><span className={isInventoryInput(flow.type) ? "flow-dot input" : "flow-dot output"} />{inventoryFlowName(flow.name)}</td><td>{flow.type}</td><td className="number">{inventoryNumber.format(flow.amount)}</td><td>{flow.unit}</td></tr>) : <tr className="empty-row"><td colSpan={4}>{empty}</td></tr>}</tbody>
  </table></div>

  return <div className="inventory-view">
    <div className="inventory-title"><div><strong>{result.name}</strong><span>{result.functional_unit}</span></div></div>
    <details open><summary>Inputs <span>{inputs.length}</span></summary><FlowTable rows={inputs} empty="No environmental input flows were returned." /></details>
    <details open><summary>Outputs <span>{outputs.length}</span></summary><FlowTable rows={outputs} empty="No environmental output flows were returned." /></details>
    <details open className="requirements"><summary>Total requirements <span>{requirements.length}</span></summary>
      {requirementError ? <div className="results-error"><p>{requirementError}</p></div> : <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Process</th><th>Product</th><th className="number">Amount</th><th>Unit</th></tr></thead><tbody>
        {requirements.map((row) => <tr key={row.process}><td><span className="process-mark">⌘</span>{row.process}</td><td><span className="product-mark">⚙</span>{row.product}</td><td className="number">{inventoryNumber.format(row.amount)}</td><td>{row.unit}</td></tr>)}
      </tbody></table></div>}
    </details>
  </div>
}

type ImpactYaml = {
  processes?: Array<{
    name: string
    emissions?: Array<{ flow: string; amount: number; unit?: string }>
    extractions?: Array<{ flow: string; amount: number; unit?: string }>
    resources?: Array<{ flow: string; amount: number; unit?: string }>
    resource_inputs?: Array<{ flow: string; amount: number; unit?: string }>
  }>
}

const cleanImpactProcessName = (name: string) => name.replace(/^(?:p?\d+)\s*[:.\-–—]\s*/i, "").trim()
const normalizedFlow = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
const impactFactor = (category: string, flow: string) => {
  const indicator = impactCategoryAbbreviation(category).toUpperCase()
  const normalized = normalizedFlow(flow)
  if (indicator === "GWP") {
    if (/carbon dioxide|\bco2\b/.test(normalized)) return 1
    if (/methane|\bch4\b/.test(normalized)) return 25
  }
  if (indicator === "EP" && /nitrogen oxides?|\bnox\b/.test(normalized)) return 0.04429
  if (indicator === "AP" && /nitrogen oxides?|\bnox\b/.test(normalized)) return 0.7
  if (indicator === "PMFP" && /nitrogen oxides?|\bnox\b/.test(normalized)) return 0.00722
  if (indicator === "MIR" && /nitrogen oxides?|\bnox\b/.test(normalized)) return 24.79359
  return null
}

function ImpactAnalysisView({ result, yaml, isCurrent, error }: {
  result: LcaResult | null
  yaml: string
  isCurrent: boolean
  error: string
}) {
  const [subgroup, setSubgroup] = useState<"processes" | "flows">("processes")
  const [threshold, setThreshold] = useState(1)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set())
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(() => new Set())
  const [collapsedFlows, setCollapsedFlows] = useState<Set<string>>(() => new Set())

  if (!result || !isCurrent) return <div className="results-panel impact-panel">
    <div className="results-panel-head"><div><strong>Impact analysis</strong><span>Inspect characterized impacts by category, process, and elementary flow.</span></div></div>
    <div className="results-placeholder"><div className="results-empty-icon"><BarChart3 size={22} /></div><strong>No current impact results</strong><p>Calculate the LCA to populate this view.</p>{error ? <div className="results-error"><strong>Calculation failed</strong><p>{error}</p></div> : null}</div>
  </div>

  let source: ImpactYaml = {}
  try { source = parse(yaml) as ImpactYaml } catch { source = {} }
  const yamlProcesses = source.processes ?? []
  const yamlProcessByName = new Map(yamlProcesses.flatMap((process) => [
    [process.name.toLowerCase(), process],
    [cleanImpactProcessName(process.name).toLowerCase(), process],
  ]))
  const categories = [...result.process_contributions.categories]
    .filter((category) => category.total_score !== 0)
    .reduce((unique, category) => {
      const key = `${impactCategoryAbbreviation(category.label)}\u001f${category.total_score}\u001f${category.unit}`
      if (!unique.has(key)) unique.set(key, category)
      return unique
    }, new Map<string, LcaResult["process_contributions"]["categories"][number]>())
  const toggleCategory = (id: string) => setExpandedCategories((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleProcess = (id: string) => setExpandedProcesses((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleFlow = (id: string) => setCollapsedFlows((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const processFlows = (processName: string, processId: string, categoryLabel: string) => {
    const process = yamlProcessByName.get(processName.toLowerCase())
      ?? yamlProcessByName.get(cleanImpactProcessName(processName).toLowerCase())
    const scale = result.scaling_vector[processId]
      ?? result.scaling_vector[processName]
      ?? result.scaling_vector[process?.name ?? ""]
      ?? 1
    const flows = [...(process?.emissions ?? []), ...(process?.extractions ?? process?.resources ?? process?.resource_inputs ?? [])]
    const relevant = flows.map((flow) => ({ ...flow, factor: impactFactor(categoryLabel, flow.flow) })).filter((flow) => flow.factor !== null)
    return relevant.map((flow) => ({
      name: flow.flow,
      category: "elementary flows/air",
      amount: flow.amount * scale,
      factor: flow.factor!,
      impact: flow.amount * scale * flow.factor!,
      unit: flow.unit ?? "kg",
    }))
  }

  return <div className="impact-view">
    <div className="impact-title"><div><strong>{result.name}</strong><span>Impact analysis – {result.method}</span></div></div>
    <div className="impact-controls">
      <span>Sub-group by</span>
      <label><input type="radio" checked={subgroup === "processes"} onChange={() => setSubgroup("processes")} /> Processes</label>
      <label><input type="radio" checked={subgroup === "flows"} onChange={() => setSubgroup("flows")} /> Flows</label>
      <i />
      <label className="impact-threshold">Don’t show &lt; <input type="number" min="0" max="100" step="0.1" value={threshold} onChange={(event) => setThreshold(Math.max(0, Number(event.target.value)))} /> %</label>
    </div>
    <div className="impact-table-wrap"><table className="impact-table">
      <thead><tr><th>Name</th><th>Category</th><th>Inventory result</th><th>Characterization factor</th><th>Impact assessment result</th></tr></thead>
      <tbody>{[...categories.values()].map((category) => {
        const categoryId = category.id || category.label
        const isOpen = expandedCategories.has(categoryId)
        const processes = category.processes
          .filter((process) => Math.abs(process.percentage ?? (category.total_score ? process.direct_score / category.total_score * 100 : 0)) >= threshold)
          .sort((left, right) => Math.abs(right.direct_score) - Math.abs(left.direct_score))
        return <Fragment key={categoryId}>
          <tr className="impact-category-row" onClick={() => toggleCategory(categoryId)}>
            <td><button className={`tree-toggle ${isOpen ? "is-expanded" : ""}`} aria-label={`${isOpen ? "Collapse" : "Expand"} ${category.label}`}><ChevronDown size={14} /></button><BarChart3 className="impact-category-icon" size={17} /> <strong>{impactCategoryAbbreviation(category.label)}</strong></td>
            <td /><td /><td /><td><span className="impact-result">{inventoryNumber.format(category.total_score)} <small>{category.unit}</small></span></td>
          </tr>
          {isOpen && subgroup === "processes" ? processes.flatMap((process) => {
            const processKey = `${categoryId}:${process.process_id}`
            const flows = processFlows(process.process_name, process.process_id, category.label)
            const processOpen = expandedProcesses.has(processKey)
            const displayName = cleanImpactProcessName(process.process_name)
            const processRow = <tr className="impact-process-row" key={processKey} onClick={() => flows.length && toggleProcess(processKey)}>
              <td><span className="impact-indent" />{flows.length ? <button className={`tree-toggle ${processOpen ? "is-expanded" : ""}`} aria-label={`${processOpen ? "Collapse" : "Expand"} ${displayName}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="impact-process-icon"><Factory size={14} /></span>{displayName}</td>
              <td /><td /><td /><td><span className="impact-bar"><i style={{ width: `${Math.min(100, Math.abs(process.percentage ?? (category.total_score ? process.direct_score / category.total_score * 100 : 0)))}%` }} /></span><span className="impact-result">{inventoryNumber.format(process.direct_score)} <small>{category.unit}</small></span></td>
            </tr>
            const flowRows = processOpen ? flows.map((flow) => <tr className="impact-flow-row" key={`${processKey}:${flow.name}`}>
              <td><span className="impact-indent flow" /><span className="impact-flow-icon"><Leaf size={14} /></span>{inventoryFlowName(flow.name)}</td>
              <td>{flow.category}</td>
              <td className="number">{inventoryNumber.format(flow.amount)} <small>{flow.unit}</small></td>
              <td className="number">{inventoryNumber.format(flow.factor)} <small>{category.unit}/{flow.unit}</small></td>
              <td><span className="impact-bar flow"><i style={{ width: `${Math.min(100, Math.abs(category.total_score ? flow.impact / category.total_score * 100 : 0))}%` }} /></span><span className="impact-result">{inventoryNumber.format(flow.impact)} <small>{category.unit}</small></span></td>
            </tr>) : []
            return [processRow, ...flowRows]
          }) : null}
          {isOpen && subgroup === "flows" ? [...processes.reduce((grouped, process) => {
            processFlows(process.process_name, process.process_id, category.label).forEach((flow) => {
              const key = normalizedFlow(flow.name)
              const existing = grouped.get(key) ?? {
                name: flow.name,
                category: flow.category,
                factor: flow.factor,
                unit: flow.unit,
                amount: 0,
                impact: 0,
                processes: [] as Array<{ id: string; name: string; amount: number; impact: number }>,
              }
              existing.amount += flow.amount
              existing.impact += flow.impact
              existing.processes.push({
                id: process.process_id,
                name: cleanImpactProcessName(process.process_name),
                amount: flow.amount,
                impact: flow.impact,
              })
              grouped.set(key, existing)
            })
            return grouped
          }, new Map<string, {
            name: string
            category: string
            factor: number
            unit: string
            amount: number
            impact: number
            processes: Array<{ id: string; name: string; amount: number; impact: number }>
          }>()).entries()]
            .map(([flowKey, flow]) => ({ flowKey, ...flow }))
            .filter((flow) => Math.abs(category.total_score ? flow.impact / category.total_score * 100 : 0) >= threshold)
            .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
            .flatMap((flow) => {
              const flowId = `${categoryId}:flow:${flow.flowKey}`
              const flowOpen = !collapsedFlows.has(flowId)
              const flowRow = <tr className="impact-flow-group-row" key={flowId} onClick={() => toggleFlow(flowId)}>
                <td><span className="impact-indent" /><button className={`tree-toggle ${flowOpen ? "is-expanded" : ""}`} aria-label={`${flowOpen ? "Collapse" : "Expand"} ${flow.name}`}><ChevronDown size={14} /></button><span className="impact-flow-icon"><Leaf size={14} /></span>{inventoryFlowName(flow.name)}</td>
                <td>{flow.category}</td>
                <td className="number">{inventoryNumber.format(flow.amount)} <small>{flow.unit}</small></td>
                <td className="number">{inventoryNumber.format(flow.factor)} <small>{category.unit}/{flow.unit}</small></td>
                <td><span className="impact-bar flow"><i style={{ width: `${Math.min(100, Math.abs(category.total_score ? flow.impact / category.total_score * 100 : 0))}%` }} /></span><span className="impact-result">{inventoryNumber.format(flow.impact)} <small>{category.unit}</small></span></td>
              </tr>
              const processRows = flowOpen ? flow.processes
                .filter((process) => Math.abs(category.total_score ? process.impact / category.total_score * 100 : 0) >= threshold)
                .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
                .map((process) => <tr className="impact-flow-process-row" key={`${flowId}:${process.id}`}>
                  <td><span className="impact-indent flow-process" /><span className="impact-process-icon"><Factory size={14} /></span>{process.name}</td>
                  <td /><td className="number">{inventoryNumber.format(process.amount)} <small>{flow.unit}</small></td><td />
                  <td><span className="impact-bar"><i style={{ width: `${Math.min(100, Math.abs(category.total_score ? process.impact / category.total_score * 100 : 0))}%` }} /></span><span className="impact-result">{inventoryNumber.format(process.impact)} <small>{category.unit}</small></span></td>
                </tr>) : []
              return [flowRow, ...processRows]
            }) : null}
        </Fragment>
      })}</tbody>
    </table></div>
  </div>
}

function ProcessResultsView({ result, yaml }: { result: LcaResult; yaml: string }) {
  const processNodes = result.sankey.nodes.filter((node) => node.kind === "process")
  const [processId, setProcessId] = useState("")
  const [threshold, setThreshold] = useState(0.01)
  const selectedId = processNodes.some((node) => node.id === processId) ? processId : (processNodes.at(-1)?.id ?? "")
  const selectedNode = processNodes.find((node) => node.id === selectedId)
  const processIds = new Set(processNodes.map((node) => node.id))
  const incoming = new Map<string, string[]>()
  result.sankey.links.forEach((link) => {
    if (processIds.has(link.source) && processIds.has(link.target)) incoming.set(link.target, [...(incoming.get(link.target) ?? []), link.source])
  })
  const upstreamIds = (id: string, found = new Set<string>()): Set<string> => {
    if (found.has(id)) return found
    found.add(id)
    ;(incoming.get(id) ?? []).forEach((source) => upstreamIds(source, found))
    return found
  }
  const includedIds = upstreamIds(selectedId)
  let source: ImpactYaml = {}
  try { source = parse(yaml) as ImpactYaml } catch { source = {} }
  const yamlProcesses = source.processes ?? []
  const yamlByName = new Map(yamlProcesses.flatMap((process) => [
    [process.name.toLowerCase(), process],
    [cleanImpactProcessName(process.name).toLowerCase(), process],
  ]))
  const nodeProcess = (node: (typeof processNodes)[number]) => yamlByName.get((node.process_name ?? node.label).toLowerCase())
    ?? yamlByName.get(cleanImpactProcessName(node.process_name ?? node.label).toLowerCase())
  const flowRows = new Map<string, { name: string; category: string; unit: string; upstream: number; direct: number; input: boolean }>()
  processNodes.filter((node) => includedIds.has(node.id)).forEach((node) => {
    const process = nodeProcess(node)
    const scale = result.scaling_vector[node.id] ?? result.scaling_vector[node.process_name ?? ""] ?? result.scaling_vector[process?.name ?? ""] ?? 1
    const exchanges = [
      ...(process?.emissions ?? []).map((flow) => ({ ...flow, input: false })),
      ...(process?.extractions ?? process?.resources ?? process?.resource_inputs ?? []).map((flow) => ({ ...flow, input: true })),
    ]
    exchanges.forEach((flow) => {
      const key = `${flow.input}:${normalizedFlow(flow.flow)}`
      const existing = flowRows.get(key) ?? { name: flow.flow, category: flow.input ? "elementary flows/resource" : "elementary flows/air", unit: flow.unit ?? "kg", upstream: 0, direct: 0, input: flow.input }
      const amount = flow.amount * scale
      existing.upstream += amount
      if (node.id === selectedId) existing.direct += amount
      flowRows.set(key, existing)
    })
  })
  const flowTotals = [...flowRows.values()].reduce((totals, flow) => {
    totals.set(flow.input, (totals.get(flow.input) ?? 0) + Math.abs(flow.upstream))
    return totals
  }, new Map<boolean, number>())
  const flowContribution = (flow: { input: boolean; upstream: number }) => {
    const total = flowTotals.get(flow.input) ?? 0
    return total ? Math.abs(flow.upstream) / total * 100 : 0
  }
  const visibleFlows = [...flowRows.values()].filter((flow) => flowContribution(flow) >= threshold)
  const FlowResultsTable = ({ input }: { input: boolean }) => {
    const rows = visibleFlows.filter((flow) => flow.input === input)
    return <table className="process-flow-table"><thead><tr><th>Contribution</th><th>Flow</th><th>Category</th><th>Upstream incl. direct</th><th>Direct</th><th>Unit</th></tr></thead>
      <tbody>{rows.length ? rows.map((flow) => <tr key={`${input}:${flow.name}`}>
        <td><span className="process-result-bar"><i style={{ width: `${Math.min(100, flowContribution(flow))}%` }} /></span></td>
        <td>{inventoryFlowName(flow.name)}</td><td>{flow.category}</td><td>{processResultNumber.format(flow.upstream)}</td><td>{processResultNumber.format(flow.direct)}</td><td>{flow.unit}</td>
      </tr>) : <tr className="empty-row"><td colSpan={6}>No {input ? "input" : "output"} flows for this process.</td></tr>}</tbody>
    </table>
  }
  const impactRows = result.process_contributions.categories.map((category) => {
    const byId = new Map(category.processes.flatMap((process) => [
      [process.process_id, process] as const,
      [cleanImpactProcessName(process.process_name).toLowerCase(), process] as const,
    ]))
    const scoreFor = (node: (typeof processNodes)[number]) => byId.get(node.id) ?? byId.get(cleanImpactProcessName(node.process_name ?? node.label).toLowerCase())
    const upstream = processNodes.filter((node) => includedIds.has(node.id)).reduce((sum, node) => sum + (scoreFor(node)?.direct_score ?? 0), 0)
    const direct = selectedNode ? scoreFor(selectedNode)?.direct_score ?? 0 : 0
    return { category, upstream, direct, contribution: category.total_score ? upstream / category.total_score * 100 : 0 }
  }).filter((row) => Math.abs(row.contribution) >= threshold && row.upstream !== 0)

  return <div className="process-results-view">
    <details open><summary>Flow contributions to process results</summary>
      <div className="process-results-controls"><label>Process <select value={selectedId} onChange={(event) => setProcessId(event.target.value)}>{processNodes.map((node) => <option key={node.id} value={node.id}>{cleanImpactProcessName(node.process_name ?? node.label)}</option>)}</select></label><label>Don’t show &lt; <input type="number" min="0" max="100" step="0.01" value={threshold} onChange={(event) => setThreshold(Math.max(0, Number(event.target.value)))} /> %</label></div>
      <div className="process-flow-grids"><section><h3>Inputs</h3><FlowResultsTable input /></section><section><h3>Outputs</h3><FlowResultsTable input={false} /></section></div>
    </details>
    <details open><summary>Impact assessment results</summary>
      <div className="process-results-controls"><label>Process <select value={selectedId} onChange={(event) => setProcessId(event.target.value)}>{processNodes.map((node) => <option key={node.id} value={node.id}>{cleanImpactProcessName(node.process_name ?? node.label)}</option>)}</select></label><label>Don’t show &lt; <input type="number" min="0" max="100" step="0.01" value={threshold} onChange={(event) => setThreshold(Math.max(0, Number(event.target.value)))} /> %</label></div>
      <div className="process-impact-table-wrap"><table className="process-impact-table"><thead><tr><th>Contribution</th><th>Impact category</th><th>Upstream incl. direct</th><th>Direct</th><th>Unit</th></tr></thead><tbody>{impactRows.map((row) => <tr key={row.category.id || row.category.label}><td><span className="process-result-bar"><i style={{ width: `${Math.min(100, Math.abs(row.contribution))}%` }} /></span>{row.contribution.toFixed(2)}%</td><td>{impactCategoryAbbreviation(row.category.label)}</td><td>{processResultNumber.format(row.upstream)}</td><td>{processResultNumber.format(row.direct)}</td><td>{row.category.unit}</td></tr>)}</tbody></table></div>
    </details>
  </div>
}

function ContributionView({ result, yaml, isCurrent, error }: {
  result: LcaResult | null
  yaml: string
  isCurrent: boolean
  error: string
}) {
  const [mode, setMode] = useState<"flow" | "impact">("flow")
  const [flow, setFlow] = useState("")
  const [impact, setImpact] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(() => new Set())

  const flowNames = result ? Object.keys(result.lci) : []
  const impactNames = result ? [...Object.entries(result.lcia).filter(([, value]) => value.score !== 0).reduce((unique, [name, value]) => {
    const key = `${impactCategoryAbbreviation(name)}\u001f${value.score}\u001f${value.unit}`
    if (!unique.has(key)) unique.set(key, name)
    return unique
  }, new Map<string, string>()).values()] : []
  const selectedFlow = flowNames.includes(flow) ? flow : (flowNames[0] ?? "")
  const selectedImpact = impactNames.includes(impact) ? impact : (impactNames[0] ?? "")
  const contributionFlowLabel = (name: string) => {
    const abbreviation = chemicalFlowLabel(name.split(/[|,]/)[0].trim())
      .replaceAll("₂", "2")
      .replaceAll("₃", "3")
      .replaceAll("₄", "4")
      .replaceAll("ₓ", "x")
    return `${abbreviation} - elementary flows/air`
  }

  if (!result || !isCurrent) return <div className="results-panel contribution-panel">
    <div className="results-panel-head"><div><strong>Contribution analysis</strong><span>Compare process contributions by inventory flow or impact category.</span></div></div>
    <div className="results-placeholder"><div className="results-empty-icon"><BarChart3 size={22} /></div><strong>No current contribution results</strong><p>Calculate the LCA to populate this view.</p>{error ? <div className="results-error"><strong>Calculation failed</strong><p>{error}</p></div> : null}</div>
  </div>

  const category = result.process_contributions.categories.find((item) => item.label === selectedImpact || item.id === selectedImpact)
  let requirements: ReturnType<typeof buildInventoryRequirements> = []
  try { requirements = buildInventoryRequirements(yaml, result.scaling_vector) } catch { requirements = [] }
  const impactTotal = result.lcia[selectedImpact]
  const flowTotal = result.lci[selectedFlow]
  const cleanProcessName = (name: string) => name
    .replace(/^(?:p?\d+)\s*[:.\-–—]\s*/i, "")
    .trim()
  const processName = (name: string, index: number) => {
    const visible = cleanProcessName(name)
    if (visible && !/^(?:p?\d+)$/i.test(visible)) return visible
    return cleanProcessName(requirements[index]?.process ?? "")
  }
  const requiredAmount = (id: string, name: string, index: number) => {
    const displayName = processName(name, index).toLowerCase()
    const matchingRequirement = requirements.find((item) => cleanProcessName(item.process).toLowerCase() === displayName)
    return result.scaling_vector[id]
      ?? result.scaling_vector[name]
      ?? matchingRequirement?.amount
      ?? requirements[index]?.amount
  }
  const rows = (mode === "impact"
    ? (category?.processes ?? []).map((item, index) => ({ name: processName(item.process_name, index), required: requiredAmount(item.process_id, item.process_name, index), total: item.direct_score, percentage: item.percentage }))
    : requirements.map((item) => ({ name: cleanProcessName(item.process), required: item.amount, total: 0, percentage: null as number | null })))
    .filter((row) => row.name && !/^(?:p?\d+)$/i.test(row.name))
    .sort((left, right) => mode === "impact"
      ? Math.abs(right.total) - Math.abs(left.total)
      : Math.abs(right.required ?? 0) - Math.abs(left.required ?? 0))
  const total = mode === "impact" ? (category?.total_score ?? impactTotal?.score ?? 0) : (flowTotal?.amount ?? 0)
  const unit = mode === "impact" ? (category?.unit ?? impactTotal?.unit ?? "") : (flowTotal?.unit ?? "")
  const maxMagnitude = Math.max(Math.abs(total), ...rows.map((row) => Math.abs(row.total)), 1e-30)
  const requiredTotal = rows.reduce((sum, row) => sum + Math.abs(row.required ?? 0), 0)
  const number = (value: number | undefined) => value === undefined ? "—" : inventoryNumber.format(value)
  const rate = (value: number) => value.toFixed(2)
  let contributionGraph: ReturnType<typeof buildGraphFromYaml> | null = null
  try { contributionGraph = buildGraphFromYaml(yaml, "structure") } catch { contributionGraph = null }
  const graphNameById = new Map(contributionGraph?.nodes.map((node) => [node.id, cleanProcessName(node.data.label)]) ?? [])
  const upstreamByName = new Map<string, string[]>()
  contributionGraph?.edges.forEach((edge) => {
    const consumer = graphNameById.get(edge.target)
    const supplier = graphNameById.get(edge.source)
    if (!consumer || !supplier) return
    upstreamByName.set(consumer, [...(upstreamByName.get(consumer) ?? []), supplier])
  })
  const rowByName = new Map(rows.map((row) => [row.name.toLowerCase(), row]))
  const suppliedNames = new Set([...upstreamByName.values()].flat().map((name) => name.toLowerCase()))
  const rootRows = rows.filter((row) => !suppliedNames.has(row.name.toLowerCase()))
  const toggleProcess = (name: string) => setExpandedProcesses((current) => {
    const next = new Set(current)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })
  const ownValue = (row: (typeof rows)[number]) => mode === "impact" ? row.total : Math.abs(row.required ?? 0)
  const rolledUpValue = (row: (typeof rows)[number], visited = new Set<string>()): number => {
    const key = row.name.toLowerCase()
    if (visited.has(key)) return 0
    const nextVisited = new Set(visited).add(key)
    const upstream = (upstreamByName.get(row.name) ?? [])
      .map((name) => rowByName.get(name.toLowerCase()))
      .filter((item): item is (typeof rows)[number] => Boolean(item))
    return ownValue(row) + upstream.reduce((sum, child) => sum + rolledUpValue(child, nextVisited), 0)
  }
  const renderContributionRows = (items: typeof rows, depth = 0): React.ReactNode[] => items.flatMap((row, index) => {
    const upstream = (upstreamByName.get(row.name) ?? [])
      .map((name) => rowByName.get(name.toLowerCase()))
      .filter((item): item is (typeof rows)[number] => Boolean(item))
      .sort((left, right) => mode === "impact" ? Math.abs(right.total) - Math.abs(left.total) : Math.abs(right.required ?? 0) - Math.abs(left.required ?? 0))
    const canExpand = upstream.length > 0
    const isOpen = expandedProcesses.has(row.name)
    const displayedValue = canExpand && !isOpen ? rolledUpValue(row) : ownValue(row)
    const percent = mode === "flow" ? (requiredTotal ? displayedValue / requiredTotal * 100 : 0) : (total ? displayedValue / total * 100 : 0)
    const processRow = <tr key={`${row.name}-${depth}-${index}`} className={canExpand ? "clickable-process" : ""} onClick={canExpand ? () => toggleProcess(row.name) : undefined}>
      <td><span className="rate-value">{rate(percent)}%</span></td>
      <td style={{ paddingLeft: `${7 + depth * 20}px` }}>{canExpand ? <button className={`tree-toggle ${isOpen ? "is-expanded" : ""}`} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} inputs for ${row.name}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="process-mark">⌘</span>{row.name}</td>
      <td>{number(row.required)}</td><td><span className="result-bar"><i className={displayedValue < 0 ? "negative" : ""} style={{ width: `${Math.min(100, Math.abs(displayedValue) / maxMagnitude * 100)}%` }} /></span>{mode === "impact" ? number(displayedValue) : "—"}</td><td>{mode === "impact" ? <>{number(row.total)} <small>({rate(total ? row.total / total * 100 : 0)}% direct)</small></> : "—"}</td>
    </tr>
    return isOpen ? [processRow, ...renderContributionRows(upstream, depth + 1)] : [processRow]
  })

  return <div className="contribution-view">
    <div className="contribution-title"><div><strong>{result.name}</strong><span>{result.method} · {result.functional_unit}</span></div></div>
    <div className="contribution-controls">
      <label className={mode === "flow" ? "active" : ""}><input type="radio" checked={mode === "flow"} onChange={() => setMode("flow")} />Flow</label>
      <div className="contribution-select"><span className="flow-dot output" /><select value={selectedFlow} onChange={(event) => { setFlow(event.target.value); setMode("flow") }} aria-label="Flow category">{flowNames.map((name) => <option key={name} value={name}>{contributionFlowLabel(name)}</option>)}</select></div>
      <label className={mode === "impact" ? "active" : ""}><input type="radio" checked={mode === "impact"} onChange={() => setMode("impact")} />Impact category</label>
      <div className="contribution-select"><BarChart3 size={16} /><select value={selectedImpact} onChange={(event) => { setImpact(event.target.value); setMode("impact") }} aria-label="Impact category">{impactNames.map((name) => <option key={name} value={name}>{impactCategoryAbbreviation(name)}</option>)}</select></div>
    </div>
    <div className="contribution-table-wrap"><table className="contribution-table"><thead><tr><th>Contribution rate</th><th>Process</th><th>Required amount</th><th>Total result</th><th>Direct contribution</th></tr></thead><tbody>
      <tr className="contribution-root"><td>100.00%</td><td><button className={`tree-toggle ${expanded ? "is-expanded" : ""}`} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} downstream processes`}><ChevronDown size={14} /></button><span className="process-mark">⌘</span>{result.name}</td><td>{mode === "flow" ? "1.00000" : "—"}</td><td><span className="result-bar"><i style={{ width: "100%" }} /></span>{number(total)} <small>{unit}</small></td><td>—</td></tr>
      {expanded ? renderContributionRows(rootRows.length ? rootRows : rows) : null}
      {expanded && !rows.length ? <tr className="empty-row"><td colSpan={5}>{mode === "impact" ? "No process contribution rows were returned for this category." : "No process requirements are available."}</td></tr> : null}
    </tbody></table></div>
  </div>
}

function SankeyView({ result }: { result: LcaResult }) {
  const availableProcessCount = result.sankey.nodes.filter((node) => node.kind === "process").length
  const [mode, setMode] = useState<"flow" | "impact">("impact")
  const [flow, setFlow] = useState("")
  const [impact, setImpact] = useState("")
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [chartPickerOpen, setChartPickerOpen] = useState(false)
  const [minContribution, setMinContribution] = useState(0)
  const [maxProcesses, setMaxProcesses] = useState(availableProcessCount)
  const [orientation, setOrientation] = useState<"vertical" | "horizontal">("vertical")
  const [connectionStyle, setConnectionStyle] = useState<"curved" | "straight" | "step">("curved")
  const instanceRef = useRef<ReactFlowInstance<Node<SankeyProcessNodeData>, Edge> | null>(null)
  useEffect(() => setMaxProcesses(availableProcessCount), [availableProcessCount])
  const flowNames = Object.keys(result.lci)
  const impactNames = [...Object.entries(result.lcia).filter(([, value]) => value.score !== 0).reduce((unique, [name, value]) => {
    const key = `${impactCategoryAbbreviation(name)}\u001f${value.score}\u001f${value.unit}`
    if (!unique.has(key)) unique.set(key, name)
    return unique
  }, new Map<string, string>()).values()]
  const selectedFlow = flowNames.includes(flow) ? flow : (flowNames[0] ?? "")
  const selectedImpact = impactNames.includes(impact) ? impact : (impactNames[0] ?? "")
  const category = result.process_contributions.categories.find((item) => item.label === selectedImpact || item.id === selectedImpact)
  const processNodes = result.sankey.nodes.filter((node) => node.kind === "process")
  const processIds = new Set(processNodes.map((node) => node.id))
  const links = result.sankey.links.filter((link) => processIds.has(link.source) && processIds.has(link.target))
  const incoming = new Map<string, typeof links>()
  const outgoing = new Map<string, typeof links>()
  links.forEach((link) => {
    incoming.set(link.target, [...(incoming.get(link.target) ?? []), link])
    outgoing.set(link.source, [...(outgoing.get(link.source) ?? []), link])
  })
  const normalize = (value: string) => value.replace(/^(?:p?\d+)\s*[:.\-–—]\s*/i, "").trim().toLowerCase()
  const direct = new Map<string, number>()
  const directPercentage = new Map<string, number | null>()
  if (mode === "impact") {
    const contributions = new Map((category?.processes ?? []).flatMap((item) => [
      [item.process_id, item] as const,
      [normalize(item.process_name), item] as const,
    ]))
    processNodes.forEach((node) => {
      const contribution = contributions.get(node.id) ?? contributions.get(normalize(node.process_name ?? node.label))
      direct.set(node.id, contribution?.direct_score ?? 0)
      directPercentage.set(node.id, contribution?.percentage ?? null)
    })
  } else {
    const normalizedFlow = (value: string) => value.split(/[|,]/)[0].trim().toLowerCase()
    const selectedUnit = result.lci[selectedFlow]?.unit
    result.sankey.links.filter((link) => normalizedFlow(link.flow_name) === normalizedFlow(selectedFlow) && unitsAreCompatible(link.unit, selectedUnit)).forEach((link) => {
      const processId = processIds.has(link.source) ? link.source : processIds.has(link.target) ? link.target : ""
      if (processId) direct.set(processId, (direct.get(processId) ?? 0) + link.amount)
    })
    const total = result.lci[selectedFlow]?.amount ?? 0
    processNodes.forEach((node) => directPercentage.set(node.id, total ? (direct.get(node.id) ?? 0) / total * 100 : null))
  }
  const upstreamProcessMemo = new Map<string, Set<string>>()
  const upstreamProcesses = (nodeId: string, visiting = new Set<string>()): Set<string> => {
    const cached = upstreamProcessMemo.get(nodeId)
    if (cached) return new Set(cached)
    if (visiting.has(nodeId)) return new Set()
    const next = new Set(visiting).add(nodeId)
    const processSet = new Set<string>()
    ;(incoming.get(nodeId) ?? []).forEach((link) => {
      processSet.add(link.source)
      upstreamProcesses(link.source, next).forEach((id) => processSet.add(id))
    })
    upstreamProcessMemo.set(nodeId, processSet)
    return new Set(processSet)
  }
  const upstreamMemo = new Map<string, number>()
  const upstreamTotal = (nodeId: string): number => {
    if (upstreamMemo.has(nodeId)) return upstreamMemo.get(nodeId)!
    const total = (direct.get(nodeId) ?? 0) + [...upstreamProcesses(nodeId)].reduce((sum, id) => sum + (direct.get(id) ?? 0), 0)
    upstreamMemo.set(nodeId, total)
    return total
  }
  const depthMemo = new Map<string, number>()
  const depth = (nodeId: string, visiting = new Set<string>()): number => {
    if (depthMemo.has(nodeId)) return depthMemo.get(nodeId)!
    if (visiting.has(nodeId)) return 0
    const next = new Set(visiting).add(nodeId)
    const nextLinks = outgoing.get(nodeId) ?? []
    const value = nextLinks.length ? 1 + Math.max(...nextLinks.map((link) => depth(link.target, next))) : 0
    depthMemo.set(nodeId, value)
    return value
  }
  const selectedTotal = mode === "impact" ? (category?.total_score ?? result.lcia[selectedImpact]?.score ?? 0) : (result.lci[selectedFlow]?.amount ?? 0)
  const totalMagnitude = Math.abs(selectedTotal)
  const rootIds = new Set(processNodes.filter((node) => !(outgoing.get(node.id)?.length)).map((node) => node.id))
  const eligibleNodes = processNodes.filter((node) => rootIds.has(node.id) || !totalMagnitude || Math.abs(upstreamTotal(node.id) / selectedTotal * 100) >= minContribution)
  const visibleNodes = eligibleNodes.slice(Math.max(0, eligibleNodes.length - Math.max(1, maxProcesses)))
  const visibleIds = new Set(visibleNodes.map((node) => node.id))
  const visibleLinks = links.filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target))
  const rows = new Map<number, typeof visibleNodes>()
  visibleNodes.forEach((node) => {
    const row = depth(node.id)
    rows.set(row, [...(rows.get(row) ?? []), node])
  })
  const width = 1200
  const nodeWidth = 300
  const rowGap = 205
  const positions = new Map<string, { x: number; y: number }>()
  rows.forEach((nodesInRow, row) => nodesInRow.forEach((node, index) => positions.set(node.id, {
    x: orientation === "vertical" ? (index + 1) * width / (nodesInRow.length + 1) - nodeWidth / 2 : row * 410,
    y: orientation === "vertical" ? row * rowGap : index * 170,
  })))
  const unit = mode === "impact" ? (category?.unit ?? result.lcia[selectedImpact]?.unit ?? "") : (result.lci[selectedFlow]?.unit ?? "")
  const format = (value: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 4 }).format(value)
  const percentage = (value: number) => selectedTotal ? value / selectedTotal * 100 : 0
  const sankeyNodes: Node<SankeyProcessNodeData>[] = visibleNodes.map((node) => {
    const own = direct.get(node.id) ?? 0
    const total = upstreamTotal(node.id)
    const ownPercentage = mode === "impact" ? directPercentage.get(node.id) : percentage(own)
    return {
      id: node.id,
      type: "sankeyProcess",
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        label: node.label,
        direct: `Direct (${ownPercentage === null || ownPercentage === undefined ? "—" : `${ownPercentage.toFixed(2)}%`}): ${format(own)} ${unit}`,
        upstream: `Upstream (${percentage(total).toFixed(2)}%): ${format(total)} ${unit}`,
        orientation,
        scope: node.scope ?? "foreground",
      },
    }
  })
  const sankeyEdges: Edge[] = visibleLinks.map((link) => {
    const value = upstreamTotal(link.source)
    return {
      id: link.id,
      source: link.source,
      target: link.target,
      type: connectionStyle === "curved" ? "default" : connectionStyle === "straight" ? "straight" : "smoothstep",
      style: { stroke: "#343941", strokeWidth: Math.max(2, Math.min(42, Math.abs(percentage(value)) * .42)), opacity: .9 },
      label: `${format(value)} ${unit}`,
      labelStyle: { fill: "#b8bbc2", fontSize: 9 },
      labelBgStyle: { fill: "#202225", fillOpacity: .9 },
    }
  })
  useEffect(() => {
    if (!instanceRef.current) return
    instanceRef.current.setNodes(sankeyNodes)
    instanceRef.current.setEdges(sankeyEdges)
  }, [mode, selectedFlow, selectedImpact, minContribution, maxProcesses, orientation, connectionStyle])

  const fitSankey = () => instanceRef.current?.fitView({ padding: .4, maxZoom: .68, duration: 350 })

  return <div className="sankey-view">
    {chartPickerOpen ? <div className="sankey-chart-picker">
      <div className="sankey-picker-tabs">
        <button className={mode === "flow" ? "is-active" : ""} onClick={() => setMode("flow")}><span className="flow-dot output" />Flow</button>
        <button className={mode === "impact" ? "is-active" : ""} onClick={() => setMode("impact")}><BarChart3 size={14} />Impact</button>
      </div>
      <label>
        <span>{mode === "flow" ? "Flow category" : "Impact category"}</span>
        {mode === "flow"
          ? <select value={selectedFlow} onChange={(event) => setFlow(event.target.value)} aria-label="Sankey flow category">{flowNames.map((name) => <option key={name} value={name}>{inventoryFlowName(name)}</option>)}</select>
          : <select value={selectedImpact} onChange={(event) => setImpact(event.target.value)} aria-label="Sankey impact category">{impactNames.map((name) => <option key={name} value={name}>{impactCategoryAbbreviation(name)}</option>)}</select>}
      </label>
      <div className="sankey-settings-grid">
        <label><span>Min. contribution share</span><div className="sankey-stepper"><button type="button" aria-label="Decrease minimum contribution" onClick={() => setMinContribution((value) => Math.max(0, Number((value - .1).toFixed(1))))}>−</button><div className="sankey-number"><input type="number" min="0" max="100" step="0.1" value={minContribution} onChange={(event) => setMinContribution(Math.min(100, Math.max(0, Number(event.target.value))))} /><span>%</span></div><button type="button" aria-label="Increase minimum contribution" onClick={() => setMinContribution((value) => Math.min(100, Number((value + .1).toFixed(1))))}>+</button></div></label>
        <label><span>Max. number of processes</span><div className="sankey-stepper"><button type="button" aria-label="Decrease maximum processes" onClick={() => setMaxProcesses((value) => Math.max(1, value - 1))}>−</button><input type="number" min="1" max={availableProcessCount} step="1" value={maxProcesses} onChange={(event) => setMaxProcesses(Math.min(availableProcessCount, Math.max(1, Math.floor(Number(event.target.value) || 1))))} /><button type="button" aria-label="Increase maximum processes" onClick={() => setMaxProcesses((value) => Math.min(availableProcessCount, value + 1))}>+</button></div></label>
        <label><span>Orientation</span><select value={orientation} onChange={(event) => setOrientation(event.target.value as "vertical" | "horizontal")}><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select></label>
        <label><span>Connections</span><select value={connectionStyle} onChange={(event) => setConnectionStyle(event.target.value as "curved" | "straight" | "step")}><option value="curved">Curved</option><option value="straight">Straight</option><option value="step">Step</option></select></label>
      </div>
    </div> : null}
    <div className="sankey-canvas">
      {totalMagnitude ? <ReactFlow
        key={`sankey-layout-${layoutVersion}`}
        defaultNodes={sankeyNodes}
        defaultEdges={sankeyEdges}
        nodeTypes={sankeyNodeTypes}
        onInit={(instance) => { instanceRef.current = instance }}
        onPaneClick={() => setChartPickerOpen(false)}
        minZoom={0.25}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: .4, maxZoom: .68 }}
        proOptions={{ hideAttribution: true }}
      ><Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#242831" /></ReactFlow> : <div className="sankey-empty"><strong>No contributions for this selection</strong><p>Choose another flow or impact category.</p></div>}
    </div>
    {totalMagnitude ? <div className="graph-toolbar sankey-toolbar" aria-label="Sankey graph tools">
      <div className="toolbar-group"><ToolButton label="Chart settings" onClick={() => setChartPickerOpen((open) => !open)}><Settings2 size={18} /></ToolButton></div>
      <div className="toolbar-group"><ToolButton label="Select"><MousePointer2 size={18} /></ToolButton></div>
      <div className="toolbar-group">
        <ToolButton label="Auto layout" onClick={() => setLayoutVersion((value) => value + 1)}><LayoutGrid size={18} /></ToolButton>
        <ToolButton label="Fit graph" onClick={fitSankey}><Scan size={18} /></ToolButton>
      </div>
      <div className="toolbar-group">
        <ToolButton label="Zoom in" onClick={() => instanceRef.current?.zoomIn({ duration: 200 })}><Plus size={18} /></ToolButton>
        <ToolButton label="Zoom out" onClick={() => instanceRef.current?.zoomOut({ duration: 200 })}><Minus size={18} /></ToolButton>
      </div>
    </div> : null}
    <div className="sankey-selection-summary" aria-label="Active Sankey settings">
      <div className="sankey-selection-title">
        {mode === "impact" ? <BarChart3 size={14} /> : <span className="flow-dot output" />}
        <span>{mode === "impact" ? "Impact category" : "Flow"}</span>
      </div>
      <strong>{mode === "impact" ? impactCategoryAbbreviation(selectedImpact) : inventoryFlowName(selectedFlow)}</strong>
      <span className="sankey-selection-result">{format(selectedTotal)} {unit}</span>
      <dl>
        <div><dt>Min. contribution</dt><dd>{minContribution}%</dd></div>
        <div><dt>Max. processes</dt><dd>{maxProcesses}</dd></div>
        <div><dt>Orientation</dt><dd>{orientation}</dd></div>
        <div><dt>Connections</dt><dd>{connectionStyle}</dd></div>
      </dl>
    </div>
  </div>
}

function ToolButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button aria-label={label} onClick={onClick} variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content side="right" sideOffset={8} className="tooltip">{label}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  )
}

function GraphEditor() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ProcessNodeData>>(layoutNodes(initialNodes, initialEdges))
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [selected, setSelected] = useState<(NodeMeta & { id: string }) | null>(null)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"graph" | "yaml" | "inventory" | "impact" | "process" | "contribution" | "sankey" | "results">("graph")
  const [yamlText, setYamlText] = useState(jacketYaml)
  const [selectedCaseStudy, setSelectedCaseStudy] = useState<CaseStudyId | "custom">("jacket")
  const [yamlError, setYamlError] = useState("")
  const [graphTitle, setGraphTitle] = useState(defaultGraph.name)
  const [resultsMarkdown, setResultsMarkdown] = useState("")
  const [resultsError, setResultsError] = useState("")
  const [isCalculating, setIsCalculating] = useState(false)
  const [lcaResult, setLcaResult] = useState<LcaResult | null>(null)
  const [calculatedYaml, setCalculatedYaml] = useState("")
  const [graphMode, setGraphMode] = useState<"scaled" | "structure">("structure")
  const foldDirectionRef = useRef<"upstream" | "downstream">("upstream")
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  nodesRef.current = nodes
  edgesRef.current = edges
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  const removeNode = useCallback((id: string) => {
    const folded = new Set<string>()
    const visit = (nodeId: string) => {
      edgesRef.current.filter((edge) => foldDirectionRef.current === "upstream" ? edge.target === nodeId : edge.source === nodeId).forEach((edge) => {
        const nextId = foldDirectionRef.current === "upstream" ? edge.source : edge.target
        if (!folded.has(nextId)) { folded.add(nextId); visit(nextId) }
      })
    }
    visit(id)
    if (!folded.size) return
    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, canRestore: true } }
      : folded.has(node.id) ? { ...node, hidden: true } : node))
    setEdges((current) => current.map((edge) => folded.has(edge.source) || folded.has(edge.target) ? { ...edge, hidden: true } : edge))
  }, [setNodes, setEdges])

  const restoreNode = useCallback((id: string) => {
    const depths = new Map<string, number>()
    const queue: Array<{ id: string; depth: number }> = [{ id, depth: 0 }]
    while (queue.length) {
      const current = queue.shift()!
      edgesRef.current.filter((edge) => foldDirectionRef.current === "upstream" ? edge.target === current.id : edge.source === current.id).forEach((edge) => {
        const nextId = foldDirectionRef.current === "upstream" ? edge.source : edge.target
        const nextDepth = current.depth + 1
        const knownDepth = depths.get(nextId)
        if (knownDepth === undefined || nextDepth < knownDepth) {
          depths.set(nextId, nextDepth)
          queue.push({ id: nextId, depth: nextDepth })
        }
      })
    }
    const hiddenDownstream = nodesRef.current.filter((node) => node.hidden && depths.has(node.id))
    if (!hiddenDownstream.length) return
    const nextDepth = Math.min(...hiddenDownstream.map((node) => depths.get(node.id)!))
    const revealIds = new Set(hiddenDownstream.filter((node) => depths.get(node.id) === nextDepth).map((node) => node.id))
    const remainingAfterReveal = hiddenDownstream.some((node) => !revealIds.has(node.id))
    const hiddenAfterReveal = new Set(nodesRef.current.filter((node) => node.hidden && !revealIds.has(node.id)).map((node) => node.id))

    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, canRestore: remainingAfterReveal } }
      : revealIds.has(node.id) ? {
          ...node,
          hidden: false,
          data: {
            ...node.data,
            canRestore: edgesRef.current.some((edge) => foldDirectionRef.current === "upstream"
              ? edge.target === node.id && hiddenAfterReveal.has(edge.source)
              : edge.source === node.id && hiddenAfterReveal.has(edge.target)),
          },
        } : node))
    setEdges((current) => current.map((edge) => depths.has(edge.source) || depths.has(edge.target) || (foldDirectionRef.current === "upstream" ? edge.target === id : edge.source === id)
      ? { ...edge, hidden: hiddenAfterReveal.has(edge.source) || hiddenAfterReveal.has(edge.target) }
      : edge))
  }, [setEdges, setNodes])

  useEffect(() => {
    setNodes((current) => current.map((node) => (
      node.data.onRemove === removeNode && node.data.onRestore === restoreNode && node.data.canFold === edges.some((edge) => (
        foldDirectionRef.current === "upstream" ? edge.target === node.id : edge.source === node.id
      ))
        ? node
        : { ...node, data: {
            ...node.data,
            onRemove: removeNode,
            onRestore: restoreNode,
            canFold: edges.some((edge) => foldDirectionRef.current === "upstream" ? edge.target === node.id : edge.source === node.id),
          } }
    )))
  }, [edges, removeNode, restoreNode, setNodes])

  useEffect(() => {
    const term = query.trim().toLowerCase()
    if (!term) {
      setNodes((current) => current.map((node) => (node.data.faded ? { ...node, data: { ...node.data, faded: false } } : node)))
      setEdges((current) => current.map((edge) => (edge.style?.opacity ? { ...edge, style: { ...edge.style, opacity: 1 } } : edge)))
      return
    }
    const matchedIds = new Set(nodes.filter((node) => node.data.label.toLowerCase().includes(term)).map((node) => node.id))
    const connectedIds = new Set(matchedIds)
    edges.forEach((edge) => {
      if (matchedIds.has(edge.source) || matchedIds.has(edge.target)) { connectedIds.add(edge.source); connectedIds.add(edge.target) }
    })
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, faded: !connectedIds.has(node.id) } })))
    setEdges((current) => current.map((edge) => ({ ...edge, style: { ...edge.style, opacity: connectedIds.has(edge.source) && connectedIds.has(edge.target) ? 1 : 0.12 } })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const hydrateBackgroundNode = useCallback(async (nodeId: string) => {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId)
    if (!node || node.data.scope !== "background" || !node.data.database || node.data.backgroundLoaded || node.data.backgroundLoading) return
    setNodes((current) => current.map((candidate) => candidate.id === nodeId
      ? { ...candidate, data: { ...candidate.data, backgroundLoading: true, backgroundError: undefined } }
      : candidate))
    try {
      const details = await getBackgroundActivityDetails({
        database: node.data.database,
        code: node.data.code,
        name: node.data.label,
        location: node.data.location,
      })
      const production = details.exchanges.find((exchange) => exchange.exchange_type === "production")
      const productionAmount = production?.amount ?? 1
      if (productionAmount === 0) throw new Error("The background activity has a zero production amount and cannot be scaled.")
      const activityScale = node.data.showAmounts ? (node.data.backgroundDemand ?? 0) / productionAmount : null
      const displayAmount = (amount: number) => activityScale === null ? undefined : Number((amount * activityScale).toPrecision(8))
      const inputs = details.exchanges.filter((exchange) => exchange.exchange_type === "technosphere").map((exchange) => ({
        label: exchange.input_name,
        kind: "background input",
        color: nodeScopeColors.background,
        amount: displayAmount(exchange.amount),
        unit: exchange.unit ?? undefined,
      }))
      const outputs = details.exchanges.filter((exchange) => exchange.exchange_type === "production").map((exchange) => ({
        label: exchange.input_product ?? exchange.input_name,
        kind: "reference output",
        color: nodeScopeColors.background,
        amount: displayAmount(exchange.amount),
        unit: exchange.unit ?? details.unit ?? node.data.backgroundDemandUnit,
      }))
      const biosphere = details.exchanges.filter((exchange) => exchange.exchange_type === "biosphere").map((exchange) => ({
        label: chemicalFlowLabel(exchange.input_name),
        amount: displayAmount(exchange.amount),
        unit: exchange.unit ?? "",
      }))
      setNodes((current) => current.map((candidate) => candidate.id === nodeId && candidate.data.showAmounts === node.data.showAmounts
        ? { ...candidate, data: {
            ...candidate.data,
            label: details.name,
            detail: `Background activity · ${details.database}${details.location ? ` · ${details.location}` : ""}`,
            code: details.code,
            location: details.location ?? undefined,
            inputs,
            outputs,
            biosphere,
            backgroundLoading: false,
            backgroundLoaded: true,
          } }
        : candidate))
    } catch (error) {
      setNodes((current) => current.map((candidate) => candidate.id === nodeId && candidate.data.showAmounts === node.data.showAmounts
        ? { ...candidate, data: {
            ...candidate.data,
            backgroundLoading: false,
            backgroundError: error instanceof Error ? error.message : "Could not load this background activity.",
          } }
        : candidate))
    }
  }, [setNodes])

  const toggleExpanded = useCallback((nodeId: string) => {
    const target = nodesRef.current.find((node) => node.id === nodeId)
    const expanding = !target?.data.expanded
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]))
      return current.map((node) => {
        if (node.id !== nodeId) return node
        if (node.data.scope === "background") return { ...node, data: { ...node.data, expanded: !node.data.expanded } }
        const flowItem = (id: string) => {
          const connected = byId.get(id)
          return connected ? { label: connected.data.label, kind: connected.data.scope ?? connected.data.kind, color: connected.data.color } : null
        }
        const inputs = incomingEdgesFor(nodeId, edges, byId).map((edge) => {
          const item = flowItem(edge.source)
          return item ? { ...item, handleId: inputHandleIdFor(edge.id) } : null
        }).filter((item): item is NonNullable<typeof item> => item !== null)
        const outputs = edges.filter((edge) => edge.source === nodeId).map((edge) => flowItem(edge.target)).filter((item): item is NonNullable<typeof item> => item !== null)
        return { ...node, data: { ...node.data, expanded: !node.data.expanded, inputs, outputs } }
      })
    })
    if (target?.data.scope !== "background") {
      setEdges((current) => current.map((edge) => edge.target === nodeId
        ? { ...edge, targetHandle: expanding ? inputHandleIdFor(edge.id) : undefined }
        : edge))
    }
    if (target?.data.scope === "background" && !target.data.expanded) void hydrateBackgroundNode(nodeId)
  }, [edges, hydrateBackgroundNode, setEdges, setNodes])

  const fit = () => fitView({ padding: 0.35, maxZoom: 0.75, duration: 350 })
  const relayout = () => {
    setNodes((current) => layoutNodes(current, edges))
    requestAnimationFrame(fit)
  }

  const showGraphMode = (mode: "scaled" | "structure") => {
    try {
      const currentResult = calculatedYaml === yamlText ? lcaResult : null
      if (mode === "scaled" && !currentResult) return
      const parsed = buildGraphFromYaml(yamlText, mode, currentResult?.scaling_vector)
      const previousById = new Map(nodesRef.current.map((node) => [node.id, node]))
      const laidOutNodes = layoutNodes(parsed.nodes, parsed.edges)
      let nextNodes: Node<ProcessNodeData>[] = laidOutNodes.map((node) => {
        const previous = previousById.get(node.id)
        return {
          ...node,
          position: previous?.position ?? node.position,
          hidden: previous?.hidden ?? false,
          selected: previous?.selected ?? false,
          data: {
            ...node.data,
            expanded: previous?.data.expanded ?? false,
            canRestore: previous?.data.canRestore ?? false,
            canFold: parsed.edges.some((edge) => edge.target === node.id),
          },
        }
      })
      const hiddenIds = new Set(nextNodes.filter((node) => node.hidden).map((node) => node.id))
      let nextEdges: Edge[] = parsed.edges.map((edge) => ({
        ...edge,
        hidden: hiddenIds.has(edge.source) || hiddenIds.has(edge.target),
      }))
      nextEdges = targetExpandedInputRows(nextNodes, nextEdges)
      nextNodes = populateExpandedConnections(nextNodes, nextEdges)
      foldDirectionRef.current = "upstream"
      setEdges(nextEdges)
      setNodes(nextNodes)
      setGraphMode(mode)
      setYamlError("")
      requestAnimationFrame(() => nextNodes.filter((node) => node.data.scope === "background" && node.data.expanded).forEach((node) => void hydrateBackgroundNode(node.id)))
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : "Could not parse this YAML file.")
      setView("yaml")
    }
  }

  const previewYaml = () => {
    try {
      const currentResult = calculatedYaml === yamlText ? lcaResult : null
      const nextMode = graphMode === "scaled" && currentResult ? "scaled" : "structure"
      const parsed = buildGraphFromYaml(yamlText, nextMode, currentResult?.scaling_vector)
      foldDirectionRef.current = "upstream"
      setEdges(parsed.edges)
      setNodes(layoutNodes(parsed.nodes.map((node) => ({
        ...node,
        data: { ...node.data, canFold: parsed.edges.some((edge) => edge.target === node.id) },
      })), parsed.edges))
      setGraphTitle(parsed.name)
      setGraphMode(nextMode)
      setSelected(null)
      setYamlError("")
      setView("graph")
      requestAnimationFrame(() => fitView({ padding: 0.35, maxZoom: 0.75, duration: 350 }))
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : "Could not parse this YAML file.")
    }
  }

  const runCalculation = async () => {
    setIsCalculating(true)
    setResultsError("")
    try {
      const result = await calculateLca(yamlText)
      setLcaResult(result)
      setCalculatedYaml(yamlText)
      setResultsMarkdown(lcaResultToMarkdown(result))
    } catch (error) {
      setResultsError(error instanceof Error ? error.message : "Could not calculate the current product graph.")
    } finally {
      setIsCalculating(false)
    }
  }

  const loadYamlFile = (file?: File) => {
    if (!file) return
    if (!/\.ya?ml$/i.test(file.name)) { setYamlError("Choose a .yaml or .yml file."); return }
    const reader = new FileReader()
    reader.onload = () => { setYamlText(String(reader.result ?? "")); setSelectedCaseStudy("custom"); setYamlError(""); setResultsMarkdown(""); setLcaResult(null); setCalculatedYaml(""); setGraphMode("structure") }
    reader.onerror = () => setYamlError("Could not read the selected file.")
    reader.readAsText(file)
  }

  const loadCaseStudy = (id: CaseStudyId) => {
    setSelectedCaseStudy(id)
    setYamlText(caseStudies[id].yaml)
    setYamlError("")
    setResultsMarkdown("")
    setResultsError("")
    setLcaResult(null)
    setCalculatedYaml("")
    setGraphMode("structure")
  }

  const connectionCount = edges.length
  const hasCurrentResults = Boolean(lcaResult && calculatedYaml === yamlText)
  const selectedNode = selected ? nodes.find((node) => node.id === selected.id) : undefined
  const inputNodes = selectedNode ? edges
    .filter((edge) => edge.target === selectedNode.id)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is Node<ProcessNodeData> => Boolean(node)) : []
  const outputNodes = selectedNode ? edges
    .filter((edge) => edge.source === selectedNode.id)
    .map((edge) => nodes.find((node) => node.id === edge.target))
    .filter((node): node is Node<ProcessNodeData> => Boolean(node)) : []

  return (
    <>
      <div className="canvas-wrap">
        <div className="canvas-head">
          <h1>{graphTitle}</h1>
          <div className="canvas-actions">
            {view === "graph" ? <div className="search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a node…" aria-label="Find a node" /><kbd>⌘ K</kbd></div> : null}
            <div className="view-tabs" role="tablist" aria-label="Graph views">
              <button className={view === "graph" ? "is-active" : ""} onClick={() => setView("graph")}>Graph</button>
              <button className={view === "yaml" ? "is-active" : ""} onClick={() => setView("yaml")}>YAML</button>
              <button className={view === "results" ? "is-active" : ""} onClick={() => setView("results")}>LCA Results</button>
              {hasCurrentResults ? <>
                <button className={view === "inventory" ? "is-active" : ""} onClick={() => setView("inventory")}>Inventory</button>
                <button className={view === "impact" ? "is-active" : ""} onClick={() => setView("impact")}>Impact Analysis</button>
                <button className={view === "process" ? "is-active" : ""} onClick={() => setView("process")}>Process Results</button>
                <button className={view === "contribution" ? "is-active" : ""} onClick={() => setView("contribution")}>Contribution</button>
                <button className={view === "sankey" ? "is-active" : ""} onClick={() => setView("sankey")}>Sankey Graph</button>
              </> : null}
            </div>
          </div>
        </div>
        {view === "graph" ? <><ReactFlow
          className="reactflow-canvas"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => {
            setSelected({ id: node.id, label: node.data.label, kind: node.data.kind, detail: node.data.detail, color: node.data.color, scope: node.data.scope })
            if (node.data.scope === "background") void hydrateBackgroundNode(node.id)
          }}
          onNodeDoubleClick={(_, node) => toggleExpanded(node.id)}
          onPaneClick={() => setSelected(null)}
          minZoom={0.35}
          maxZoom={2.4}
          onInit={(instance) => requestAnimationFrame(() => instance.fitView({ padding: 0.35, maxZoom: 0.75 }))}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#242831" />
        </ReactFlow>
        <div className="graph-toolbar" aria-label="Graph tools">
          <div className="toolbar-group">
            <ToolButton label="Select"><MousePointer2 size={18} /></ToolButton>
          </div>
          <div className="toolbar-group">
            <ToolButton label="Auto layout" onClick={relayout}><LayoutGrid size={18} /></ToolButton>
            <ToolButton label="Fit graph" onClick={fit}><Scan size={18} /></ToolButton>
          </div>
          <div className="toolbar-group">
            <ToolButton label="Zoom in" onClick={() => zoomIn({ duration: 200 })}><Plus size={18} /></ToolButton>
            <ToolButton label="Zoom out" onClick={() => zoomOut({ duration: 200 })}><Minus size={18} /></ToolButton>
          </div>
        </div>
        <div className="graph-mode-toolbar" aria-label="Graph display mode">
          <Button disabled={!lcaResult || calculatedYaml !== yamlText} title={!lcaResult || calculatedYaml !== yamlText ? "Calculate LCA results to enable the scaled graph" : undefined} variant="ghost" className={`graph-action ${graphMode === "scaled" ? "is-active" : ""}`} aria-pressed={graphMode === "scaled"} onClick={() => showGraphMode("scaled")}><Scan size={16} />Scaled Graph</Button>
          <Button variant="ghost" className={`graph-action ${graphMode === "structure" ? "is-active" : ""}`} aria-pressed={graphMode === "structure"} onClick={() => showGraphMode("structure")}><LayoutGrid size={16} />Structure Graph</Button>
        </div></> : view === "yaml" ? <div className="yaml-editor">
          <div className="yaml-editor-head">
            <div><strong>Product graph YAML</strong><span>Paste YAML or choose a local .yaml/.yml file.</span></div>
            <div className="yaml-editor-actions">
              <label className="case-study-select">Case study<select value={selectedCaseStudy} onChange={(event) => event.target.value !== "custom" && loadCaseStudy(event.target.value as CaseStudyId)} aria-label="Choose a case study">
                {Object.entries(caseStudies).map(([id, study]) => <option key={id} value={id}>{study.label}</option>)}
                {selectedCaseStudy === "custom" ? <option value="custom">Custom YAML</option> : null}
              </select></label>
              <label className="yaml-upload"><FileUp size={15} /> Choose file<input type="file" accept=".yaml,.yml,text/yaml" onChange={(event) => loadYamlFile(event.target.files?.[0])} /></label>
            </div>
          </div>
          <textarea value={yamlText} onChange={(event) => { setYamlText(event.target.value); setSelectedCaseStudy("custom"); setResultsMarkdown(""); setLcaResult(null); setCalculatedYaml(""); setGraphMode("structure") }} spellCheck={false} aria-label="Product graph YAML" />
          <div className="yaml-editor-foot">
            <span className={yamlError ? "yaml-error" : ""}>{yamlError || "Files are parsed locally in your browser."}</span>
            <Button onClick={previewYaml}>Preview graph</Button>
          </div>
        </div> : view === "inventory" ? <InventoryView result={lcaResult} yaml={yamlText} isCurrent={calculatedYaml === yamlText} error={resultsError} /> : view === "impact" ? <ImpactAnalysisView result={lcaResult} yaml={yamlText} isCurrent={calculatedYaml === yamlText} error={resultsError} /> : view === "process" && lcaResult ? <ProcessResultsView result={lcaResult} yaml={yamlText} /> : view === "contribution" ? <ContributionView result={lcaResult} yaml={yamlText} isCurrent={calculatedYaml === yamlText} error={resultsError} /> : view === "sankey" && lcaResult ? <SankeyView result={lcaResult} /> : <div className="results-panel">
          <div className="results-panel-head">
            <div><strong>LCA Results</strong><span>Calculated from the current YAML product graph.</span></div>
            <Button onClick={runCalculation} disabled={isCalculating}>{isCalculating ? "Calculating…" : "Calculate"}</Button>
          </div>
          <div className="results-panel-body">
            {resultsError ? <div className="results-error"><strong>Calculation failed</strong><p>{resultsError}</p></div>
              : resultsMarkdown ? <article className="markdown-report"><ReactMarkdown remarkPlugins={[remarkGfm]}>{resultsMarkdown}</ReactMarkdown></article>
              : <div className="results-placeholder"><div className="results-empty-icon"><BarChart3 size={22} /></div><strong>No LCA results yet</strong><p>Select Calculate to analyze the current YAML graph.</p></div>}
          </div>
        </div>}
        {view === "graph" ? <div className="graph-meta">{nodes.length} nodes&nbsp;&nbsp;·&nbsp;&nbsp;{connectionCount} connections</div> : null}
      </div>

      {view === "graph" && selected ? <aside className="inspector">
        <>
          <div className="inspector-head"><span>NODE DETAILS</span><Button variant="ghost" size="icon" onClick={() => setSelected(null)}><Maximize size={16} /></Button></div>
          <div className="node-icon" style={{ background: selectedNode?.data.color ?? selected.color }}><Box size={22} /></div>
          <h2>{selectedNode?.data.label ?? selected.label}</h2><p>{selectedNode?.data.detail ?? selected.detail}</p>
          {selectedNode?.data.scope === "background" ? <>
            {selectedNode.data.backgroundLoading ? <div className="property-section"><p>Loading unit process…</p></div> : null}
            {selectedNode.data.backgroundError ? <div className="property-section"><p className="property-error">{selectedNode.data.backgroundError}</p></div> : null}
            <div className="property-section">
              <h3>Direct inputs</h3>
              {selectedNode.data.inputs?.length ? selectedNode.data.inputs.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span>{item.amount === undefined ? null : <strong>{item.amount}{item.unit ? ` ${item.unit}` : ""}</strong>}</div>) : <p>No technosphere inputs</p>}
            </div>
            <div className="property-section">
              <h3>Reference output</h3>
              {selectedNode.data.outputs?.length ? selectedNode.data.outputs.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span>{item.amount === undefined ? null : <strong>{item.amount}{item.unit ? ` ${item.unit}` : ""}</strong>}</div>) : <p>No production exchange</p>}
            </div>
            {selectedNode.data.biosphere?.length ? <div className="property-section is-emission">
              <h3>Biosphere exchanges</h3>
              {selectedNode.data.biosphere.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span>{item.amount === undefined ? null : <strong>{item.amount}{item.unit ? ` ${item.unit}` : ""}</strong>}</div>)}
            </div> : null}
          </> : <>
            <div className="property-section">
              <h3>Input flows</h3>
              {inputNodes.length ? inputNodes.map((node) => <div className="property-row" key={node.id}><span>{node.data.label}</span><small>{node.data.scope ?? node.data.kind}</small></div>) : <p>No input flows</p>}
            </div>
            <div className="property-section">
              <h3>Output flows</h3>
              {outputNodes.length ? outputNodes.map((node) => <div className="property-row" key={node.id}><span>{node.data.label}</span><small>{node.data.scope ?? node.data.kind}</small></div>) : <p>No output flows</p>}
            </div>
            {selectedNode?.data.extractions?.length ? <div className="property-section is-extraction">
              <h3>Resource extractions</h3>
              {selectedNode.data.extractions.map((item) => <div className="property-row" key={item.label}><span>{item.label}</span>{selectedNode.data.showAmounts !== false ? <strong>{item.amount} {item.unit}</strong> : null}</div>)}
            </div> : null}
            {selectedNode?.data.emissions?.length ? <div className="property-section is-emission">
              <h3>Emissions to air</h3>
              {selectedNode.data.emissions.map((item) => <div className="property-row" key={item.label}><span>{item.label}</span>{selectedNode.data.showAmounts !== false ? <strong>{item.amount} {item.unit}</strong> : null}</div>)}
            </div> : null}
          </>}
        </>
      </aside> : null}
    </>
  )
}

export default function App() {
  return (
    <Tooltip.Provider delayDuration={250}>
      <main className="app-shell">
        <header className="topbar">
          <div className="brand"><div className="brand-mark"><Share2 size={16} /></div><span>PRISM Life Cycle Assessment</span></div>
        </header>

        <section className="workspace">
          <ReactFlowProvider>
            <GraphEditor />
          </ReactFlowProvider>
        </section>
      </main>
    </Tooltip.Provider>
  )
}
