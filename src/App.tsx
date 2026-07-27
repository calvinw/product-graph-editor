import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant,
  Handle, Position, useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  BarChart3, Box, Component, Scan, LayoutGrid, ChevronDown, Factory, Leaf,
  FileUp, Minus, Moon, MousePointer2, Plus, Search, Settings2, Share2, Sun, X,
} from "lucide-react"
import { parse } from "yaml"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ProcessNode, type ProcessNodeData } from "./components/ProcessNode"
import { layoutNodes } from "./lib/layout"
import { chemicalFlowLabel } from "./lib/flowLabels"
import { buildGraphFromYaml, buildInventoryRequirements, nodeScopeColors } from "./lib/yamlGraph"
import {
  calculateLca, getBackgroundActivityDetails, impactCategoryAbbreviation, impactCategoryDisplayName, lcaResultToMarkdown,
  type ContributionGraphEdge, type ContributionGraphFlow, type ContributionGraphNode, type LcaResult,
} from "./lib/lcaApi"
import { unitsAreCompatible } from "./lib/units"
import { DisplaySettingsProvider, useDisplaySettings } from "./lib/displaySettings"
import jacketYaml from "../case_studies/jacket.yaml?raw"
import cottonFiberYaml from "../case_studies/cotton_fiber.yaml?raw"
import cottonFiberBafuLinkedYaml from "../case_studies/cotton_fiber_bafu_linked.yaml?raw"
import mockPlasticBroomYaml from "../case_studies/mock_plastic_broom.yaml?raw"
import plasticBroomYaml from "../case_studies/plastic_broom.yaml?raw"
import polyesterTshirtYaml from "../case_studies/polyester_tshirt.yaml?raw"
import polyesterTshirtBafuLinkedYaml from "../case_studies/polyester_tshirt_bafu_linked.yaml?raw"
import woolYarnYaml from "../case_studies/wool_yarn.yaml?raw"
import woolYarnBafuLinkedYaml from "../case_studies/wool_yarn_bafu_linked.yaml?raw"

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
    <div className="pg-node-head"><Component size={14} /><span className="pg-node-label">{data.label}</span><small className={`pg-node-scope is-${data.scope}`}>{data.scope}</small></div>
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
  cottonFiberBafuLinked: { label: "Cotton Fiber(bafu-linked)", yaml: cottonFiberBafuLinkedYaml },
  mockPlasticBroom: { label: "Mock Plastic Broom", yaml: mockPlasticBroomYaml },
  plasticBroom: { label: "Plastic Broom(bafu-linked)", yaml: plasticBroomYaml },
  polyesterTshirt: { label: "Polyester T-shirt", yaml: polyesterTshirtYaml },
  polyesterTshirtBafuLinked: { label: "Polyester T-shirt(bafu-linked)", yaml: polyesterTshirtBafuLinkedYaml },
  woolYarn: { label: "Wool Yarn", yaml: woolYarnYaml },
  woolYarnBafuLinked: { label: "Wool Yarn(bafu-linked)", yaml: woolYarnBafuLinkedYaml },
} as const
type CaseStudyId = keyof typeof caseStudies

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
  const { formatNumber } = useDisplaySettings()
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
    <tbody>{rows.length ? rows.map((flow) => <tr key={`${flow.type}-${flow.name}`}><td><span className={isInventoryInput(flow.type) ? "flow-dot input" : "flow-dot output"} />{inventoryFlowName(flow.name)}</td><td>{flow.type}</td><td className="number">{formatNumber(flow.amount)}</td><td>{flow.unit}</td></tr>) : <tr className="empty-row"><td colSpan={4}>{empty}</td></tr>}</tbody>
  </table></div>

  return <div className="inventory-view">
    <div className="inventory-title"><div><strong>{result.name}</strong><span>{result.functional_unit}</span></div></div>
    <details open><summary>Inputs <span>{inputs.length}</span></summary><FlowTable rows={inputs} empty="No environmental input flows were returned." /></details>
    <details open><summary>Outputs <span>{outputs.length}</span></summary><FlowTable rows={outputs} empty="No environmental output flows were returned." /></details>
    <details open className="requirements"><summary>Total requirements <span>{requirements.length}</span></summary>
      {requirementError ? <div className="results-error"><p>{requirementError}</p></div> : <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Process</th><th>Product</th><th className="number">Amount</th><th>Unit</th></tr></thead><tbody>
        {requirements.map((row) => <tr key={row.process}><td><span className="process-mark">⌘</span>{row.process}</td><td><span className="product-mark">⚙</span>{row.product}</td><td className="number">{formatNumber(row.amount)}</td><td>{row.unit}</td></tr>)}
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
  const normalizedCategory = normalizedFlow(category)
  const normalized = normalizedFlow(flow)
  const isGlobalWarming = /^GWP(?:\d+)?$/.test(indicator) || /global warming|climate change/.test(normalizedCategory)
  if (isGlobalWarming) {
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
  const { formatNumber } = useDisplaySettings()
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
      const key = category.id || category.label
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
            <td><div className="impact-category-name"><button className={`tree-toggle ${isOpen ? "is-expanded" : ""}`} aria-label={`${isOpen ? "Collapse" : "Expand"} ${category.label}`}><ChevronDown size={14} /></button><BarChart3 className="impact-category-icon" size={17} /><strong>{impactCategoryDisplayName(category.label)}</strong></div></td>
            <td /><td /><td /><td><span className="impact-result">{formatNumber(category.total_score)} <small>{category.unit}</small></span></td>
          </tr>
          {isOpen && subgroup === "processes" ? processes.flatMap((process) => {
            const processKey = `${categoryId}:${process.process_id}`
            const flows = processFlows(process.process_name, process.process_id, category.label)
            const processOpen = expandedProcesses.has(processKey)
            const displayName = cleanImpactProcessName(process.process_name)
            const processRow = <tr className="impact-process-row" key={processKey} onClick={() => flows.length && toggleProcess(processKey)}>
              <td><span className="impact-indent" />{flows.length ? <button className={`tree-toggle ${processOpen ? "is-expanded" : ""}`} aria-label={`${processOpen ? "Collapse" : "Expand"} ${displayName}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="impact-process-icon"><Factory size={14} /></span>{displayName}</td>
              <td /><td /><td /><td><span className="impact-bar"><i style={{ width: `${Math.min(100, Math.abs(process.percentage ?? (category.total_score ? process.direct_score / category.total_score * 100 : 0)))}%` }} /></span><span className="impact-result">{formatNumber(process.direct_score)} <small>{category.unit}</small></span></td>
            </tr>
            const flowRows = processOpen ? flows.map((flow) => <tr className="impact-flow-row" key={`${processKey}:${flow.name}`}>
              <td><span className="impact-indent flow" /><span className="impact-flow-icon"><Leaf size={14} /></span>{inventoryFlowName(flow.name)}</td>
              <td>{flow.category}</td>
              <td className="number">{formatNumber(flow.amount)} <small>{flow.unit}</small></td>
              <td className="number">{formatNumber(flow.factor)} <small>{category.unit}/{flow.unit}</small></td>
              <td><span className="impact-bar flow"><i style={{ width: `${Math.min(100, Math.abs(category.total_score ? flow.impact / category.total_score * 100 : 0))}%` }} /></span><span className="impact-result">{formatNumber(flow.impact)} <small>{category.unit}</small></span></td>
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
                <td className="number">{formatNumber(flow.amount)} <small>{flow.unit}</small></td>
                <td className="number">{formatNumber(flow.factor)} <small>{category.unit}/{flow.unit}</small></td>
                <td><span className="impact-bar flow"><i style={{ width: `${Math.min(100, Math.abs(category.total_score ? flow.impact / category.total_score * 100 : 0))}%` }} /></span><span className="impact-result">{formatNumber(flow.impact)} <small>{category.unit}</small></span></td>
              </tr>
              const processRows = flowOpen ? flow.processes
                .filter((process) => Math.abs(category.total_score ? process.impact / category.total_score * 100 : 0) >= threshold)
                .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
                .map((process) => <tr className="impact-flow-process-row" key={`${flowId}:${process.id}`}>
                  <td><span className="impact-indent flow-process" /><span className="impact-process-icon"><Factory size={14} /></span>{process.name}</td>
                  <td /><td className="number">{formatNumber(process.amount)} <small>{flow.unit}</small></td><td />
                  <td><span className="impact-bar"><i style={{ width: `${Math.min(100, Math.abs(category.total_score ? process.impact / category.total_score * 100 : 0))}%` }} /></span><span className="impact-result">{formatNumber(process.impact)} <small>{category.unit}</small></span></td>
                </tr>) : []
              return [flowRow, ...processRows]
            }) : null}
        </Fragment>
      })}</tbody>
    </table></div>
  </div>
}

function ProcessResultsView({ result, yaml }: { result: LcaResult; yaml: string }) {
  const { formatNumber, formatPercent } = useDisplaySettings()
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
        <td>{inventoryFlowName(flow.name)}</td><td>{flow.category}</td><td>{formatNumber(flow.upstream)}</td><td>{formatNumber(flow.direct)}</td><td>{flow.unit}</td>
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
      <div className="process-impact-table-wrap"><table className="process-impact-table"><thead><tr><th>Contribution</th><th>Impact category</th><th>Upstream incl. direct</th><th>Direct</th><th>Unit</th></tr></thead><tbody>{impactRows.map((row) => <tr key={row.category.id || row.category.label}><td><span className="process-result-bar"><i style={{ width: `${Math.min(100, Math.abs(row.contribution))}%` }} /></span>{formatPercent(row.contribution)}</td><td>{impactCategoryDisplayName(row.category.label)}</td><td>{formatNumber(row.upstream)}</td><td>{formatNumber(row.direct)}</td><td>{row.category.unit}</td></tr>)}</tbody></table></div>
    </details>
  </div>
}

function ContributionView({ result, yaml, isCurrent, error }: {
  result: LcaResult | null
  yaml: string
  isCurrent: boolean
  error: string
}) {
  const { formatNumber, formatPercent } = useDisplaySettings()
  const [mode, setMode] = useState<"flow" | "impact" | null>("impact")
  const [flow, setFlow] = useState("")
  const [impact, setImpact] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(() => new Set())

  const flowNames = result ? Object.keys(result.lci) : []
  const impactNames = result ? Object.keys(result.lcia) : []
  const selectedFlow = flowNames.includes(flow) ? flow : (flowNames[0] ?? "")
  const defaultImpact = impactNames.find((name) => impactCategoryAbbreviation(name).replaceAll(/\s+/g, "").toUpperCase() === "GWP100")
    ?? impactNames.find((name) => /global warming|climate change/i.test(name))
    ?? impactNames[0]
    ?? ""
  const selectedImpact = impactNames.includes(impact) ? impact : defaultImpact
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
  const selectedContributionGraph = mode === "impact"
    ? result.contribution_graphs.find((item) => item.label === selectedImpact)
    : undefined
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
  const number = (value: number | undefined) => value === undefined ? "—" : formatNumber(value)
  let legacyGraph: ReturnType<typeof buildGraphFromYaml> | null = null
  try { legacyGraph = buildGraphFromYaml(yaml, "structure") } catch { legacyGraph = null }
  const graphNameById = new Map(legacyGraph?.nodes.map((node) => [node.id, cleanProcessName(node.data.label)]) ?? [])
  const upstreamByName = new Map<string, string[]>()
  legacyGraph?.edges.forEach((edge) => {
    const consumer = graphNameById.get(edge.target)
    const supplier = graphNameById.get(edge.source)
    if (!consumer || !supplier) return
    upstreamByName.set(consumer, [...(upstreamByName.get(consumer) ?? []), supplier])
  })
  const rowByName = new Map(rows.map((row) => [row.name.toLowerCase(), row]))
  const suppliedNames = new Set([...upstreamByName.values()].flat().map((name) => name.toLowerCase()))
  const rootRows = rows.filter((row) => !suppliedNames.has(row.name.toLowerCase()))
  const toggleProcess = (key: string) => setExpandedProcesses((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key); else next.add(key)
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
      <td><span className="rate-value">{formatPercent(percent)}</span></td>
      <td style={{ paddingLeft: `${7 + depth * 20}px` }}>{canExpand ? <button className={`tree-toggle ${isOpen ? "is-expanded" : ""}`} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} inputs for ${row.name}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="process-mark">⌘</span>{row.name}</td>
      <td>{number(row.required)}</td><td><span className="result-bar"><i className={displayedValue < 0 ? "negative" : ""} style={{ width: `${Math.min(100, Math.abs(displayedValue) / maxMagnitude * 100)}%` }} /></span>{mode === "impact" ? number(displayedValue) : "—"}</td><td>{mode === "impact" ? <>{number(row.total)} <small>({formatPercent(total ? row.total / total * 100 : 0)} direct)</small></> : "—"}</td>
    </tr>
    return isOpen ? [processRow, ...renderContributionRows(upstream, depth + 1)] : [processRow]
  })

  const graphNodesById = new Map(selectedContributionGraph?.nodes.map((node) => [node.id, node]) ?? [])
  const graphChildren = new Map<string, Array<{ node: ContributionGraphNode; edge: ContributionGraphEdge }>>()
  selectedContributionGraph?.edges.forEach((edge) => {
    const node = graphNodesById.get(edge.producer_id)
    if (!node) return
    graphChildren.set(edge.consumer_id, [...(graphChildren.get(edge.consumer_id) ?? []), { node, edge }])
  })
  const graphFlows = new Map<string, ContributionGraphFlow[]>()
  selectedContributionGraph?.flows.forEach((item) => {
    graphFlows.set(item.process_occurrence_id, [...(graphFlows.get(item.process_occurrence_id) ?? []), item])
  })
  const graphRoot = selectedContributionGraph?.nodes.find((node) => node.kind === "functional_unit")
  const graphFallbackRoots = selectedContributionGraph?.nodes.filter((node) => (
    node.kind === "process"
    && !selectedContributionGraph.edges.some((edge) => edge.producer_id === node.id)
  )) ?? []
  const graphTolerance = selectedContributionGraph
    ? Math.max(1e-12, Math.abs(selectedContributionGraph.total_score) * 1e-9)
    : 1e-12
  const isMaterial = (value: number) => Math.abs(value) > graphTolerance

  const renderFlowRows = (items: ContributionGraphFlow[], depth: number) => items.map((item) => <tr className={`contribution-flow-row is-${item.kind}`} key={item.id}>
    <td><span className="rate-value">{item.percentage === null ? "—" : formatPercent(item.percentage)}</span></td>
    <td style={{ paddingLeft: `${29 + depth * 20}px` }} title={item.categories.join(" · ")}><Leaf size={13} /><span>{inventoryFlowName(item.flow_name)}</span><small>{item.kind}</small></td>
    <td>{number(item.amount)} <small>{item.unit}</small></td>
    <td>{number(item.score)} <small>{selectedContributionGraph?.unit}</small></td>
    <td>—</td>
  </tr>)

  function renderUnexpandedRow(node: ContributionGraphNode, depth: number) {
    const percent = selectedContributionGraph?.total_score
      ? node.unexpanded_score / selectedContributionGraph.total_score * 100
      : null
    return <tr className="contribution-unexpanded-row" key={`${node.id}:unexpanded`}>
      <td><span className="rate-value">{percent === null ? "—" : formatPercent(percent)}</span></td>
      <td style={{ paddingLeft: `${29 + depth * 20}px` }}><span className="unexpanded-mark">…</span>Unexpanded impact <small>cutoff/depth</small></td>
      <td>—</td>
      <td>{number(node.unexpanded_score)} <small>{selectedContributionGraph?.unit}</small></td>
      <td>—</td>
    </tr>
  }

  function renderGraphChildren(parent: ContributionGraphNode, depth: number): React.ReactNode[] {
    const children = [...(graphChildren.get(parent.id) ?? [])]
      .sort((left, right) => Math.abs(right.node.cumulative_score) - Math.abs(left.node.cumulative_score))
      .flatMap(({ node, edge }) => renderGraphNode(node, edge, depth))
    return isMaterial(parent.unexpanded_score)
      ? [...children, renderUnexpandedRow(parent, depth)]
      : children
  }

  function renderGraphNode(node: ContributionGraphNode, edge: ContributionGraphEdge | null, depth: number): React.ReactNode[] {
    const children = graphChildren.get(node.id) ?? []
    const canExpand = children.length > 0 || isMaterial(node.unexpanded_score)
    const isOpen = expandedProcesses.has(node.id)
    const attachedFlows = graphFlows.get(node.id) ?? []
    const extractions = attachedFlows.filter((item) => item.kind === "extraction")
    const emissions = attachedFlows.filter((item) => item.kind === "emission")
    const percentage = node.cumulative_percentage
    const processRow = <tr key={node.id} className={canExpand ? "clickable-process" : ""} onClick={canExpand ? () => toggleProcess(node.id) : undefined}>
      <td><span className="rate-value">{percentage === null ? "—" : formatPercent(percentage)}</span></td>
      <td style={{ paddingLeft: `${7 + depth * 20}px` }} title={edge ? `${edge.flow_name}: ${formatNumber(edge.amount)} ${edge.unit}` : undefined}>
        {canExpand ? <button className={`tree-toggle ${isOpen ? "is-expanded" : ""}`} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} inputs for ${node.process_name}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}
        <span className="process-mark">⌘</span><span>{node.process_name}</span>
        {node.scope ? <small className={`contribution-scope is-${node.scope}`}>{node.scope}</small> : null}
        {node.location ? <small>{node.location}</small> : null}
        {node.terminal ? <small>terminal</small> : null}
      </td>
      <td>{number(node.supply_amount)} <small>{node.unit}</small></td>
      <td><span className="result-bar"><i className={node.cumulative_score < 0 ? "negative" : ""} style={{ width: `${Math.min(100, Math.abs(selectedContributionGraph?.total_score ? node.cumulative_score / selectedContributionGraph.total_score * 100 : 0))}%` }} /></span>{number(node.cumulative_score)} <small>{selectedContributionGraph?.unit}</small></td>
      <td>{number(node.direct_score)} <small>{selectedContributionGraph?.unit}</small></td>
    </tr>
    return [
      ...renderFlowRows(extractions, depth),
      processRow,
      ...renderFlowRows(emissions, depth),
      ...(isOpen ? renderGraphChildren(node, depth + 1) : []),
    ]
  }

  const graphRootPercentage = graphRoot?.cumulative_percentage
    ?? (selectedContributionGraph?.status === "zero_total" ? null : 100)
  const graphRootCumulative = graphRoot?.cumulative_score ?? selectedContributionGraph?.total_score ?? total
  const graphRootDirect = graphRoot?.direct_score ?? 0
  const graphCanExpand = graphRoot
    ? (graphChildren.get(graphRoot.id)?.length ?? 0) > 0 || isMaterial(graphRoot.unexpanded_score)
    : graphFallbackRoots.length > 0

  return <div className="contribution-view">
    <div className="contribution-title"><div><strong>{result.name}</strong><span>{result.method} · {result.functional_unit}</span></div>
      {selectedContributionGraph ? <aside className={`contribution-graph-summary is-${selectedContributionGraph.status}`}>
        <strong>{selectedContributionGraph.status.replace("_", " ")}</strong>
        <span>Coverage {selectedContributionGraph.coverage === null ? "—" : formatPercent(selectedContributionGraph.coverage * 100)} · Unexpanded {formatNumber(selectedContributionGraph.unexpanded_score)} {selectedContributionGraph.unit}</span>
      </aside> : null}
    </div>
    <div className="contribution-controls">
      <label className={mode === "flow" ? "active" : ""}><input type="radio" checked={mode === "flow"} onChange={() => setMode("flow")} />Flow</label>
      <div className="contribution-control-slot">{mode === null || mode === "flow" ? <div className="contribution-select is-flow"><span className="flow-dot output" /><select value={selectedFlow} onChange={(event) => { setFlow(event.target.value); setMode("flow") }} aria-label="Flow category">{flowNames.map((name) => <option key={name} value={name}>{contributionFlowLabel(name)}</option>)}</select></div> : null}</div>
      <label className={mode === "impact" ? "active" : ""}><input type="radio" checked={mode === "impact"} onChange={() => setMode("impact")} />Impact category</label>
      <div className="contribution-control-slot">{mode === null || mode === "impact" ? <div className="contribution-select is-impact"><BarChart3 size={16} /><select value={selectedImpact} onChange={(event) => { setImpact(event.target.value); setMode("impact") }} aria-label="Impact category">{impactNames.map((name) => <option key={name} value={name}>{impactCategoryDisplayName(name)}</option>)}</select></div> : null}</div>
      {mode === "impact" && !selectedContributionGraph ? <p className="contribution-fallback-note">Recursive contributions were not requested for this category. Showing the available process-contribution results.</p> : null}
    </div>
    {mode !== null ? <div className="contribution-table-wrap"><table className="contribution-table"><thead><tr><th>Contribution rate</th><th>Process</th><th>{selectedContributionGraph ? "Supply amount" : "Required amount"}</th><th>{selectedContributionGraph ? "Cumulative result" : "Total result"}</th><th>Direct contribution</th></tr></thead><tbody>
      {selectedContributionGraph ? <>
        <tr className="contribution-root"><td>{graphRootPercentage === null ? "—" : formatPercent(graphRootPercentage)}</td><td>{graphCanExpand ? <button className={`tree-toggle ${expanded ? "is-expanded" : ""}`} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} upstream processes`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="process-mark">⌘</span>{graphRoot?.process_name || result.name}</td><td>{graphRoot ? <>{number(graphRoot.supply_amount)} <small>{graphRoot.unit}</small></> : "—"}</td><td><span className="result-bar"><i style={{ width: "100%" }} /></span>{number(graphRootCumulative)} <small>{selectedContributionGraph.unit}</small></td><td>{number(graphRootDirect)} <small>{selectedContributionGraph.unit}</small></td></tr>
        {expanded && graphRoot ? renderGraphChildren(graphRoot, 0) : null}
        {expanded && !graphRoot ? graphFallbackRoots.flatMap((node) => renderGraphNode(node, null, 0)) : null}
        {expanded && !graphCanExpand ? <tr className="empty-row"><td colSpan={5}>{selectedContributionGraph.status === "zero_total" ? "This impact category has a zero total, so contribution percentages are unavailable." : "No contribution graph nodes were returned for this category."}</td></tr> : null}
      </> : <>
        <tr className="contribution-root"><td>{formatPercent(100)}</td><td><button className={`tree-toggle ${expanded ? "is-expanded" : ""}`} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} downstream processes`}><ChevronDown size={14} /></button><span className="process-mark">⌘</span>{result.name}</td><td>{mode === "flow" ? formatNumber(1) : "—"}</td><td><span className="result-bar"><i style={{ width: "100%" }} /></span>{number(total)} <small>{unit}</small></td><td>—</td></tr>
        {expanded ? renderContributionRows(rootRows.length ? rootRows : rows) : null}
        {expanded && !rows.length ? <tr className="empty-row"><td colSpan={5}>{mode === "impact" ? "No process contribution rows were returned for this category." : "No process requirements are available."}</td></tr> : null}
      </>}
    </tbody></table></div> : null}
  </div>
}

function SankeyView({ result }: { result: LcaResult }) {
  const { decimalPlaces, formatNumber, formatPercent } = useDisplaySettings()
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
  const impactNames = [...Object.entries(result.lcia).filter(([, value]) => value.score !== 0).reduce((unique, [name]) => {
    const key = name
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
  const format = (value: number) => formatNumber(value)
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
        direct: `Direct (${ownPercentage === null || ownPercentage === undefined ? "—" : formatPercent(ownPercentage)}): ${format(own)} ${unit}`,
        upstream: `Upstream (${formatPercent(percentage(total))}): ${format(total)} ${unit}`,
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
  }, [mode, selectedFlow, selectedImpact, minContribution, maxProcesses, orientation, connectionStyle, decimalPlaces])

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
          : <select value={selectedImpact} onChange={(event) => setImpact(event.target.value)} aria-label="Sankey impact category">{impactNames.map((name) => <option key={name} value={name}>{impactCategoryDisplayName(name)}</option>)}</select>}
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
      <strong>{mode === "impact" ? impactCategoryDisplayName(selectedImpact) : inventoryFlowName(selectedFlow)}</strong>
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} onClick={onClick} variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="tooltip">{label}</TooltipContent>
    </Tooltip>
  )
}

function GraphEditor() {
  const { decimalPlaces, showAllDecimalPlaces, formatNumber, theme } = useDisplaySettings()
  const graphDecimalPlaces = showAllDecimalPlaces ? 20 : decimalPlaces
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ProcessNodeData>>(layoutNodes(initialNodes, initialEdges))
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [selected, setSelected] = useState<(NodeMeta & { id: string }) | null>(null)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"graph" | "yaml" | "inventory" | "impact" | "process" | "contribution" | "sankey" | "results">("graph")
  const [yamlDraft, setYamlDraft] = useState(jacketYaml)
  const [appliedYaml, setAppliedYaml] = useState(jacketYaml)
  const [appliedRevision, setAppliedRevision] = useState(0)
  const [selectedCaseStudy, setSelectedCaseStudy] = useState<CaseStudyId | "custom">("jacket")
  const [yamlError, setYamlError] = useState("")
  const [graphTitle, setGraphTitle] = useState(defaultGraph.name)
  const [resultsMarkdown, setResultsMarkdown] = useState("")
  const [resultsError, setResultsError] = useState("")
  const [isCalculating, setIsCalculating] = useState(false)
  const [lcaResult, setLcaResult] = useState<LcaResult | null>(null)
  const [calculatedRevision, setCalculatedRevision] = useState<number | null>(null)
  const [graphMode, setGraphMode] = useState<"scaled" | "structure">("structure")
  const [graphSettingsOpen, setGraphSettingsOpen] = useState(false)
  const [graphMaxProcesses, setGraphMaxProcesses] = useState(initialNodes.filter((node) => node.data.scope !== "background").length)
  const [graphOrientation, setGraphOrientation] = useState<"vertical" | "horizontal">("horizontal")
  const [graphConnectionStyle, setGraphConnectionStyle] = useState<"curved" | "straight" | "step">("curved")
  const foldDirectionRef = useRef<"upstream" | "downstream">("upstream")
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const appliedRevisionRef = useRef(appliedRevision)
  const activeCalculationRef = useRef<AbortController | null>(null)
  nodesRef.current = nodes
  edgesRef.current = edges
  appliedRevisionRef.current = appliedRevision
  const { fitView, zoomIn, zoomOut } = useReactFlow()
  const availableGraphProcessCount = (() => {
    try {
      return buildGraphFromYaml(appliedYaml, "structure").nodes.filter((node) => node.data.scope !== "background").length
    } catch {
      return Math.max(1, graphMaxProcesses)
    }
  })()

  useEffect(() => setGraphMaxProcesses(availableGraphProcessCount), [availableGraphProcessCount])
  useEffect(() => {
    if (lcaResult) setResultsMarkdown(lcaResultToMarkdown(lcaResult, decimalPlaces, showAllDecimalPlaces))
  }, [decimalPlaces, showAllDecimalPlaces, lcaResult])
  useEffect(() => {
    try {
      const currentResult = calculatedRevision === appliedRevision ? lcaResult : null
      const mode = graphMode === "scaled" && currentResult ? "scaled" : "structure"
      const refreshedEdges = buildGraphFromYaml(appliedYaml, mode, currentResult?.scaling_vector, graphDecimalPlaces).edges
      const labelsById = new Map(refreshedEdges.map((edge) => [edge.id, edge.label]))
      setEdges((current) => current.map((edge) => labelsById.has(edge.id) ? { ...edge, label: labelsById.get(edge.id) } : edge))
    } catch {
      // Keep the currently displayed graph intact if the applied source cannot be rebuilt.
    }
  }, [appliedRevision, appliedYaml, calculatedRevision, graphDecimalPlaces, graphMode, lcaResult, setEdges])

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
    setNodes((current) => layoutNodes(current, edges, { orientation: graphOrientation }))
    requestAnimationFrame(fit)
  }
  const applyGraphSettings = ({
    maximum = graphMaxProcesses,
    orientation = graphOrientation,
    connectionStyle = graphConnectionStyle,
  }: {
    maximum?: number
    orientation?: "vertical" | "horizontal"
    connectionStyle?: "curved" | "straight" | "step"
  }) => {
    try {
      const currentResult = calculatedRevision === appliedRevision ? lcaResult : null
      const mode = graphMode === "scaled" && currentResult ? "scaled" : "structure"
      const parsed = buildGraphFromYaml(appliedYaml, mode, currentResult?.scaling_vector, graphDecimalPlaces)
      const foreground = parsed.nodes.filter((node) => node.data.scope !== "background")
      const cappedMaximum = Math.min(foreground.length, Math.max(1, maximum))
      const visibleForeground = new Set(foreground.slice(Math.max(0, foreground.length - cappedMaximum)).map((node) => node.id))
      const backgroundIds = new Set(parsed.nodes.filter((node) => node.data.scope === "background").map((node) => node.id))
      const visibleBackground = new Set(parsed.edges.filter((edge) => visibleForeground.has(edge.target) && backgroundIds.has(edge.source)).map((edge) => edge.source))
      const nextNodes = parsed.nodes.filter((node) => visibleForeground.has(node.id) || visibleBackground.has(node.id))
      const visibleIds = new Set(nextNodes.map((node) => node.id))
      const nextEdges = parsed.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => ({
        ...edge,
        type: connectionStyle === "curved" ? "default" : connectionStyle === "straight" ? "straight" : "smoothstep",
      }))
      setNodes(layoutNodes(nextNodes, nextEdges, { orientation }))
      setEdges(nextEdges)
      requestAnimationFrame(fit)
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : "Could not apply graph settings.")
    }
  }

  const showGraphMode = (mode: "scaled" | "structure") => {
    try {
      const currentResult = calculatedRevision === appliedRevision ? lcaResult : null
      if (mode === "scaled" && !currentResult) return
      const parsed = buildGraphFromYaml(appliedYaml, mode, currentResult?.scaling_vector, graphDecimalPlaces)
      const previousById = new Map(nodesRef.current.map((node) => [node.id, node]))
      const laidOutNodes = layoutNodes(parsed.nodes, parsed.edges, { orientation: graphOrientation })
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
      const parsed = buildGraphFromYaml(yamlDraft, "structure", undefined, graphDecimalPlaces)
      activeCalculationRef.current?.abort()
      activeCalculationRef.current = null
      setIsCalculating(false)
      const nextRevision = appliedRevisionRef.current + 1
      appliedRevisionRef.current = nextRevision
      setAppliedYaml(yamlDraft)
      setAppliedRevision(nextRevision)
      foldDirectionRef.current = "upstream"
      setEdges(parsed.edges)
      setNodes(layoutNodes(parsed.nodes.map((node) => ({
        ...node,
        data: { ...node.data, canFold: parsed.edges.some((edge) => edge.target === node.id) },
      })), parsed.edges, { orientation: graphOrientation }))
      setGraphTitle(parsed.name)
      setGraphMode("structure")
      setSelected(null)
      setYamlError("")
      setResultsMarkdown("")
      setResultsError("")
      setLcaResult(null)
      setCalculatedRevision(null)
      setView("graph")
      requestAnimationFrame(() => fitView({ padding: 0.35, maxZoom: 0.75, duration: 350 }))
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : "Could not parse this YAML file.")
    }
  }

  const runCalculation = async () => {
    if (yamlDraft !== appliedYaml || isCalculating) return
    const source = appliedYaml
    const revision = appliedRevision
    const controller = new AbortController()
    activeCalculationRef.current = controller
    setIsCalculating(true)
    setResultsError("")
    try {
      const result = await calculateLca(source, controller.signal)
      if (controller.signal.aborted || appliedRevisionRef.current !== revision) return
      setLcaResult(result)
      setCalculatedRevision(revision)
      setResultsMarkdown(lcaResultToMarkdown(result, decimalPlaces, showAllDecimalPlaces))
    } catch (error) {
      if (controller.signal.aborted || appliedRevisionRef.current !== revision) return
      setResultsError(error instanceof Error ? error.message : "Could not calculate the current product graph.")
    } finally {
      if (activeCalculationRef.current === controller) {
        activeCalculationRef.current = null
        setIsCalculating(false)
      }
    }
  }

  const loadYamlFile = (file?: File) => {
    if (!file) return
    if (!/\.ya?ml$/i.test(file.name)) { setYamlError("Choose a .yaml or .yml file."); return }
    const reader = new FileReader()
    reader.onload = () => { setYamlDraft(String(reader.result ?? "")); setSelectedCaseStudy("custom"); setYamlError("") }
    reader.onerror = () => setYamlError("Could not read the selected file.")
    reader.readAsText(file)
  }

  const loadCaseStudy = (id: CaseStudyId) => {
    setSelectedCaseStudy(id)
    setYamlDraft(caseStudies[id].yaml)
    setYamlError("")
  }

  const connectionCount = edges.length
  const isDirty = yamlDraft !== appliedYaml
  const hasCurrentResults = Boolean(lcaResult && calculatedRevision === appliedRevision)
  const canCalculate = !isDirty && !isCalculating
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
              <button className={view === "yaml" ? "is-active" : ""} onClick={() => setView("yaml")}>FILE</button>
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
          zoomOnScroll={false}
          panOnScroll
          onInit={(instance) => requestAnimationFrame(() => instance.fitView({ padding: 0.35, maxZoom: 0.75 }))}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={theme === "dark" ? "#242831" : "#cbd5e1"} />
        </ReactFlow>
        {graphSettingsOpen ? <>
          <div className="graph-settings-backdrop" onClick={() => setGraphSettingsOpen(false)} aria-hidden="true" />
          <div className="graph-settings-picker">
            <div className="graph-settings-title"><div><Settings2 size={15} /><span>Graph settings</span></div><button type="button" onClick={() => setGraphSettingsOpen(false)} aria-label="Close graph settings"><X size={15} /></button></div>
            <div className="graph-settings-grid">
              <label><span>Max. number of processes</span><div className="sankey-stepper"><button type="button" aria-label="Decrease graph maximum processes" onClick={() => { const value = Math.max(1, graphMaxProcesses - 1); setGraphMaxProcesses(value); applyGraphSettings({ maximum: value }) }}>−</button><input type="number" min="1" max={availableGraphProcessCount} step="1" value={graphMaxProcesses} onChange={(event) => { const value = Math.min(availableGraphProcessCount, Math.max(1, Math.floor(Number(event.target.value)) || 1)); setGraphMaxProcesses(value); applyGraphSettings({ maximum: value }) }} /><button type="button" aria-label="Increase graph maximum processes" onClick={() => { const value = Math.min(availableGraphProcessCount, graphMaxProcesses + 1); setGraphMaxProcesses(value); applyGraphSettings({ maximum: value }) }}>+</button></div></label>
              <label><span>Orientation</span><select value={graphOrientation} onChange={(event) => { const value = event.target.value as "vertical" | "horizontal"; setGraphOrientation(value); applyGraphSettings({ orientation: value }) }}><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select></label>
              <label><span>Connections</span><select value={graphConnectionStyle} onChange={(event) => { const value = event.target.value as "curved" | "straight" | "step"; setGraphConnectionStyle(value); applyGraphSettings({ connectionStyle: value }) }}><option value="curved">Curved</option><option value="straight">Straight</option><option value="step">Step</option></select></label>
            </div>
          </div>
        </> : null}
        <div className="graph-toolbar" aria-label="Graph tools">
          <div className="toolbar-group">
            <ToolButton label="Graph settings" onClick={() => setGraphSettingsOpen((open) => !open)}><Settings2 size={18} /></ToolButton>
          </div>
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
          <Button disabled={!hasCurrentResults} title={!hasCurrentResults ? "Calculate LCA results to enable the scaled graph" : undefined} variant="ghost" className={`graph-action ${graphMode === "scaled" ? "is-active" : ""}`} aria-pressed={graphMode === "scaled"} onClick={() => showGraphMode("scaled")}><Scan size={16} />Scaled Graph</Button>
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
          <textarea value={yamlDraft} onChange={(event) => { setYamlDraft(event.target.value); setSelectedCaseStudy("custom"); setYamlError("") }} spellCheck={false} aria-label="Product graph YAML" />
          <div className="yaml-editor-foot">
            <span className={yamlError ? "yaml-error" : isDirty ? "yaml-dirty" : ""}>{yamlError || (isDirty ? "Unapplied changes. Preview changes before calculating." : "Files are parsed locally in your browser.")}</span>
            <Button onClick={previewYaml}>Preview graph</Button>
          </div>
        </div> : view === "inventory" ? <InventoryView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError} /> : view === "impact" ? <ImpactAnalysisView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError} /> : view === "process" && hasCurrentResults && lcaResult ? <ProcessResultsView result={lcaResult} yaml={appliedYaml} /> : view === "contribution" ? <ContributionView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError} /> : view === "sankey" && hasCurrentResults && lcaResult ? <SankeyView result={lcaResult} /> : <div className="results-panel">
          <div className="results-panel-head">
            <div><strong>LCA Results</strong><span>{isDirty ? "Preview changes before calculating. Existing results still match the visible graph." : "Calculated from the currently previewed product graph."}</span></div>
            <Button onClick={runCalculation} disabled={!canCalculate} title={isDirty ? "Preview changes before calculating." : undefined}>{isCalculating ? "Calculating…" : "Calculate LCA"}</Button>
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
          <div className="inspector-head"><span>NODE DETAILS</span><Button variant="ghost" size="icon" onClick={() => setSelected(null)} aria-label="Close property editor" title="Close property editor"><X size={16} /></Button></div>
          <div className="node-icon" style={{ background: selectedNode?.data.color ?? selected.color }}><Box size={22} /></div>
          <h2>{selectedNode?.data.label ?? selected.label}</h2><p>{selectedNode?.data.detail ?? selected.detail}</p>
          {selectedNode?.data.scope === "background" ? <>
            {selectedNode.data.backgroundLoading ? <div className="property-section"><p>Loading unit process…</p></div> : null}
            {selectedNode.data.backgroundError ? <div className="property-section"><p className="property-error">{selectedNode.data.backgroundError}</p></div> : null}
            <div className="property-section">
              <h3>Direct inputs</h3>
              {selectedNode.data.inputs?.length ? selectedNode.data.inputs.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span>{item.amount === undefined ? null : <strong>{formatNumber(item.amount)}{item.unit ? ` ${item.unit}` : ""}</strong>}</div>) : <p>No technosphere inputs</p>}
            </div>
            <div className="property-section">
              <h3>Reference output</h3>
              {selectedNode.data.outputs?.length ? selectedNode.data.outputs.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span>{item.amount === undefined ? null : <strong>{formatNumber(item.amount)}{item.unit ? ` ${item.unit}` : ""}</strong>}</div>) : <p>No production exchange</p>}
            </div>
            {selectedNode.data.biosphere?.length ? <div className="property-section is-emission">
              <h3>Biosphere exchanges</h3>
              {selectedNode.data.biosphere.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span>{item.amount === undefined ? null : <strong>{formatNumber(item.amount)}{item.unit ? ` ${item.unit}` : ""}</strong>}</div>)}
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
              {selectedNode.data.extractions.map((item) => <div className="property-row" key={item.label}><span>{item.label}</span>{selectedNode.data.showAmounts !== false ? <strong>{formatNumber(item.amount ?? 0)} {item.unit}</strong> : null}</div>)}
            </div> : null}
            {selectedNode?.data.emissions?.length ? <div className="property-section is-emission">
              <h3>Emissions to air</h3>
              {selectedNode.data.emissions.map((item) => <div className="property-row" key={item.label}><span>{item.label}</span>{selectedNode.data.showAmounts !== false ? <strong>{formatNumber(item.amount ?? 0)} {item.unit}</strong> : null}</div>)}
            </div> : null}
          </>}
        </>
      </aside> : null}
    </>
  )
}

function AppContent() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { decimalPlaces, setDecimalPlaces, showAllDecimalPlaces, setShowAllDecimalPlaces, theme, setTheme } = useDisplaySettings()

  return (
    <TooltipProvider delayDuration={250}>
      <main className={`app-shell theme-${theme}`}>
        <header className="topbar">
          <div className="brand"><div className="brand-mark"><Share2 size={16} /></div><span>PRISM Life Cycle Assessment</span></div>
          <div className="top-actions">
            <button className={`global-settings-trigger ${settingsOpen ? "is-active" : ""}`} type="button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-label="Global settings"><Settings2 size={16} /><span>Settings</span></button>
          </div>
          {settingsOpen ? <>
            <div className="global-settings-backdrop" onClick={() => setSettingsOpen(false)} aria-hidden="true" />
            <div className="global-settings-panel">
              <div className="global-settings-title"><div><Settings2 size={15} /><span>Global settings</span></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close global settings"><X size={15} /></button></div>
              <div className="global-setting-field">
                <span>Decimal places</span>
                <p>Applied to numerical results across the workspace.</p>
                <label className="all-decimals-toggle"><input type="checkbox" checked={showAllDecimalPlaces} onChange={(event) => setShowAllDecimalPlaces(event.target.checked)} /><span>Show all decimal places</span></label>
                <div className="sankey-stepper"><button type="button" disabled={showAllDecimalPlaces} onClick={() => setDecimalPlaces(decimalPlaces - 1)} aria-label="Decrease decimal places">−</button><input type="number" min="0" max="8" step="1" disabled={showAllDecimalPlaces} value={decimalPlaces} onChange={(event) => setDecimalPlaces(Number(event.target.value) || 0)} /><button type="button" disabled={showAllDecimalPlaces} onClick={() => setDecimalPlaces(decimalPlaces + 1)} aria-label="Increase decimal places">+</button></div>
              </div>
              <div className="global-setting-field">
                <span>Appearance</span>
                <p>Choose the workspace color theme.</p>
                <div className="theme-options">
                  <button type="button" className={theme === "dark" ? "is-active" : ""} onClick={() => setTheme("dark")}><Moon size={14} />Dark</button>
                  <button type="button" className={theme === "light" ? "is-active" : ""} onClick={() => setTheme("light")}><Sun size={14} />Light</button>
                </div>
              </div>
            </div>
          </> : null}
        </header>

        <section className="workspace">
          <ReactFlowProvider>
            <GraphEditor />
          </ReactFlowProvider>
        </section>
      </main>
    </TooltipProvider>
  )
}

export default function App() {
  return <DisplaySettingsProvider><AppContent /></DisplaySettingsProvider>
}
