import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import dagre from "@dagrejs/dagre"
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
  ChevronsDownUp, ChevronsUpDown, ClipboardPaste, FileUp, Minus, Moon, MousePointer2, Plus, Search, Settings2, Share2, Sun, X,
} from "lucide-react"
import { parse } from "yaml"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { NumberStepper } from "@/components/NumberStepper"
import { ProcessNode, type ProcessNodeData } from "./components/ProcessNode"
import { layoutNodes } from "./lib/layout"
import { chemicalFlowLabel } from "./lib/flowLabels"
import { buildGraphFromYaml, buildInventoryRequirements, nodeScopeColors } from "./lib/yamlGraph"
import {
  calculateContributionGraphs, calculateLca, getBackgroundActivityDetails, getProductGraphCatalog, impactCategoryAbbreviation, impactCategoryDisplayName, lcaResultToMarkdown,
  type ContributionGraph, type ContributionGraphEdge, type ContributionGraphFlow, type ContributionGraphNode, type LcaResult, type ProductGraphCatalogEntry,
} from "./lib/lcaApi"
import { unitsAreCompatible } from "./lib/units"
import { DisplaySettingsProvider, useDisplaySettings } from "./lib/displaySettings"

type NodeMeta = { label: string; kind: string; detail: string; color: string; scope?: "foreground" | "background" }
type View = "graph" | "yaml" | "inventory" | "impact" | "process" | "contribution" | "sankey" | "results"
type AnalysisView = Extract<View, "inventory" | "impact" | "process" | "contribution" | "sankey">
const analysisViews: AnalysisView[] = ["inventory", "impact", "process", "contribution", "sankey"]
const isAnalysisView = (view: View): view is AnalysisView => analysisViews.includes(view as AnalysisView)
const WEBAPP_DEFAULT_PRODUCT_GRAPH_ID = import.meta.env.VITE_DEFAULT_PRODUCT_GRAPH_ID ?? "cotton_fiber"

const initialEdges: Edge[] = []
const initialNodes: Node<ProcessNodeData>[] = []

const nodeTypes = { process: ProcessNode }
type SankeyProcessNodeData = {
  label: string
  direct: string
  upstream: string
  orientation: "vertical" | "horizontal"
  scope: "foreground" | "background"
  pathHighlighted?: boolean
  pathDimmed?: boolean
}
function SankeyProcessNode({ data }: NodeProps<Node<SankeyProcessNodeData>>) {
  return <div className={`pg-node is-expanded sankey-process-node${data.pathHighlighted ? " is-path-highlighted" : ""}${data.pathDimmed ? " is-path-dimmed" : ""}`} style={{ "--node-color": nodeScopeColors[data.scope] } as React.CSSProperties}>
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
const productGraphLabel = (name: string) => name.replace(/\s+—\s+1\s+.*$/, "")

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
  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(() => new Set())
  const [collapsedRequirements, setCollapsedRequirements] = useState<Set<string>>(() => new Set())
  const [flowColumnWidths, setFlowColumnWidths] = useState([360, 280, 140, 100])
  const [requirementColumnWidths, setRequirementColumnWidths] = useState([360, 280, 140, 100])
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
  const toggleFlow = (key: string) => setExpandedFlows((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const toggleRequirement = (id: string) => setCollapsedRequirements((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const normalizedInventoryName = (name: string) => normalizedFlow(name.split("|")[0])
  const flowChildren = (flowName: string) => {
    const candidates = result.contribution_graphs.map((graph) => {
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
      const rows = graph.flows.filter((flow) => normalizedInventoryName(flow.flow_name) === normalizedInventoryName(flowName))
        .map((flow) => ({ flow, process: nodes.get(flow.process_occurrence_id) }))
        .filter((row): row is { flow: (typeof graph.flows)[number]; process: NonNullable<typeof row.process> } => Boolean(row.process))
      return rows
    })
    return candidates.sort((left, right) => right.length - left.length)[0] ?? []
  }
  const FlowTable = ({ rows, empty }: { rows: typeof flows; empty: string }) => <div className="inventory-table-wrap"><table className="inventory-table" style={{ width: Math.max(880, flowColumnWidths.reduce((sum, width) => sum + width, 0)) }}>
    <ResizableTableHeader labels={["Name", "Category", "Amount", "Unit"]} widths={flowColumnWidths} onWidthsChange={setFlowColumnWidths} />
    <tbody>{rows.length ? rows.flatMap((flow) => {
      const key = `${flow.type}-${flow.name}`
      const children = flowChildren(flow.name)
      const open = expandedFlows.has(key)
      const parent = <tr className={children.length ? "inventory-tree-parent" : ""} key={key} onClick={children.length ? () => toggleFlow(key) : undefined}>
        <td>{children.length ? <button className={`tree-toggle ${open ? "is-expanded" : ""}`} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} processes for ${flow.name}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className={isInventoryInput(flow.type) ? "flow-dot input" : "flow-dot output"} />{inventoryFlowName(flow.name)}</td>
        <td>{flow.type}</td><td className="number">{formatNumber(flow.amount)}</td><td>{flow.unit}</td>
      </tr>
      const childRows = open ? children.map(({ flow: childFlow, process }) => <tr className="inventory-flow-child" key={`${key}:${childFlow.id}`}>
        <td><span className="inventory-tree-indent" /><span className="process-mark">⌘</span>{process.process_name}</td>
        <td>{childFlow.categories.join("/") || `${process.scope ?? "process"}`}</td><td className="number">{formatNumber(childFlow.amount)}</td><td>{childFlow.unit}</td>
      </tr>) : []
      return [parent, ...childRows]
    }) : <tr className="empty-row"><td colSpan={4}>{empty}</td></tr>}</tbody>
  </table></div>

  const requirementGraph = [...result.contribution_graphs].sort((left, right) => right.nodes.length - left.nodes.length)[0]
  const requirementNodes = new Map(requirementGraph?.nodes.map((node) => [node.id, node]) ?? [])
  const requirementChildren = new Map<string, string[]>()
  const requirementEdgeByProducer = new Map<string, NonNullable<typeof requirementGraph>["edges"][number]>()
  requirementGraph?.edges.forEach((edge) => {
    requirementChildren.set(edge.consumer_id, [...(requirementChildren.get(edge.consumer_id) ?? []), edge.producer_id])
    requirementEdgeByProducer.set(edge.producer_id, edge)
  })
  const requirementRoot = requirementGraph?.nodes.find((node) => node.kind === "functional_unit")
  let fallbackRequirements: ReturnType<typeof buildInventoryRequirements> = []
  try { fallbackRequirements = buildInventoryRequirements(yaml, result.scaling_vector) } catch { fallbackRequirements = [] }
  const renderRequirementRows = (ids: string[], depth: number): React.ReactNode[] => ids.flatMap((id) => {
    const node = requirementNodes.get(id)
    if (!node) return []
    const children = requirementChildren.get(id) ?? []
    const open = !collapsedRequirements.has(id)
    const edge = requirementEdgeByProducer.get(id)
    const row = <tr key={id} className={children.length ? "inventory-tree-parent" : ""} onClick={children.length ? () => toggleRequirement(id) : undefined}>
      <td style={{ paddingLeft: `${6 + depth * 20}px` }}>{children.length ? <button className={`tree-toggle ${open ? "is-expanded" : ""}`} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} children of ${node.process_name}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="process-mark">⌘</span>{node.process_name}<small className={`inventory-scope is-${node.scope ?? "functional"}`}>{node.scope ?? "functional unit"}</small></td>
      <td><span className="product-mark">⚙</span>{edge?.flow_name ?? result.name}</td><td className="number">{formatNumber(node.supply_amount)}</td><td>{node.unit}</td>
    </tr>
    return open ? [row, ...renderRequirementRows(children, depth + 1)] : [row]
  })

  return <div className="inventory-view">
    <div className="inventory-title"><div><strong>{result.name}</strong><span>{result.functional_unit}</span></div></div>
    <details open><summary>Inputs <span>{inputs.length}</span></summary><FlowTable rows={inputs} empty="No environmental input flows were returned." /></details>
    <details open><summary>Outputs <span>{outputs.length}</span></summary><FlowTable rows={outputs} empty="No environmental output flows were returned." /></details>
    <details open className="requirements"><summary>Total requirements <span>{requirementGraph?.nodes.filter((node) => node.kind === "process").length ?? fallbackRequirements.length}</span></summary>
      <div className="inventory-table-wrap"><table className="inventory-table" style={{ width: Math.max(880, requirementColumnWidths.reduce((sum, width) => sum + width, 0)) }}><ResizableTableHeader labels={["Process", "Product", "Amount", "Unit"]} widths={requirementColumnWidths} onWidthsChange={setRequirementColumnWidths} /><tbody>
        {requirementRoot ? renderRequirementRows([requirementRoot.id], 0) : fallbackRequirements.map((row) => <tr key={row.process}><td><span className="process-mark">⌘</span>{row.process}</td><td><span className="product-mark">⚙</span>{row.product}</td><td className="number">{formatNumber(row.amount)}</td><td>{row.unit}</td></tr>)}
      </tbody></table></div>
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

function ImpactAnalysisView({ result, yaml, isCurrent, error, loadContributionGraphs }: {
  result: LcaResult | null
  yaml: string
  isCurrent: boolean
  error: string
  loadContributionGraphs: (categories: string[]) => Promise<ContributionGraph[]>
}) {
  const { formatNumber } = useDisplaySettings()
  const [subgroup, setSubgroup] = useState<"processes" | "flows">("processes")
  const [threshold, setThreshold] = useState(1)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set())
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(() => new Set())
  const [collapsedFlows, setCollapsedFlows] = useState<Set<string>>(() => new Set())
  const [loadingCategories, setLoadingCategories] = useState<Set<string>>(() => new Set())
  const [categoryErrors, setCategoryErrors] = useState<Map<string, string>>(() => new Map())
  const [columnWidths, setColumnWidths] = useState([300, 240, 160, 180, 220])
  useEffect(() => {
    setLoadingCategories(new Set())
    setCategoryErrors(new Map())
    setExpandedCategories(new Set())
    setExpandedProcesses(new Set())
  }, [result?.result_id])

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
  const contributionGraphFor = (label: string) => result.contribution_graphs.find((graph) => graph.label === label)
  const toggleCategory = (id: string) => setExpandedCategories((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const loadCategory = async (id: string, label: string) => {
    if (contributionGraphFor(label) || loadingCategories.has(id)) return
    setLoadingCategories((current) => new Set(current).add(id))
    setCategoryErrors((current) => { const next = new Map(current); next.delete(id); return next })
    try {
      const graphs = await loadContributionGraphs([label])
      const graph = graphs.find((candidate) => candidate.label === label)
      if (!graph) throw new Error("The calculation engine returned no child contribution graph for this category.")
    } catch (caught) {
      setCategoryErrors((current) => new Map(current).set(id, caught instanceof Error ? caught.message : "Could not calculate this category breakdown."))
    } finally {
      setLoadingCategories((current) => { const next = new Set(current); next.delete(id); return next })
    }
  }
  const openCategory = async (id: string, label: string) => {
    if (expandedCategories.has(id)) { toggleCategory(id); return }
    toggleCategory(id)
    await loadCategory(id, label)
  }
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
    const contributionGraph = contributionGraphFor(categoryLabel)
    if (contributionGraph) {
      const occurrenceIds = new Set(contributionGraph.nodes
        .filter((node) => node.kind === "process" && (
          node.activity_id === processId
          || cleanImpactProcessName(node.process_name).toLowerCase() === cleanImpactProcessName(processName).toLowerCase()
        ))
        .map((node) => node.id))
      const grouped = contributionGraph.flows
        .filter((flow) => occurrenceIds.has(flow.process_occurrence_id))
        .reduce((rows, flow) => {
          const key = `${flow.kind}:${normalizedFlow(flow.flow_name)}:${flow.unit}`
          const existing = rows.get(key) ?? {
            name: flow.flow_name,
            category: `elementary flows/${flow.categories.join("/") || (flow.kind === "emission" ? "air" : "resource")}`,
            amount: 0,
            impact: 0,
            unit: flow.unit,
          }
          existing.amount += flow.amount
          existing.impact += flow.score
          rows.set(key, existing)
          return rows
        }, new Map<string, { name: string; category: string; amount: number; impact: number; unit: string }>())
      return [...grouped.values()].map((flow) => ({
        ...flow,
        factor: flow.amount ? flow.impact / flow.amount : 0,
      })).sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
    }
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
      <RadioGroup className="impact-subgroup" value={subgroup} onValueChange={(value) => setSubgroup(value as "processes" | "flows")} aria-label="Sub-group impact results">
        <label><RadioGroupItem className="app-radio" value="processes" /> Processes</label>
        <label><RadioGroupItem className="app-radio" value="flows" /> Flows</label>
      </RadioGroup>
      <i />
      <label className="impact-threshold">Don’t show &lt; <Input type="number" min="0" max="100" step="0.1" value={threshold} onChange={(event) => setThreshold(Math.max(0, Number(event.target.value)))} /> %</label>
    </div>
    <div className="impact-table-wrap"><table className="impact-table" style={{ width: Math.max(1100, columnWidths.reduce((sum, width) => sum + width, 0)) }}>
      <ResizableTableHeader labels={["Name", "Category", "Inventory result", "Characterization factor", "Impact assessment result"]} widths={columnWidths} onWidthsChange={setColumnWidths} />
      <tbody>{[...categories.values()].map((category) => {
        const categoryId = category.id || category.label
        const isOpen = expandedCategories.has(categoryId)
        const processes = category.processes
          .filter((process) => Math.abs(process.percentage ?? (category.total_score ? process.direct_score / category.total_score * 100 : 0)) >= threshold)
          .sort((left, right) => Math.abs(right.direct_score) - Math.abs(left.direct_score))
        return <Fragment key={categoryId}>
          <tr className="impact-category-row" onClick={() => void openCategory(categoryId, category.label)}>
            <td><div className="impact-category-name"><button className={`tree-toggle ${isOpen ? "is-expanded" : ""}`} onClick={(event) => { event.stopPropagation(); void openCategory(categoryId, category.label) }} aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${category.label}`}><ChevronDown size={14} /></button><BarChart3 className="impact-category-icon" size={17} /><strong>{impactCategoryDisplayName(category.label)}</strong></div></td>
            <td /><td /><td /><td><span className="impact-result">{formatNumber(category.total_score)} <small>{category.unit}</small></span></td>
          </tr>
          {isOpen && loadingCategories.has(categoryId) ? <tr className="impact-breakdown-status"><td colSpan={5}>Calculating process and elementary-flow children…</td></tr> : null}
          {isOpen && categoryErrors.has(categoryId) ? <tr className="impact-breakdown-status is-error"><td colSpan={5}>{categoryErrors.get(categoryId)}</td></tr> : null}
          {isOpen && subgroup === "processes" ? processes.flatMap((process) => {
            const processKey = `${categoryId}:${process.process_id}`
            const flows = processFlows(process.process_name, process.process_id, category.label)
            const processOpen = expandedProcesses.has(processKey)
            const displayName = cleanImpactProcessName(process.process_name)
            const processRow = <tr className="impact-process-row" key={processKey} onClick={() => flows.length && toggleProcess(processKey)}>
              <td><span className="impact-indent" />{flows.length ? <button className={`tree-toggle ${processOpen ? "is-expanded" : ""}`} onClick={(event) => { event.stopPropagation(); toggleProcess(processKey) }} aria-expanded={processOpen} aria-label={`${processOpen ? "Collapse" : "Expand"} ${displayName}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="impact-process-icon"><Factory size={14} /></span>{displayName}</td>
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
                <td><span className="impact-indent" /><button className={`tree-toggle ${flowOpen ? "is-expanded" : ""}`} onClick={(event) => { event.stopPropagation(); toggleFlow(flowId) }} aria-expanded={flowOpen} aria-label={`${flowOpen ? "Collapse" : "Expand"} ${flow.name}`}><ChevronDown size={14} /></button><span className="impact-flow-icon"><Leaf size={14} /></span>{inventoryFlowName(flow.name)}</td>
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
  const [flowProcessId, setFlowProcessId] = useState("")
  const [impactProcessId, setImpactProcessId] = useState("")
  const [threshold, setThreshold] = useState(0.01)
  const [flowColumnWidths, setFlowColumnWidths] = useState([140, 220, 230, 180, 140, 90])
  const [impactColumnWidths, setImpactColumnWidths] = useState([170, 300, 190, 150, 120])
  const referenceProcessId = result.sankey.links.find((link) => link.kind === "final_product")?.source
  const defaultProcessId = processNodes.some((node) => node.id === referenceProcessId) ? referenceProcessId! : (processNodes.at(-1)?.id ?? "")
  const selectedFlowProcessId = processNodes.some((node) => node.id === flowProcessId) ? flowProcessId : defaultProcessId
  const selectedImpactProcessId = processNodes.some((node) => node.id === impactProcessId) ? impactProcessId : defaultProcessId
  const selectedImpactNode = processNodes.find((node) => node.id === selectedImpactProcessId)
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
  const flowIncludedIds = upstreamIds(selectedFlowProcessId)
  const impactIncludedIds = upstreamIds(selectedImpactProcessId)
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
  processNodes.filter((node) => flowIncludedIds.has(node.id)).forEach((node) => {
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
      if (node.id === selectedFlowProcessId) existing.direct += amount
      flowRows.set(key, existing)
    })
  })

  // Linked background processes are absent from the foreground YAML. Their
  // per-process inventory is carried by the contribution graph occurrences.
  // The same physical exchange can appear in several impact-category graphs,
  // so retain the largest matching amount instead of counting it repeatedly.
  type CalculatedFlow = { name: string; category: string; unit: string; upstream: number; direct: number; input: boolean }
  const calculatedFlows = new Map<string, CalculatedFlow>()
  result.contribution_graphs.forEach((graph) => {
    const selectedOccurrences = new Set(graph.nodes
      .filter((node) => node.kind === "process" && node.activity_id === selectedFlowProcessId)
      .map((node) => node.id))
    if (!selectedOccurrences.size) return

    const children = new Map<string, string[]>()
    graph.edges.forEach((edge) => children.set(edge.consumer_id, [...(children.get(edge.consumer_id) ?? []), edge.producer_id]))
    const upstreamOccurrences = new Set<string>()
    const includeUpstream = (id: string) => {
      if (upstreamOccurrences.has(id)) return
      upstreamOccurrences.add(id)
      ;(children.get(id) ?? []).forEach(includeUpstream)
    }
    selectedOccurrences.forEach(includeUpstream)

    const graphFlows = new Map<string, CalculatedFlow>()
    graph.flows.forEach((flow) => {
      if (!upstreamOccurrences.has(flow.process_occurrence_id)) return
      const input = flow.kind === "extraction"
      const category = `elementary flows/${flow.categories.join("/") || (input ? "resource" : "air")}`
      const key = `${input}:${normalizedFlow(flow.flow_name)}`
      const existing = graphFlows.get(key) ?? {
        name: flow.flow_name,
        category,
        unit: flow.unit,
        upstream: 0,
        direct: 0,
        input,
      }
      existing.upstream += flow.amount
      if (selectedOccurrences.has(flow.process_occurrence_id)) existing.direct += flow.amount
      graphFlows.set(key, existing)
    })
    graphFlows.forEach((flow, key) => {
      const existing = calculatedFlows.get(key)
      if (!existing) {
        calculatedFlows.set(key, flow)
        return
      }
      if (Math.abs(flow.upstream) > Math.abs(existing.upstream)) existing.upstream = flow.upstream
      if (Math.abs(flow.direct) > Math.abs(existing.direct)) existing.direct = flow.direct
    })
  })
  calculatedFlows.forEach((flow) => {
    const yamlKey = `${flow.input}:${normalizedFlow(flow.name)}`
    const existing = flowRows.get(yamlKey)
    if (existing) {
      existing.upstream = flow.upstream
      existing.direct = flow.direct
    } else {
      flowRows.set(yamlKey, flow)
    }
  })

  // For the reference process, the complete calculated LCI is authoritative;
  // contribution graphs intentionally omit flows below their cutoffs.
  if (flowIncludedIds.size === processIds.size) {
    Object.entries(result.lci).forEach(([name, value]) => {
      const input = isInventoryInput(value.type)
      const baseName = name.split(/[|,]/)[0].trim()
      const key = `${input}:${normalizedFlow(baseName)}`
      const existing = flowRows.get(key)
      flowRows.set(key, {
        name,
        category: input ? "elementary flows/resource" : "elementary flows/air",
        unit: value.unit,
        upstream: value.amount,
        direct: existing?.direct ?? 0,
        input,
      })
    })
  }
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
    return <table className="process-flow-table" style={{ width: Math.max(1000, flowColumnWidths.reduce((sum, width) => sum + width, 0)) }}><ResizableTableHeader labels={["Contribution", "Flow", "Category", "Upstream incl. direct", "Direct", "Unit"]} widths={flowColumnWidths} onWidthsChange={setFlowColumnWidths} />
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
    const graph = result.contribution_graphs.find((candidate) => candidate.label === category.label)
    const exactOccurrences = graph?.nodes.filter((node) => (
      node.kind === "process" && node.activity_id === selectedImpactProcessId
    )) ?? []
    const upstream = exactOccurrences.length
      ? exactOccurrences.reduce((sum, node) => sum + node.cumulative_score, 0)
      : processNodes.filter((node) => impactIncludedIds.has(node.id)).reduce((sum, node) => sum + (scoreFor(node)?.direct_score ?? 0), 0)
    const direct = selectedImpactNode ? scoreFor(selectedImpactNode)?.direct_score ?? 0 : 0
    return { category, upstream, direct, contribution: category.total_score ? upstream / category.total_score * 100 : 0 }
  }).filter((row) => Math.abs(row.contribution) >= threshold && row.upstream !== 0)

  return <div className="process-results-view">
    <details open><summary>Flow contributions to process results</summary>
      <div className="process-results-controls"><label>Process <AppSelect value={selectedFlowProcessId} onValueChange={setFlowProcessId} label="Flow contribution process" options={processNodes.map((node) => ({ value: node.id, label: cleanImpactProcessName(node.process_name ?? node.label) }))} /></label><label>Don’t show &lt; <Input type="number" min="0" max="100" step="0.01" value={threshold} onChange={(event) => setThreshold(Math.max(0, Number(event.target.value)))} /> %</label></div>
      <div className="process-flow-grids"><section><h3>Inputs</h3><FlowResultsTable input /></section><section><h3>Outputs</h3><FlowResultsTable input={false} /></section></div>
    </details>
    <details open><summary>Impact assessment results</summary>
      <div className="process-results-controls"><label>Process <AppSelect value={selectedImpactProcessId} onValueChange={setImpactProcessId} label="Impact assessment process" options={processNodes.map((node) => ({ value: node.id, label: cleanImpactProcessName(node.process_name ?? node.label) }))} /></label><label>Don’t show &lt; <Input type="number" min="0" max="100" step="0.01" value={threshold} onChange={(event) => setThreshold(Math.max(0, Number(event.target.value)))} /> %</label></div>
      <div className="process-impact-table-wrap"><table className="process-impact-table" style={{ width: Math.max(930, impactColumnWidths.reduce((sum, width) => sum + width, 0)) }}><ResizableTableHeader labels={["Contribution", "Impact category", "Upstream incl. direct", "Direct", "Unit"]} widths={impactColumnWidths} onWidthsChange={setImpactColumnWidths} /><tbody>{impactRows.map((row) => <tr key={row.category.id || row.category.label}><td><span className="process-result-bar"><i style={{ width: `${Math.min(100, Math.abs(row.contribution))}%` }} /></span>{formatPercent(row.contribution)}</td><td>{impactCategoryDisplayName(row.category.label)}</td><td>{formatNumber(row.upstream)}</td><td>{formatNumber(row.direct)}</td><td>{row.category.unit}</td></tr>)}</tbody></table></div>
    </details>
  </div>
}

function ColumnResizeHandle({ label, width, onResize }: {
  label: string
  width: number
  onResize: (width: number) => void
}) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const resize = (nextWidth: number) => onResize(Math.max(80, Math.round(nextWidth)))

  return <span
    className="column-resize-handle"
    role="separator"
    aria-label={`Resize ${label} column`}
    aria-orientation="vertical"
    aria-valuemin={80}
    aria-valuenow={width}
    tabIndex={0}
    onPointerDown={(event) => {
      event.preventDefault()
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return
      resize(drag.current.startWidth + event.clientX - drag.current.startX)
    }}
    onPointerUp={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={() => { drag.current = null }}
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      event.preventDefault()
      const step = event.shiftKey ? 40 : 10
      resize(width + (event.key === "ArrowRight" ? step : -step))
    }}
  />
}

function ResizableTableHeader({ labels, widths, onWidthsChange }: {
  labels: string[]
  widths: number[]
  onWidthsChange: (widths: number[]) => void
}) {
  const resizeColumn = (index: number, width: number) => onWidthsChange(widths.map((value, candidate) => candidate === index ? width : value))
  return <>
    <colgroup>{widths.map((width, index) => <col key={`${index}:${labels[index]}`} style={{ width }} />)}</colgroup>
    <thead><tr>{labels.map((label, index) => <th key={`${index}:${label}`}>{label}<ColumnResizeHandle label={label} width={widths[index]} onResize={(width) => resizeColumn(index, width)} /></th>)}</tr></thead>
  </>
}

function ContributionView({ result, yaml, isCurrent, error, loadContributionGraphs }: {
  result: LcaResult | null
  yaml: string
  isCurrent: boolean
  error: string
  loadContributionGraphs: (categories: string[]) => Promise<ContributionGraph[]>
}) {
  const { formatNumber, formatPercent } = useDisplaySettings()
  const [mode, setMode] = useState<"flow" | "impact" | null>("impact")
  const [flow, setFlow] = useState("")
  const [impact, setImpact] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(() => new Set())
  const [columnWidths, setColumnWidths] = useState([140, 320, 180, 220, 180])

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
      <RadioGroup className="contribution-mode-group" value={mode ?? undefined} onValueChange={(value) => {
        const nextMode = value as "flow" | "impact"
        setMode(nextMode)
        if (nextMode === "impact") void loadContributionGraphs([selectedImpact])
      }} aria-label="Contribution result type">
        <label className={mode === "flow" ? "active" : ""}><RadioGroupItem className="app-radio" value="flow" />Flow</label>
        <div className="contribution-control-slot">{mode === null || mode === "flow" ? <div className="contribution-select is-flow"><span className="flow-dot output" /><AppSelect value={selectedFlow} onValueChange={(value) => { setFlow(value); setMode("flow") }} label="Flow category" options={flowNames.map((value) => ({ value, label: contributionFlowLabel(value) }))} /></div> : null}</div>
        <label className={mode === "impact" ? "active" : ""}><RadioGroupItem className="app-radio" value="impact" />Impact category</label>
        <div className="contribution-control-slot">{mode === null || mode === "impact" ? <div className="contribution-select is-impact"><BarChart3 size={16} /><AppSelect value={selectedImpact} onValueChange={(value) => { setImpact(value); setMode("impact"); void loadContributionGraphs([value]) }} label="Impact category" options={impactNames.map((value) => ({ value, label: impactCategoryDisplayName(value) }))} /></div> : null}</div>
        {mode === "impact" && !selectedContributionGraph ? <p className="contribution-fallback-note">Recursive contributions were not requested for this category. Showing the available process-contribution results.</p> : null}
      </RadioGroup>
    </div>
    {mode !== null ? <div className="contribution-table-wrap"><table className="contribution-table" style={{ width: Math.max(1040, columnWidths.reduce((sum, width) => sum + width, 0)) }}><ResizableTableHeader labels={[
      "Contribution rate",
      "Process",
      selectedContributionGraph ? "Supply amount" : "Required amount",
      selectedContributionGraph ? "Cumulative result" : "Total result",
      "Direct contribution",
    ]} widths={columnWidths} onWidthsChange={setColumnWidths} /><tbody>
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

function SankeyView({ result, loadContributionGraphs }: {
  result: LcaResult
  loadContributionGraphs: (categories: string[]) => Promise<ContributionGraph[]>
}) {
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
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null)
  const instanceRef = useRef<ReactFlowInstance<Node<SankeyProcessNodeData>, Edge> | null>(null)
  const [renderedNodes, setRenderedNodes, onSankeyNodesChange] = useNodesState<Node<SankeyProcessNodeData>>([])
  const [renderedEdges, setRenderedEdges, onSankeyEdgesChange] = useEdgesState<Edge>([])
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
  const selectedContributionGraph = result.contribution_graphs.find((graph) => graph.label === selectedImpact)
  const impactGraphPending = mode === "impact" && !selectedContributionGraph
  const processNodes = mode === "impact" && selectedContributionGraph
    ? selectedContributionGraph.nodes.map((node) => ({
        id: node.id,
        label: node.process_name,
        process_name: node.process_name,
        scope: node.scope ?? "foreground" as const,
        kind: node.kind,
      }))
    : result.sankey.nodes.filter((node) => node.kind === "process").map((node) => ({ ...node, kind: node.kind }))
  useEffect(() => setMaxProcesses(processNodes.length), [mode, processNodes.length, selectedContributionGraph?.id, selectedFlow, selectedImpact])
  const processIds = new Set(processNodes.map((node) => node.id))
  const links = mode === "impact" && selectedContributionGraph
    ? selectedContributionGraph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      }))
    : result.sankey.links.filter((link) => processIds.has(link.source) && processIds.has(link.target))
  const incoming = new Map<string, typeof links>()
  const outgoing = new Map<string, typeof links>()
  links.forEach((link) => {
    incoming.set(link.target, [...(incoming.get(link.target) ?? []), link])
    outgoing.set(link.source, [...(outgoing.get(link.source) ?? []), link])
  })
  const normalize = (value: string) => value.replace(/^(?:p?\d+)\s*[:.\-–—]\s*/i, "").trim().toLowerCase()
  const direct = new Map<string, number>()
  const directPercentage = new Map<string, number | null>()
  if (mode === "impact" && selectedContributionGraph) {
    selectedContributionGraph.nodes.forEach((node) => {
      direct.set(node.id, node.direct_score)
      directPercentage.set(node.id, selectedContributionGraph.total_score
        ? node.direct_score / selectedContributionGraph.total_score * 100
        : null)
    })
  } else if (mode === "impact") {
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
    const exact = selectedContributionGraph?.nodes.find((node) => node.id === nodeId)
    if (mode === "impact" && exact) return exact.cumulative_score
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
  const visibleNodes = [...eligibleNodes]
    .sort((left, right) => depth(left.id) - depth(right.id))
    .slice(0, Math.max(1, maxProcesses))
  const visibleIds = new Set(visibleNodes.map((node) => node.id))
  const visibleLinks = links.filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target))
  const nodeWidth = 300
  const nodeHeight = 112
  const layoutGraph = new dagre.graphlib.Graph()
  layoutGraph.setDefaultEdgeLabel(() => ({}))
  layoutGraph.setGraph({
    rankdir: orientation === "vertical" ? "TB" : "LR",
    nodesep: 180,
    ranksep: 260,
    marginx: 80,
    marginy: 80,
    ranker: "network-simplex",
    acyclicer: "greedy",
  })
  visibleNodes.forEach((node) => layoutGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight }))
  const adjacency = new Map<string, string[]>()
  visibleLinks.forEach((link) => {
    adjacency.set(link.source, [...(adjacency.get(link.source) ?? []), link.target])
    adjacency.set(link.target, [...(adjacency.get(link.target) ?? []), link.source])
  })
  const productRoot = selectedContributionGraph
    ? visibleNodes.find((node) => node.kind === "functional_unit")
    : visibleNodes.find((node) => !(outgoing.get(node.id)?.length))
  const laidOut = new Set<string>()
  const queue = productRoot ? [productRoot.id] : []
  if (productRoot) laidOut.add(productRoot.id)
  while (queue.length) {
    const parent = queue.shift()!
    ;(adjacency.get(parent) ?? []).forEach((child) => {
      if (laidOut.has(child)) return
      laidOut.add(child)
      queue.push(child)
      layoutGraph.setEdge(parent, child, { weight: 2 })
    })
  }
  visibleLinks.forEach((link) => {
    if (!laidOut.has(link.source) || !laidOut.has(link.target)) layoutGraph.setEdge(link.source, link.target, { weight: 1 })
  })
  dagre.layout(layoutGraph)
  const positions = new Map<string, { x: number; y: number }>()
  visibleNodes.forEach((node) => {
    const position = layoutGraph.node(node.id)
    positions.set(node.id, { x: position.x - nodeWidth / 2, y: position.y - nodeHeight / 2 })
  })
  if (orientation === "vertical" && productRoot && positions.size) {
    const horizontalExtents = [...positions.values()].flatMap((position) => [position.x, position.x + nodeWidth])
    const graphMidpoint = (Math.min(...horizontalExtents) + Math.max(...horizontalExtents)) / 2
    const rootPosition = positions.get(productRoot.id)
    if (rootPosition) {
      const centeredX = graphMidpoint - nodeWidth / 2
      positions.set(productRoot.id, { ...rootPosition, x: centeredX })
      const immediateChildren = adjacency.get(productRoot.id) ?? []
      if (immediateChildren.length === 1) {
        const childPosition = positions.get(immediateChildren[0])
        if (childPosition) positions.set(immediateChildren[0], {
          ...childPosition,
          x: centeredX,
          y: rootPosition.y + nodeHeight + 110,
        })
      }
    }
  }
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
  const downstreamSelection = (edges: Edge[], nodeId: string | null) => {
    const edgeIds = new Set<string>()
    const nodeIds = new Set<string>(nodeId ? [nodeId] : [])
    if (!nodeId) return { edgeIds, nodeIds }
    const visitedNodeIds = new Set([nodeId])
    const queue = [nodeId]
    while (queue.length) {
      const current = queue.shift()!
      edges.filter((edge) => edge.source === current).forEach((edge) => {
        edgeIds.add(edge.id)
        nodeIds.add(edge.target)
        if (visitedNodeIds.has(edge.target)) return
        visitedNodeIds.add(edge.target)
        queue.push(edge.target)
      })
    }
    return { edgeIds, nodeIds }
  }
  const highlightConnectedEdges = (edges: Edge[], nodeId: string | null) => {
    if (!nodeId) return edges
    const { edgeIds } = downstreamSelection(edges, nodeId)
    return edges.map((edge) => edgeIds.has(edge.id)
      ? {
          ...edge,
          zIndex: 10,
          animated: true,
          style: { ...edge.style, stroke: "#facc15", strokeWidth: Math.max(4, Number(edge.style?.strokeWidth ?? 2) + 2), opacity: 1 },
          labelStyle: { ...edge.labelStyle, fill: "#fde68a", fontWeight: 700 },
        }
      : {
          ...edge,
          animated: false,
          style: { ...edge.style, opacity: .16 },
          labelStyle: { ...edge.labelStyle, opacity: .2 },
        })
  }
  const highlightConnectedNodes = (nodes: Node<SankeyProcessNodeData>[], edges: Edge[], nodeId: string | null) => {
    const { nodeIds } = downstreamSelection(edges, nodeId)
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        pathHighlighted: Boolean(nodeId && nodeIds.has(node.id)),
        pathDimmed: Boolean(nodeId && !nodeIds.has(node.id)),
      },
    }))
  }
  useEffect(() => {
    setRenderedNodes(highlightConnectedNodes(sankeyNodes, sankeyEdges, selectedProcessId))
    setRenderedEdges(highlightConnectedEdges(sankeyEdges, selectedProcessId))
    const instance = instanceRef.current
    if (instance) requestAnimationFrame(() => instance.fitView({ padding: .25, maxZoom: .68, duration: 350 }))
    // Node and edge arrays are rebuilt during render; these are the settings
    // that change their contents and should reset the draggable graph state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedFlow, selectedImpact, selectedContributionGraph?.id, minContribution, maxProcesses, orientation, connectionStyle, decimalPlaces])
  useEffect(() => {
    setRenderedEdges(highlightConnectedEdges(sankeyEdges, selectedProcessId))
    const { nodeIds } = downstreamSelection(sankeyEdges, selectedProcessId)
    setRenderedNodes((nodes) => nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        pathHighlighted: Boolean(selectedProcessId && nodeIds.has(node.id)),
        pathDimmed: Boolean(selectedProcessId && !nodeIds.has(node.id)),
      },
    })))
    // Edge arrays are rebuilt during render; selection alone should update
    // highlighting without resetting dragged node positions or refitting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProcessId])

  const fitSankey = () => instanceRef.current?.fitView({ padding: .4, maxZoom: .68, duration: 350 })

  return <div className="sankey-view">
    {chartPickerOpen ? <div className="sankey-chart-picker">
      <ToggleGroup type="single" value={mode} onValueChange={(value) => {
        if (!value) return
        const nextMode = value as "flow" | "impact"
        setMode(nextMode)
        if (nextMode === "impact") void loadContributionGraphs([selectedImpact])
      }} className="sankey-picker-tabs" aria-label="Sankey result type">
        <ToggleGroupItem value="flow"><span className="flow-dot output" />Flow</ToggleGroupItem>
        <ToggleGroupItem value="impact"><BarChart3 size={14} />Impact</ToggleGroupItem>
      </ToggleGroup>
      <label>
        <span>{mode === "flow" ? "Flow category" : "Impact category"}</span>
        {mode === "flow"
          ? <AppSelect value={selectedFlow} onValueChange={setFlow} label="Sankey flow category" options={flowNames.map((value) => ({ value, label: inventoryFlowName(value) }))} />
          : <AppSelect value={selectedImpact} onValueChange={(value) => { setImpact(value); void loadContributionGraphs([value]) }} label="Sankey impact category" options={impactNames.map((value) => ({ value, label: impactCategoryDisplayName(value) }))} />}
      </label>
      <div className="sankey-settings-grid">
        <label><span>Min. contribution share</span><NumberStepper value={minContribution} min={0} max={100} step={0.1} suffix="%" inputLabel="Minimum contribution share" decrementLabel="Decrease minimum contribution" incrementLabel="Increase minimum contribution" onValueChange={setMinContribution} /></label>
        <label><span>Max. number of processes</span><NumberStepper value={maxProcesses} min={1} max={processNodes.length} step={1} integer inputLabel="Maximum processes" decrementLabel="Decrease maximum processes" incrementLabel="Increase maximum processes" onValueChange={setMaxProcesses} /></label>
        <label><span>Orientation</span><AppSelect value={orientation} onValueChange={(value) => setOrientation(value as "vertical" | "horizontal")} label="Sankey orientation" options={[{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }]} /></label>
        <label><span>Connections</span><AppSelect value={connectionStyle} onValueChange={(value) => setConnectionStyle(value as "curved" | "straight" | "step")} label="Sankey connections" options={[{ value: "curved", label: "Curved" }, { value: "straight", label: "Straight" }, { value: "step", label: "Step" }]} /></label>
      </div>
    </div> : null}
    <div className="sankey-canvas">
      {impactGraphPending ? <div className="sankey-empty" role="status"><strong>Loading impact graph…</strong><p>Calculating cumulative process contributions.</p></div>
        : totalMagnitude ? <ReactFlow
        key={`sankey-layout-${layoutVersion}-${mode}-${selectedContributionGraph?.id ?? selectedFlow}-${processNodes.length}`}
        className="reactflow-canvas"
        nodes={renderedNodes}
        edges={renderedEdges}
        onNodesChange={onSankeyNodesChange}
        onEdgesChange={onSankeyEdgesChange}
        nodeTypes={sankeyNodeTypes}
        onInit={(instance) => { instanceRef.current = instance }}
        onNodeClick={(_, node) => setSelectedProcessId(node.id)}
        onPaneClick={() => { setChartPickerOpen(false); setSelectedProcessId(null) }}
        minZoom={0.02}
        maxZoom={2}
        zoomOnScroll={false}
        panOnScroll
        onlyRenderVisibleElements={false}
        fitView
        fitViewOptions={{ padding: .25, maxZoom: .68 }}
        proOptions={{ hideAttribution: true }}
      ><Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#242831" /></ReactFlow> : <div className="sankey-empty"><strong>No contributions for this selection</strong><p>Choose another flow or impact category.</p></div>}
    </div>
    {totalMagnitude && !impactGraphPending ? <div className="graph-toolbar sankey-toolbar" aria-label="Sankey graph tools">
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
        <div><dt>Processes shown</dt><dd>{visibleNodes.length} / {processNodes.length}</dd></div>
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

function AppSelect({
  value,
  onValueChange,
  options,
  label,
}: {
  value: string
  onValueChange: (value: string) => void
  options: Array<{ value: string; label: string; disabled?: boolean }>
  label: string
}) {
  return <Select value={value} onValueChange={onValueChange}>
    <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
    <SelectContent position="popper">
      {options.map((option) => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}
    </SelectContent>
  </Select>
}

function GraphEditor({ onTitleChange }: { onTitleChange: (title: string) => void }) {
  const { decimalPlaces, showAllDecimalPlaces, formatNumber, theme } = useDisplaySettings()
  const graphDecimalPlaces = showAllDecimalPlaces ? 20 : decimalPlaces
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ProcessNodeData>>(layoutNodes(initialNodes, initialEdges))
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [selected, setSelected] = useState<(NodeMeta & { id: string }) | null>(null)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<View>("graph")
  const [pendingView, setPendingView] = useState<View | null>(null)
  const [confirmNewYamlOpen, setConfirmNewYamlOpen] = useState(false)
  const [yamlDraft, setYamlDraft] = useState("")
  const [appliedYaml, setAppliedYaml] = useState("")
  const [appliedRevision, setAppliedRevision] = useState(0)
  const [productGraphs, setProductGraphs] = useState<ProductGraphCatalogEntry[]>([])
  const [selectedProductGraph, setSelectedProductGraph] = useState("loading")
  const [yamlError, setYamlError] = useState("")
  const [graphTitle, setGraphTitle] = useState("Loading product graphs…")
  const [resultsMarkdown, setResultsMarkdown] = useState("")
  const [resultsError, setResultsError] = useState("")
  const [contributionError, setContributionError] = useState("")
  const [isCalculating, setIsCalculating] = useState(false)
  const [loadingContributionKeys, setLoadingContributionKeys] = useState<Set<string>>(() => new Set())
  const [lcaResult, setLcaResult] = useState<LcaResult | null>(null)
  const [calculatedRevision, setCalculatedRevision] = useState<number | null>(null)
  const [graphMode, setGraphMode] = useState<"scaled" | "structure">("structure")
  const [graphSettingsOpen, setGraphSettingsOpen] = useState(false)
  const [graphMaxProcesses, setGraphMaxProcesses] = useState(1)
  const [graphOrientation, setGraphOrientation] = useState<"vertical" | "horizontal">("horizontal")
  const [graphConnectionStyle, setGraphConnectionStyle] = useState<"curved" | "straight" | "step">("curved")
  const inspectorOpen = selected !== null
  const foldDirectionRef = useRef<"upstream" | "downstream">("upstream")
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const appliedRevisionRef = useRef(appliedRevision)
  const activeCalculationRef = useRef<AbortController | null>(null)
  const initialCalculationStartedRef = useRef(false)
  const contributionRequestsRef = useRef<Map<string, Promise<ContributionGraph[]>>>(new Map())
  nodesRef.current = nodes
  edgesRef.current = edges
  appliedRevisionRef.current = appliedRevision
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  useEffect(() => {
    if (view !== "graph") return
    let fitFrame = 0
    const resizeFrame = requestAnimationFrame(() => {
      fitFrame = requestAnimationFrame(() => fitView({ padding: 0.35, maxZoom: 0.75, duration: 250 }))
    })
    return () => {
      cancelAnimationFrame(resizeFrame)
      cancelAnimationFrame(fitFrame)
    }
  }, [fitView, view])
  const availableGraphProcessCount = (() => {
    try {
      return buildGraphFromYaml(appliedYaml, "structure").nodes.filter((node) => node.data.scope !== "background").length
    } catch {
      return Math.max(1, graphMaxProcesses)
    }
  })()

  useEffect(() => setGraphMaxProcesses(availableGraphProcessCount), [availableGraphProcessCount])
  useEffect(() => onTitleChange(graphTitle), [graphTitle, onTitleChange])
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

  const toggleBackgroundBranch = useCallback(async (nodeId: string) => {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId)
    if (!node || node.data.scope !== "background" || !node.data.database || node.data.backgroundExploring) return

    if (node.data.backgroundExplored) {
      const descendants = new Set<string>()
      let changed = true
      while (changed) {
        changed = false
        nodesRef.current.forEach((candidate) => {
          if (candidate.data.backgroundParentId === nodeId || (candidate.data.backgroundParentId && descendants.has(candidate.data.backgroundParentId))) {
            if (!descendants.has(candidate.id)) { descendants.add(candidate.id); changed = true }
          }
        })
      }
      const nextNodes = nodesRef.current
        .filter((candidate) => !descendants.has(candidate.id))
        .map((candidate) => candidate.id === nodeId ? { ...candidate, data: { ...candidate.data, backgroundExplored: false } } : candidate)
      const nextEdges = edgesRef.current.filter((edge) => !descendants.has(edge.source) && !descendants.has(edge.target))
      setNodes(nextNodes)
      setEdges(nextEdges)
      return
    }

    setNodes((current) => current.map((candidate) => candidate.id === nodeId
      ? { ...candidate, data: { ...candidate.data, backgroundLoading: true, backgroundExploring: true, backgroundError: undefined } }
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
      const activityScale = (node.data.backgroundDemand ?? 1) / productionAmount
      const scaled = (amount: number) => Number((amount * activityScale).toPrecision(8))
      const technosphere = details.exchanges.filter((exchange) => exchange.exchange_type === "technosphere")
      const childNodes: Node<ProcessNodeData>[] = technosphere.map((exchange, index) => {
        const crossAxisOffset = (index - (technosphere.length - 1) / 2) * 420
        return {
          id: `${nodeId}::background::${exchange.input_database}::${exchange.input_code}`,
          type: "process",
          position: graphOrientation === "vertical"
            ? { x: node.position.x + crossAxisOffset, y: node.position.y + 650 }
            : { x: node.position.x - 650, y: node.position.y + crossAxisOffset },
          sourcePosition: graphOrientation === "vertical" ? Position.Top : Position.Right,
          targetPosition: graphOrientation === "vertical" ? Position.Bottom : Position.Left,
          data: {
          label: exchange.input_name,
          kind: "process",
          detail: `Background activity · ${exchange.input_database}${exchange.input_location ? ` · ${exchange.input_location}` : ""}`,
          color: nodeScopeColors.background,
          scope: "background",
          database: exchange.input_database,
          code: exchange.input_code,
          location: exchange.input_location ?? undefined,
          backgroundDemand: scaled(exchange.amount),
          backgroundDemandUnit: exchange.unit ?? undefined,
          backgroundParentId: nodeId,
          },
        }
      })
      const childEdges: Edge[] = technosphere.map((exchange, index) => {
        const amount = scaled(exchange.amount)
        return {
          id: `${nodeId}::background-edge::${index}::${exchange.input_code}`,
          source: `${nodeId}::background::${exchange.input_database}::${exchange.input_code}`,
          target: nodeId,
          label: `${exchange.input_product ?? exchange.input_name} · ${formatNumber(amount)}${exchange.unit ? ` ${exchange.unit}` : ""}`,
          type: graphConnectionStyle === "curved" ? "default" : graphConnectionStyle === "straight" ? "straight" : "smoothstep",
          style: { stroke: "#2563eb", strokeWidth: 1.5 },
          labelStyle: { fill: "#9aa2ae", fontSize: 12, fontWeight: 650 },
          labelBgStyle: { fill: "#111318", fillOpacity: .92 },
          labelBgPadding: [5, 3],
          labelBgBorderRadius: 4,
        }
      })
      const inputs = technosphere.map((exchange) => ({
        label: exchange.input_name, kind: "background input", color: nodeScopeColors.background,
        amount: scaled(exchange.amount), unit: exchange.unit ?? undefined,
      }))
      const outputs = details.exchanges.filter((exchange) => exchange.exchange_type === "production").map((exchange) => ({
        label: exchange.input_product ?? exchange.input_name, kind: "reference output", color: nodeScopeColors.background,
        amount: scaled(exchange.amount), unit: exchange.unit ?? details.unit ?? node.data.backgroundDemandUnit,
      }))
      const biosphere = details.exchanges.filter((exchange) => exchange.exchange_type === "biosphere").map((exchange) => ({
        label: chemicalFlowLabel(exchange.input_name), amount: scaled(exchange.amount), unit: exchange.unit ?? "",
      }))
      const currentNodes = nodesRef.current.filter((candidate) => candidate.id !== nodeId && candidate.data.backgroundParentId !== nodeId)
      const updatedParent: Node<ProcessNodeData> = {
        ...node,
        data: {
          ...node.data,
          label: details.name,
          detail: `Background activity · ${details.database}${details.location ? ` · ${details.location}` : ""}`,
          code: details.code,
          location: details.location ?? undefined,
          inputs,
          outputs,
          biosphere,
          backgroundLoading: false,
          backgroundExploring: false,
          backgroundLoaded: true,
          backgroundExplored: true,
        },
      }
      const nextNodes = [...currentNodes, updatedParent, ...childNodes]
      const nextEdges = [...edgesRef.current.filter((edge) => !edge.id.startsWith(`${nodeId}::background-edge::`)), ...childEdges]
      setNodes(nextNodes)
      setEdges(nextEdges)
    } catch (error) {
      setNodes((current) => current.map((candidate) => candidate.id === nodeId
        ? { ...candidate, data: {
            ...candidate.data,
            backgroundLoading: false,
            backgroundExploring: false,
            backgroundError: error instanceof Error ? error.message : "Could not load this background activity.",
          } }
        : candidate))
    }
  }, [formatNumber, graphConnectionStyle, graphOrientation, setEdges, setNodes])

  useEffect(() => {
    setNodes((current) => {
      let changed = false
      const next = current.map((node) => {
        if (node.data.scope !== "background" || node.data.onToggleBackground === toggleBackgroundBranch) return node
        changed = true
        return { ...node, data: { ...node.data, onToggleBackground: toggleBackgroundBranch } }
      })
      return changed ? next : current
    })
  }, [nodes, setNodes, toggleBackgroundBranch])

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
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setNodes((current) => layoutNodes(current, edgesRef.current, { orientation: graphOrientation }))
    }))
  }, [edges, graphOrientation, hydrateBackgroundNode, setEdges, setNodes])

  const setAllExpanded = useCallback((expanded: boolean) => {
    const currentEdges = edgesRef.current
    const nodesById = new Map(nodesRef.current.map((node) => [node.id, node]))
    setNodes((current) => {
      const updated = current.map((node) => node.data.expanded === expanded
        ? node
        : { ...node, data: { ...node.data, expanded } })
      return expanded ? populateExpandedConnections(updated, currentEdges) : updated
    })
    setEdges((current) => current.map((edge) => ({
      ...edge,
      targetHandle: expanded && nodesById.get(edge.target)?.data.scope !== "background"
        ? inputHandleIdFor(edge.id)
        : undefined,
    })))
    if (expanded) {
      nodesRef.current
        .filter((node) => node.data.scope === "background")
        .forEach((node) => void hydrateBackgroundNode(node.id))
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setNodes((current) => layoutNodes(current, edgesRef.current, { orientation: graphOrientation }))
    }))
  }, [graphOrientation, hydrateBackgroundNode, setEdges, setNodes])

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
      if (mode === "scaled" && !currentResult) {
        setGraphMode("scaled")
        setYamlError("")
        return
      }
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

  useEffect(() => {
    if (graphMode !== "scaled" || !lcaResult || calculatedRevision !== appliedRevision) return
    showGraphMode("scaled")
    // Apply an early Scaled Graph selection as soon as its scaling vector arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedRevision, calculatedRevision, graphMode, lcaResult])

  const applyYaml = (source: string) => {
    try {
      const parsed = buildGraphFromYaml(source, "structure", undefined, graphDecimalPlaces)
      activeCalculationRef.current?.abort()
      activeCalculationRef.current = null
      setIsCalculating(false)
      const nextRevision = appliedRevisionRef.current + 1
      appliedRevisionRef.current = nextRevision
      setAppliedYaml(source)
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
      setContributionError("")
      contributionRequestsRef.current.clear()
      setLoadingContributionKeys(new Set())
      setLcaResult(null)
      setCalculatedRevision(null)
      requestAnimationFrame(() => requestAnimationFrame(() => fitView({ padding: 0.35, maxZoom: 0.75, duration: 350 })))
      return nextRevision
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : "Could not parse this YAML file.")
      return null
    }
  }

  const calculateSource = async (source: string, revision: number, openGraphWhenReady = false) => {
    activeCalculationRef.current?.abort()
    const controller = new AbortController()
    activeCalculationRef.current = controller
    setIsCalculating(true)
    setResultsError("")
    setContributionError("")
    contributionRequestsRef.current.clear()
    setLoadingContributionKeys(new Set())
    try {
      const result = await calculateLca(source, controller.signal)
      if (controller.signal.aborted || appliedRevisionRef.current !== revision) return
      setLcaResult(result)
      setCalculatedRevision(revision)
      setResultsMarkdown(lcaResultToMarkdown(result, decimalPlaces, showAllDecimalPlaces))
      if (openGraphWhenReady) setView("graph")
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

  useEffect(() => {
    if (initialCalculationStartedRef.current) return
    initialCalculationStartedRef.current = true
    void (async () => {
      try {
        const catalog = await getProductGraphCatalog()
        const initial = catalog.product_graphs.find((item) => item.id === WEBAPP_DEFAULT_PRODUCT_GRAPH_ID)
          ?? catalog.product_graphs.find((item) => item.id === catalog.default_id)
        if (!initial) throw new Error("The product-graph catalog has no default selection.")
        setProductGraphs(catalog.product_graphs)
        setSelectedProductGraph(initial.id)
        setYamlDraft(initial.product_graph)
        const revision = applyYaml(initial.product_graph)
        if (revision !== null) void calculateSource(initial.product_graph, revision)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not load product graphs from the LCA server."
        setSelectedProductGraph("unavailable")
        setYamlError(message)
        setResultsError(message)
      }
    })()
    // The initial catalog load and calculation must run exactly once per app mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyAndCalculateYaml = (source: string, openGraphWhenReady = true) => {
    const revision = applyYaml(source)
    if (revision === null) return
    void calculateSource(source, revision, openGraphWhenReady)
  }

  const loadYamlFile = (file?: File) => {
    if (!file) return
    if (!/\.ya?ml$/i.test(file.name)) { setYamlError("Choose a .yaml or .yml file."); return }
    const reader = new FileReader()
    reader.onload = () => {
      const source = String(reader.result ?? "")
      setYamlDraft(source)
      setSelectedProductGraph("custom")
      setYamlError("")
      applyAndCalculateYaml(source)
    }
    reader.onerror = () => setYamlError("Could not read the selected file.")
    reader.readAsText(file)
  }

  const loadProductGraph = (id: string) => {
    const source = productGraphs.find((item) => item.id === id)?.product_graph
    if (!source) return
    setSelectedProductGraph(id)
    setYamlDraft(source)
    setYamlError("")
    applyAndCalculateYaml(source)
  }

  const connectionCount = edges.length
  const isDirty = yamlDraft !== appliedYaml
  const customYamlLabel = (() => {
    try {
      const source = parse(yamlDraft) as { name?: unknown }
      return typeof source?.name === "string" && source.name.trim()
        ? productGraphLabel(source.name.trim())
        : "Pasted YAML"
    } catch {
      return "Pasted YAML"
    }
  })()
  const openBlankYamlEditor = () => {
    setSelectedProductGraph("custom")
    setYamlDraft("")
    setYamlError("")
    setView("yaml")
  }
  const startPastedYaml = () => {
    if (isDirty) {
      setConfirmNewYamlOpen(true)
      return
    }
    openBlankYamlEditor()
  }
  const discardYamlChanges = () => {
    setYamlDraft(appliedYaml)
    setSelectedProductGraph(productGraphs.find((item) => item.product_graph === appliedYaml)?.id ?? "custom")
    setYamlError("")
  }
  useEffect(() => {
    const confirmDiscard = (event: BeforeUnloadEvent) => {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", confirmDiscard)
    return () => window.removeEventListener("beforeunload", confirmDiscard)
  }, [isDirty])
  const hasCurrentResults = Boolean(lcaResult && calculatedRevision === appliedRevision)
  const primaryView = view === "graph" || view === "yaml" || view === "results" ? view : ""
  const analysisView = isAnalysisView(view) ? view : ""
  const selectedNode = selected ? nodes.find((node) => node.id === selected.id) : undefined
  const inputNodes = selectedNode ? edges
    .filter((edge) => edge.target === selectedNode.id)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is Node<ProcessNodeData> => Boolean(node)) : []
  const outputNodes = selectedNode ? edges
    .filter((edge) => edge.source === selectedNode.id)
    .map((edge) => nodes.find((node) => node.id === edge.target))
    .filter((node): node is Node<ProcessNodeData> => Boolean(node)) : []

  const loadContributionGraphs = async (requestedCategories: string[]): Promise<ContributionGraph[]> => {
    const current = lcaResult
    if (!current || calculatedRevision !== appliedRevision) {
      throw new Error("Calculate the current product graph before loading cumulative contributions.")
    }
    const availableLabels = Object.keys(current.lcia)
    const resolveLabel = (query: string) => {
      const normalized = query.trim().toLowerCase()
      const exact = availableLabels.filter((label) => label.toLowerCase() === normalized)
      const component = availableLabels.filter((label) => label.split("|")[0].trim().toLowerCase() === normalized)
      const substring = availableLabels.filter((label) => label.toLowerCase().includes(normalized))
      const matches = exact.length ? exact : component.length ? component : substring
      return matches.length === 1 ? matches[0] : query
    }
    const labels = [...new Set(requestedCategories.filter(Boolean).map(resolveLabel))]
    const existing = new Map(current.contribution_graphs.map((graph) => [graph.label, graph]))
    const missing = labels.filter((label) => !existing.has(label))
    if (!missing.length) return labels.flatMap((label) => existing.get(label) ?? [])

    const requestKey = `${current.result_id}:${[...missing].sort().join("\u001f")}`
    let request = contributionRequestsRef.current.get(requestKey)
    if (!request) {
      setLoadingContributionKeys((keys) => new Set(keys).add(requestKey))
      request = calculateContributionGraphs(appliedYaml, missing, current.result_id)
        .then((batch) => {
          setLcaResult((latest) => {
            if (!latest || latest.result_id !== batch.result_id) return latest
            const merged = new Map(latest.contribution_graphs.map((graph) => [graph.label, graph]))
            batch.contribution_graphs.forEach((graph) => merged.set(graph.label, graph))
            return { ...latest, contribution_graphs: [...merged.values()] }
          })
          setContributionError("")
          return batch.contribution_graphs
        })
        .finally(() => {
          if (contributionRequestsRef.current.get(requestKey) !== request) return
          contributionRequestsRef.current.delete(requestKey)
          setLoadingContributionKeys((keys) => {
            const next = new Set(keys)
            next.delete(requestKey)
            return next
          })
        })
      contributionRequestsRef.current.set(requestKey, request)
    }
    const loaded = await request
    const combined = new Map([...existing, ...loaded.map((graph) => [graph.label, graph] as const)])
    return labels.flatMap((label) => combined.get(label) ?? [])
  }

  const cumulativeCategories = (() => {
    try {
      const source = parse(appliedYaml) as {
        lcia?: { contribution_graph?: { categories?: unknown } }
      }
      const configured = source.lcia?.contribution_graph?.categories
      if (Array.isArray(configured) && configured.every((item) => typeof item === "string")) {
        return configured
      }
    } catch {
      // Applied YAML was already validated; use the returned category labels.
    }
    return lcaResult
      ? Object.entries(lcaResult.lcia).filter(([, value]) => value.score !== 0).map(([label]) => label)
      : []
  })()
  const calculationInProgress = isCalculating || loadingContributionKeys.size > 0
  const backgroundProcessing = nodes.some((node) => node.data.backgroundExploring)

  const openAnalysisView = (next: AnalysisView) => {
    setView(next)
    if (["impact", "process", "contribution", "sankey"].includes(next) && cumulativeCategories.length) {
      void loadContributionGraphs(cumulativeCategories).catch((caught) => {
        setContributionError(caught instanceof Error ? caught.message : "Could not calculate cumulative contributions.")
      })
    }
  }

  const continueToView = (next: View) => {
    if (isAnalysisView(next)) openAnalysisView(next)
    else setView(next)
  }

  const requestView = (next: View) => {
    if (isDirty && next !== "yaml") {
      setPendingView(next)
      return
    }
    continueToView(next)
  }

  const discardAndContinue = () => {
    if (!pendingView) return
    const next = pendingView
    discardYamlChanges()
    setPendingView(null)
    continueToView(next)
  }

  const calculateAndContinue = () => {
    if (!pendingView) return
    const revision = applyYaml(yamlDraft)
    if (revision === null) {
      setPendingView(null)
      return
    }
    setPendingView(null)
    void calculateSource(yamlDraft, revision, true)
  }

  return (
    <>
      <div className="canvas-wrap">
        <div className="canvas-head">
          <div className="canvas-actions">
            <div className="view-tabs">
              <label className="case-study-select navigation-product-select"><span>LCA File</span><AppSelect
                value={selectedProductGraph}
                onValueChange={(value) => !["custom", "loading", "unavailable"].includes(value) && loadProductGraph(value)}
                label="Choose a product graph"
                options={productGraphs.length ? [
                  ...productGraphs.map((item) => ({ value: item.id, label: productGraphLabel(item.name) })),
                  ...(selectedProductGraph === "custom" ? [{ value: "custom", label: customYamlLabel, disabled: true }] : []),
                ] : [{
                  value: selectedProductGraph,
                  label: selectedProductGraph === "unavailable" ? "Catalog unavailable" : "Loading catalog…",
                  disabled: true,
                }]}
              /></label>
              {calculationInProgress ? <span className="calculation-message" role="status" aria-label="LCA calculation in progress">Calculating…</span>
                : backgroundProcessing ? <span className="calculation-message" role="status" aria-label="Background graph processing">Processing…</span> : null}
              <div className="view-tab-groups">
                <ToggleGroup type="single" value={primaryView} onValueChange={(next) => next && requestView(next as "graph" | "yaml" | "results")} className="inline-flex items-center" aria-label="Primary views">
                  <ToggleGroupItem value="graph">Graph</ToggleGroupItem>
                  <ToggleGroupItem value="yaml">Editor</ToggleGroupItem>
                  <ToggleGroupItem value="results" aria-label="Results">Results</ToggleGroupItem>
                </ToggleGroup>
                <ToggleGroup type="single" value={analysisView} onValueChange={(next) => next && requestView(next as AnalysisView)} className="inline-flex items-center" aria-label="Result analysis views">
                  <ToggleGroupItem value="inventory" disabled={!hasCurrentResults}>Inventory</ToggleGroupItem>
                  <ToggleGroupItem value="impact" disabled={!hasCurrentResults}>Impact Analysis</ToggleGroupItem>
                  <ToggleGroupItem value="process" disabled={!hasCurrentResults}>Process Results</ToggleGroupItem>
                  <ToggleGroupItem value="contribution" disabled={!hasCurrentResults}>Contribution</ToggleGroupItem>
                  <ToggleGroupItem value="sankey" disabled={!hasCurrentResults}>Sankey Graph</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          </div>
        </div>
        {view === "graph" ? <div className="search graph-search"><Search size={16} /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a node…" aria-label="Find a node" /><kbd>⌘ K</kbd></div> : null}
        {view === "graph" ? <><div className={`graph-viewport${inspectorOpen ? " has-inspector" : ""}`}><ReactFlow
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
          minZoom={0.05}
          maxZoom={2.4}
          zoomOnScroll={false}
          panOnScroll
          onInit={(instance) => requestAnimationFrame(() => requestAnimationFrame(() => instance.fitView({ padding: 0.35, maxZoom: 0.75 })))}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={theme === "dark" ? "#242831" : "#cbd5e1"} />
        </ReactFlow></div>
        <div className="graph-toolbar" aria-label="Graph tools">
          <div className="toolbar-group">
            <Popover modal open={graphSettingsOpen} onOpenChange={setGraphSettingsOpen}>
              <Tooltip>
                <PopoverTrigger asChild>
                  <TooltipTrigger asChild>
                    <Button aria-label="Graph settings" variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground"><Settings2 size={18} /></Button>
                  </TooltipTrigger>
                </PopoverTrigger>
                <TooltipContent side="right" sideOffset={8} className="tooltip">Graph settings</TooltipContent>
              </Tooltip>
              <PopoverContent
                className="graph-settings-picker"
                side="right"
                align="start"
                sideOffset={11}
                alignOffset={-7}
                onInteractOutside={(event) => {
                  const target = event.target
                  if (target instanceof Element && target.closest('[data-slot="select-content"]')) event.preventDefault()
                }}
              >
                <div className="graph-settings-title"><div><Settings2 size={15} /><span>Graph settings</span></div><Button variant="ghost" size="icon" type="button" onClick={() => setGraphSettingsOpen(false)} aria-label="Close graph settings"><X size={15} /></Button></div>
                <div className="graph-settings-grid">
                  <label><span>Max. number of processes</span><NumberStepper value={graphMaxProcesses} min={1} max={availableGraphProcessCount} step={1} integer inputLabel="Graph maximum processes" decrementLabel="Decrease graph maximum processes" incrementLabel="Increase graph maximum processes" onValueChange={(value) => { setGraphMaxProcesses(value); applyGraphSettings({ maximum: value }) }} /></label>
                  <label><span>Orientation</span><AppSelect value={graphOrientation} onValueChange={(value) => { const orientation = value as "vertical" | "horizontal"; setGraphOrientation(orientation); applyGraphSettings({ orientation }) }} label="Graph orientation" options={[{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }]} /></label>
                  <label><span>Connections</span><AppSelect value={graphConnectionStyle} onValueChange={(value) => { const connectionStyle = value as "curved" | "straight" | "step"; setGraphConnectionStyle(connectionStyle); applyGraphSettings({ connectionStyle }) }} label="Graph connections" options={[{ value: "curved", label: "Curved" }, { value: "straight", label: "Straight" }, { value: "step", label: "Step" }]} /></label>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="toolbar-group">
            <ToolButton label="Select"><MousePointer2 size={18} /></ToolButton>
          </div>
          <div className="toolbar-group">
            <ToolButton label="Expand all activities" onClick={() => setAllExpanded(true)}><ChevronsUpDown size={18} /></ToolButton>
            <ToolButton label="Collapse all activities" onClick={() => setAllExpanded(false)}><ChevronsDownUp size={18} /></ToolButton>
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
          <Button title={!hasCurrentResults ? "Scaled amounts will appear when the LCA calculation finishes" : undefined} variant="ghost" className={`graph-action ${graphMode === "scaled" ? "is-active" : ""}`} aria-pressed={graphMode === "scaled"} disabled={!hasCurrentResults} onClick={() => showGraphMode("scaled")}><Scan size={16} />Scaled Graph</Button>
          <Button variant="ghost" className={`graph-action ${graphMode === "structure" ? "is-active" : ""}`} aria-pressed={graphMode === "structure"} onClick={() => showGraphMode("structure")}><LayoutGrid size={16} />Structure Graph</Button>
        </div></> : view === "yaml" ? <div className="yaml-editor">
          <div className="yaml-editor-head">
            <div><strong>Product graph YAML</strong><span>Edit the selected example, paste YAML, or open a local file.</span></div>
            <div className="yaml-editor-actions">
              <Button size="sm" variant="outline" className="yaml-paste-button" onClick={startPastedYaml}><ClipboardPaste size={14} />Paste YAML</Button>
              <label className="yaml-upload"><FileUp size={15} /> Upload<input type="file" accept=".yaml,.yml,text/yaml" onChange={(event) => loadYamlFile(event.target.files?.[0])} /></label>
            </div>
          </div>
          <textarea value={yamlDraft} onChange={(event) => { setYamlDraft(event.target.value); setSelectedProductGraph("custom"); setYamlError("") }} spellCheck={false} aria-label="Product graph YAML" />
          <div className="yaml-editor-foot">
            <span className={yamlError ? "yaml-error" : isDirty ? "yaml-dirty" : ""}>{yamlError || (!yamlDraft.trim() ? "Paste YAML to create a new LCA." : isDirty ? "Unapplied changes. Calculate the LCA or discard changes before leaving this view." : isCalculating ? "Calculating the selected YAML…" : "Catalog YAML is loaded from the LCA server and parsed locally.")}</span>
            <Button size="sm" disabled={!isDirty || isCalculating || !yamlDraft.trim()} onClick={() => applyAndCalculateYaml(yamlDraft)}>Calculate</Button>
          </div>
        </div> : view === "inventory" ? <InventoryView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError} /> : view === "impact" ? <ImpactAnalysisView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError || contributionError} loadContributionGraphs={loadContributionGraphs} /> : view === "process" && hasCurrentResults && lcaResult ? <ProcessResultsView result={lcaResult} yaml={appliedYaml} /> : view === "contribution" ? <ContributionView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError || contributionError} loadContributionGraphs={loadContributionGraphs} /> : view === "sankey" && hasCurrentResults && lcaResult ? <SankeyView result={lcaResult} loadContributionGraphs={loadContributionGraphs} /> : <div className="results-panel">
          <div className="results-panel-head">
            <div><strong>LCA Results</strong>{isCalculating ? <span className="calculation-message">Calculating…</span> : null}</div>
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
      <AlertDialog open={pendingView !== null} onOpenChange={(open) => { if (!open) setPendingView(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved YAML changes</AlertDialogTitle>
            <AlertDialogDescription>
              Calculate the LCA to apply your YAML changes, or discard them before leaving the file editor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={discardAndContinue}>Discard changes</AlertDialogAction>
            <AlertDialogAction onClick={calculateAndContinue}>Calculate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmNewYamlOpen} onOpenChange={setConfirmNewYamlOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard current YAML changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Starting a new pasted YAML file will clear the unapplied changes currently in the editor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={openBlankYamlEditor}>Discard and start new</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AppContent() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [workspaceTitle, setWorkspaceTitle] = useState("Loading product graphs…")
  const { decimalPlaces, setDecimalPlaces, showAllDecimalPlaces, setShowAllDecimalPlaces, theme, setTheme } = useDisplaySettings()

  return (
    <TooltipProvider delayDuration={250}>
      <main className={`app-shell theme-${theme}`}>
        <header className="topbar">
          <div className="brand"><div className="brand-mark"><Share2 size={16} /></div><span>PRISM Life Cycle Assessment</span><span className="brand-separator">·</span><h1 className="brand-study-title">{workspaceTitle}</h1></div>
          <div className="top-actions">
            <Popover modal open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" className={`global-settings-trigger ${settingsOpen ? "is-active" : ""}`} type="button" aria-label="Global settings"><Settings2 size={16} /><span>Settings</span></Button>
              </PopoverTrigger>
              <PopoverContent className="global-settings-panel" side="bottom" align="end" sideOffset={3}>
                <div className="global-settings-title"><div><Settings2 size={15} /><span>Global settings</span></div><Button variant="ghost" size="icon" type="button" onClick={() => setSettingsOpen(false)} aria-label="Close global settings"><X size={15} /></Button></div>
                <div className="global-setting-field">
                  <span>Decimal places</span>
                  <p>Applied to numerical results across the workspace.</p>
                  <label className="all-decimals-toggle"><Checkbox checked={showAllDecimalPlaces} onCheckedChange={(checked) => setShowAllDecimalPlaces(checked === true)} aria-label="Show all decimal places" /><span>Show all decimal places</span></label>
                  <NumberStepper value={decimalPlaces} min={0} max={8} step={1} integer disabled={showAllDecimalPlaces} inputLabel="Decimal places" decrementLabel="Decrease decimal places" incrementLabel="Increase decimal places" onValueChange={setDecimalPlaces} />
                </div>
                <div className="global-setting-field">
                  <span>Appearance</span>
                  <p>Choose the workspace color theme.</p>
                  <ToggleGroup type="single" value={theme} onValueChange={(value) => value && setTheme(value as "dark" | "light")} className="theme-options" aria-label="Appearance">
                    <ToggleGroupItem value="dark"><Moon size={14} />Dark</ToggleGroupItem>
                    <ToggleGroupItem value="light"><Sun size={14} />Light</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </header>

        <section className="workspace">
          <ReactFlowProvider>
            <GraphEditor onTitleChange={setWorkspaceTitle} />
          </ReactFlowProvider>
        </section>
      </main>
    </TooltipProvider>
  )
}

export default function App() {
  return <DisplaySettingsProvider><AppContent /></DisplaySettingsProvider>
}
