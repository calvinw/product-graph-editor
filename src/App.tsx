import { Fragment, useCallback, useEffect, useReducer, useRef, useState } from "react"
import { createPortal } from "react-dom"
import dagre from "@dagrejs/dagre"
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant,
  Handle, Position, useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import prismLogoRound from "./assets/prism-logo-round.png"
import {
  ArrowRight, BarChart3, Box, Check, Component, CopyPlus, Scan, LayoutGrid, ChevronDown, Download, Factory, FilePlus2, Globe2, Leaf,
  ChevronsDownUp, ChevronsUpDown, FileUp, Minus, Moon, MousePointer2, Plus, Save as SaveIcon, Search, Settings2, Sun, X,
} from "lucide-react"
import { parse } from "yaml"
import { Button } from "@/components/ui/button"
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
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
  type ContributionGraph, type ContributionGraphNode, type LcaResult, type ProductGraphCatalogEntry,
} from "./lib/lcaApi"
import { unitsAreCompatible } from "./lib/units"
import { cn } from "./lib/utils"
import { DisplaySettingsProvider, useDisplaySettings } from "./lib/displaySettings"
import {
  catalogEntryToDocument, initialModelWorkspace, modelWorkspaceReducer, safeYamlFilename,
  uniqueSessionTitle, yamlFilenameStem, type ActiveDocument, type SessionDocument,
} from "./lib/modelWorkspace"
type NodeMeta = { label: string; kind: string; detail: string; color: string; scope?: "foreground" | "background" }
type View = "graph" | "yaml" | "inventory" | "impact" | "process" | "contribution" | "sankey" | "results"
type AnalysisView = Extract<View, "inventory" | "impact" | "process" | "contribution" | "sankey">
type PendingAction =
  | { kind: "view"; view: View }
  | { kind: "catalog"; id: string }
  | { kind: "session"; id: string }
  | { kind: "new" }
  | { kind: "upload" }
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
  const targetPosition = data.orientation === "vertical" ? Position.Top : Position.Left
  const sourcePosition = data.orientation === "vertical" ? Position.Bottom : Position.Right
  return <div className={`pg-node is-expanded sankey-process-node${data.pathHighlighted ? " is-path-highlighted" : ""}${data.pathDimmed ? " is-path-dimmed" : ""}`} style={{ "--node-color": nodeScopeColors[data.scope] } as React.CSSProperties}>
    <Handle type="target" position={targetPosition} />
    <div className="pg-node-head"><Component size={14} /><span className="pg-node-label">{data.label}</span><small className={`pg-node-scope is-${data.scope}`}>{data.scope}</small></div>
    <div className="sankey-process-metrics">
      <div>{data.direct}</div>
      <div>{data.upstream}</div>
    </div>
    <Handle type="source" position={sourcePosition} />
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
  const renderFlowTable = (rows: typeof flows, empty: string) => <div className="inventory-table-wrap"><table className="inventory-table" style={{ width: Math.max(880, flowColumnWidths.reduce((sum, width) => sum + width, 0)) }}>
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
    <div className="inventory-title"><div><strong>Inventory results</strong><span>{result.name} · {result.functional_unit}</span></div></div>
    <details open><summary>Inputs <span>{inputs.length}</span></summary>{renderFlowTable(inputs, "No environmental input flows were returned.")}</details>
    <details open><summary>Outputs <span>{outputs.length}</span></summary>{renderFlowTable(outputs, "No environmental output flows were returned.")}</details>
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
    <div className="impact-title"><div><strong>Impact analysis</strong><span>{result.name} · {result.method}</span></div></div>
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
  const exactLciFlowKeys = new Set<string>()
  const lciFlowAliases = new Map<string, Set<string>>()
  Object.entries(result.lci).forEach(([name, value]) => {
    const input = isInventoryInput(value.type)
    const exactKey = `${input}:${normalizedFlow(name)}`
    const aliasKey = `${input}:${normalizedFlow(name.split(/[|,]/)[0])}`
    exactLciFlowKeys.add(exactKey)
    lciFlowAliases.set(aliasKey, new Set(lciFlowAliases.get(aliasKey) ?? []).add(exactKey))
  })
  const canonicalFlowKey = (input: boolean, name: string) => {
    const key = `${input}:${normalizedFlow(name)}`
    if (exactLciFlowKeys.has(key)) return key
    const aliases = lciFlowAliases.get(key)
    return aliases?.size === 1 ? [...aliases][0] : key
  }
  const flowRows = new Map<string, { name: string; category: string; unit: string; upstream: number; direct: number; input: boolean }>()
  processNodes.filter((node) => flowIncludedIds.has(node.id)).forEach((node) => {
    const process = nodeProcess(node)
    const scale = result.scaling_vector[node.id] ?? result.scaling_vector[node.process_name ?? ""] ?? result.scaling_vector[process?.name ?? ""] ?? 1
    const exchanges = [
      ...(process?.emissions ?? []).map((flow) => ({ ...flow, input: false })),
      ...(process?.extractions ?? process?.resources ?? process?.resource_inputs ?? []).map((flow) => ({ ...flow, input: true })),
    ]
    exchanges.forEach((flow) => {
      const key = canonicalFlowKey(flow.input, flow.flow)
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
      const key = canonicalFlowKey(input, flow.flow_name)
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
    const yamlKey = canonicalFlowKey(flow.input, flow.name)
    const existing = flowRows.get(yamlKey)
    if (existing) {
      existing.name = flow.name
      existing.category = flow.category
      existing.unit = flow.unit
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
      const key = canonicalFlowKey(input, name)
      const existing = flowRows.get(key)
      flowRows.set(key, {
        name,
        category: existing?.category ?? (input ? "elementary flows/resource" : "elementary flows/air"),
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
  const renderFlowResultsTable = (input: boolean) => {
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
    <div className="process-results-title"><div><strong>Process results</strong><span>{result.name} · {result.functional_unit}</span></div></div>
    <details open><summary>Flow contributions to process results</summary>
      <div className="process-results-controls"><label>Process <AppSelect value={selectedFlowProcessId} onValueChange={setFlowProcessId} label="Flow contribution process" options={processNodes.map((node) => ({ value: node.id, label: cleanImpactProcessName(node.process_name ?? node.label) }))} /></label><label>Don’t show &lt; <Input type="number" min="0" max="100" step="0.01" value={threshold} onChange={(event) => setThreshold(Math.max(0, Number(event.target.value)))} /> %</label></div>
      <div className="process-flow-grids"><section><h3>Inputs</h3>{renderFlowResultsTable(true)}</section><section><h3>Outputs</h3>{renderFlowResultsTable(false)}</section></div>
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
  const resizeColumn = (index: number, requestedWidth: number) => {
    const nextWidths = [...widths]
    const adjacentWidth = widths[index + 1]
    if (adjacentWidth === undefined) {
      nextWidths[index] = requestedWidth
    } else {
      const delta = Math.min(requestedWidth - widths[index], adjacentWidth - 80)
      nextWidths[index] = widths[index] + delta
      nextWidths[index + 1] = adjacentWidth - delta
    }
    onWidthsChange(nextWidths)
  }
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
  const [contributionMode, setContributionMode] = useState<"flow" | "impact">("impact")
  const [impact, setImpact] = useState("")
  const [flow, setFlow] = useState("")
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(() => new Set())
  const [columnWidths, setColumnWidths] = useState([190, 170, 320, 190, 250, 140])

  const impactNames = result ? Object.keys(result.lcia) : []
  const defaultImpact = impactNames.find((name) => impactCategoryAbbreviation(name).replaceAll(/\s+/g, "").toUpperCase() === "GWP100")
    ?? impactNames.find((name) => /global warming|climate change/i.test(name))
    ?? impactNames[0]
    ?? ""
  const selectedImpact = impactNames.includes(impact) ? impact : defaultImpact
  if (!result || !isCurrent) return <div className="results-panel contribution-panel">
    <div className="results-panel-head"><div><strong>Contribution analysis</strong><span>Compare direct and accumulated process impacts.</span></div></div>
    <div className="results-placeholder"><div className="results-empty-icon"><BarChart3 size={22} /></div><strong>No current contribution results</strong><p>Calculate the LCA to populate this view.</p>{error ? <div className="results-error"><strong>Calculation failed</strong><p>{error}</p></div> : null}</div>
  </div>

  const category = result.process_contributions.categories.find((item) => item.label === selectedImpact || item.id === selectedImpact)
  const selectedContributionGraph = result.contribution_graphs.find((item) => item.label === selectedImpact)
  const availableFlows = [...new Map(result.contribution_graphs.flatMap((graph) => graph.flows).map((item) => [
    `${item.flow_name}\u0000${item.unit}`,
    { value: `${item.flow_name}\u0000${item.unit}`, label: `${chemicalFlowLabel(item.flow_name)} (${item.unit})` },
  ])).values()].sort((left, right) => left.label.localeCompare(right.label))
  const selectedFlow = availableFlows.some((item) => item.value === flow) ? flow : (availableFlows[0]?.value ?? "")
  const [selectedFlowName, selectedFlowUnit = ""] = selectedFlow.split("\u0000")
  let requirements: ReturnType<typeof buildInventoryRequirements> = []
  try { requirements = buildInventoryRequirements(yaml, result.scaling_vector) } catch { requirements = [] }
  const impactTotal = result.lcia[selectedImpact]
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
  const rows = (category?.processes ?? []).map((item, index) => ({ name: processName(item.process_name, index), required: requiredAmount(item.process_id, item.process_name, index), total: item.direct_score, percentage: item.percentage }))
    .filter((row) => row.name && !/^(?:p?\d+)$/i.test(row.name))
    .sort((left, right) => Math.abs(right.total) - Math.abs(left.total))
  const total = category?.total_score ?? impactTotal?.score ?? 0
  const unit = category?.unit ?? impactTotal?.unit ?? ""
  const maxMagnitude = Math.max(Math.abs(total), ...rows.map((row) => Math.abs(row.total)), 1e-30)
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
  const ownValue = (row: (typeof rows)[number]) => row.total
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
      .sort((left, right) => Math.abs(rolledUpValue(right)) - Math.abs(rolledUpValue(left)))
    const canExpand = upstream.length > 0
    const isOpen = expandedProcesses.has(row.name)
    const displayedValue = rolledUpValue(row)
    const contributionRate = total ? displayedValue / total * 100 : 0
    const directPercent = total ? row.total / total * 100 : 0
    const processRow = <tr key={`${row.name}-${depth}-${index}`} className={canExpand ? "clickable-process" : ""} onClick={canExpand ? () => toggleProcess(row.name) : undefined}>
      <td><span className="result-bar contribution-rate-bar"><i className={contributionRate < 0 ? "negative" : ""} style={{ width: `${Math.min(100, Math.abs(contributionRate))}%` }} /></span><span className="rate-value">{formatPercent(contributionRate)}</span></td>
      <td><span className="rate-value">{formatPercent(directPercent)}</span></td>
      <td style={{ paddingLeft: `${7 + depth * 20}px` }}>{canExpand ? <button className={`tree-toggle ${isOpen ? "is-expanded" : ""}`} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} inputs for ${row.name}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="process-mark">⌘</span>{row.name}</td>
      <td>{number(row.total)}</td><td><span className="result-bar"><i className={displayedValue < 0 ? "negative" : ""} style={{ width: `${Math.min(100, Math.abs(displayedValue) / maxMagnitude * 100)}%` }} /></span>{number(displayedValue)}</td><td>{unit}</td>
    </tr>
    return isOpen ? [processRow, ...renderContributionRows(upstream, depth + 1)] : [processRow]
  })

  const graphNodesById = new Map(selectedContributionGraph?.nodes.map((node) => [node.id, node]) ?? [])
  const graphChildren = new Map<string, ContributionGraphNode[]>()
  selectedContributionGraph?.edges.forEach((edge) => {
    const producer = graphNodesById.get(edge.producer_id)
    if (producer?.kind !== "process") return
    graphChildren.set(edge.consumer_id, [...(graphChildren.get(edge.consumer_id) ?? []), producer])
  })
  graphChildren.forEach((children) => children.sort((left, right) => Math.abs(right.cumulative_score) - Math.abs(left.cumulative_score)))
  const flowDirectScore = (nodeId: string) => selectedContributionGraph?.flows
    .filter((item) => item.process_occurrence_id === nodeId && item.flow_name === selectedFlowName && item.unit === selectedFlowUnit)
    .reduce((sum, item) => sum + item.amount, 0) ?? 0
  const flowCumulativeScore = (nodeId: string, visited = new Set<string>()): number => {
    if (visited.has(nodeId)) return 0
    const nextVisited = new Set(visited).add(nodeId)
    return flowDirectScore(nodeId) + (graphChildren.get(nodeId) ?? []).reduce((sum, child) => sum + flowCumulativeScore(child.id, nextVisited), 0)
  }
  const graphRootId = selectedContributionGraph?.nodes.find((node) => node.kind === "functional_unit")?.id ?? ""
  const graphRootProcesses = graphChildren.get(graphRootId) ?? []
  const flowTotal = graphRootProcesses.reduce((sum, node) => sum + flowCumulativeScore(node.id), 0)
  const displayedTotal = contributionMode === "flow" ? flowTotal : (selectedContributionGraph?.total_score ?? total)
  const displayedUnit = contributionMode === "flow" ? selectedFlowUnit : (selectedContributionGraph?.unit ?? unit)
  const graphNodeCumulativeScore = (node: ContributionGraphNode) => contributionMode === "flow" ? flowCumulativeScore(node.id) : node.cumulative_score
  const renderGraphProcesses = (items: ContributionGraphNode[], depth = 0): React.ReactNode[] => items.flatMap((node) => {
    const children = graphChildren.get(node.id) ?? []
    const isOpen = expandedProcesses.has(node.id)
    const directScore = contributionMode === "flow" ? flowDirectScore(node.id) : node.direct_score
    const cumulativeScore = graphNodeCumulativeScore(node)
    const contributionRate = displayedTotal ? cumulativeScore / displayedTotal * 100 : null
    const percent = displayedTotal ? cumulativeScore / displayedTotal * 100 : null
    const directPercent = displayedTotal ? directScore / displayedTotal * 100 : null
    const row = <tr key={node.id} className={children.length ? "clickable-process contribution-process-row" : "contribution-process-row"} onClick={children.length ? () => toggleProcess(node.id) : undefined}>
      <td>{contributionRate === null ? "—" : <><span className="result-bar contribution-rate-bar"><i className={contributionRate < 0 ? "negative" : ""} style={{ width: `${Math.min(100, Math.abs(contributionRate))}%` }} /></span><span className="rate-value">{formatPercent(contributionRate)}</span></>}</td>
      <td><span className="rate-value">{directPercent === null ? "—" : formatPercent(directPercent)}</span></td>
      <td style={{ paddingLeft: `${7 + depth * 20}px` }}>{children.length ? <button className={`tree-toggle ${isOpen ? "is-expanded" : ""}`} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} upstream processes for ${node.process_name}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="process-mark">⌘</span>{cleanProcessName(node.process_name)}{node.location ? <small>{node.location}</small> : null}</td>
      <td>{number(directScore)}</td>
      <td><span className="result-bar"><i className={cumulativeScore < 0 ? "negative" : ""} style={{ width: `${Math.min(100, Math.abs(percent ?? 0))}%` }} /></span>{number(cumulativeScore)}</td>
      <td>{displayedUnit}</td>
    </tr>
    return isOpen ? [row, ...renderGraphProcesses(children, depth + 1)] : [row]
  })

  return <div className="contribution-view">
    <div className="contribution-title"><div><strong>Contribution analysis</strong><span>{result.name} · {result.method} · {result.functional_unit}</span></div>
      {selectedContributionGraph ? <aside className={`contribution-graph-summary is-${selectedContributionGraph.status}`}>
        <strong>{selectedContributionGraph.status.replace("_", " ")}</strong>
        <span>Total {formatNumber(selectedContributionGraph.total_score)} {selectedContributionGraph.unit} · Coverage {selectedContributionGraph.coverage === null ? "—" : formatPercent(selectedContributionGraph.coverage * 100)} · Unexpanded {formatNumber(selectedContributionGraph.unexpanded_score)} {selectedContributionGraph.unit}</span>
      </aside> : null}
    </div>
    <div className="contribution-controls">
      <div className="contribution-mode-group"><label className={contributionMode === "flow" ? "active" : ""}><input className="app-radio" type="radio" name="contribution-mode" checked={contributionMode === "flow"} onChange={() => setContributionMode("flow")} />Flows</label><label className={contributionMode === "impact" ? "active" : ""}><input className="app-radio" type="radio" name="contribution-mode" checked={contributionMode === "impact"} onChange={() => setContributionMode("impact")} />Impact category</label></div>
      <div className="contribution-control-slot">{contributionMode === "flow"
        ? <div className="contribution-select is-flow"><Leaf size={16} /><AppSelect value={selectedFlow} onValueChange={setFlow} label="Flow" options={availableFlows} /></div>
        : <div className="contribution-select is-impact"><BarChart3 size={16} /><AppSelect value={selectedImpact} onValueChange={(value) => { setImpact(value); void loadContributionGraphs([value]) }} label="Impact category" options={impactNames.map((value) => ({ value, label: impactCategoryDisplayName(value) }))} /></div>}</div>
      {!selectedContributionGraph ? <p className="contribution-fallback-note">Recursive contributions were not requested for this category. Showing the available process-contribution results.</p> : null}
    </div>
    <div className="contribution-table-wrap"><table className="contribution-table" style={{ width: Math.max(1180, columnWidths.reduce((sum, width) => sum + width, 0)) }}><ResizableTableHeader labels={[
      "Contribution",
      "Direct Contribution %",
      "Process",
      "Direct contribution",
      "Accumulated contribution",
      "Unit",
    ]} widths={columnWidths} onWidthsChange={setColumnWidths} /><tbody>
      {selectedContributionGraph ? <>
        {renderGraphProcesses(graphRootProcesses)}
        {!selectedContributionGraph.nodes.some((node) => node.kind === "process") ? <tr className="empty-row"><td colSpan={6}>{selectedContributionGraph.status === "zero_total" ? "This selection has a zero total, so contribution percentages are unavailable." : "No process contributions were returned for this selection."}</td></tr> : null}
      </> : <>
        {renderContributionRows(rootRows.length ? rootRows : rows)}
        {!rows.length ? <tr className="empty-row"><td colSpan={6}>No process contribution rows were returned for this category.</td></tr> : null}
      </>}
    </tbody></table></div>
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
    ? selectedContributionGraph.nodes.filter((node) => node.kind === "process").map((node) => ({
        id: node.id,
        label: node.process_name,
        process_name: node.process_name,
        scope: node.scope ?? "foreground" as const,
        kind: node.kind,
      }))
    : result.sankey.nodes.filter((node) => node.kind === "process").map((node) => ({ ...node, kind: node.kind }))
  useEffect(() => setMaxProcesses(processNodes.length), [mode, processNodes.length, selectedContributionGraph?.id, selectedFlow, selectedImpact])
  const processIds = new Set(processNodes.map((node) => node.id))
  const contributionDepths = new Map(selectedContributionGraph?.nodes.map((node) => [node.id, node.depth]) ?? [])
  const links = mode === "impact" && selectedContributionGraph
    ? selectedContributionGraph.edges.filter((edge) => processIds.has(edge.source) && processIds.has(edge.target)).map((edge) => {
        const sourceDepth = contributionDepths.get(edge.source) ?? 0
        const targetDepth = contributionDepths.get(edge.target) ?? 0
        return {
          id: edge.id,
          source: sourceDepth <= targetDepth ? edge.source : edge.target,
          target: sourceDepth <= targetDepth ? edge.target : edge.source,
        }
      })
    : result.sankey.links.filter((link) => processIds.has(link.source) && processIds.has(link.target)).map((link) => ({
        ...link,
        source: link.target,
        target: link.source,
      }))
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
    ;(outgoing.get(nodeId) ?? []).forEach((link) => {
      processSet.add(link.target)
      upstreamProcesses(link.target, next).forEach((id) => processSet.add(id))
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
  const rootIds = new Set(processNodes.filter((node) => !(incoming.get(node.id)?.length)).map((node) => node.id))
  const eligibleNodes = processNodes.filter((node) => rootIds.has(node.id) || !totalMagnitude || Math.abs(upstreamTotal(node.id) / selectedTotal * 100) >= minContribution)
  const visibleNodes = [...eligibleNodes]
    .sort((left, right) => depth(right.id) - depth(left.id))
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
  const productRoot = visibleNodes.find((node) => !(incoming.get(node.id)?.length))
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
  if (orientation === "vertical" && productRoot) {
    const rankById = new Map<string, number>([[productRoot.id, 0]])
    const rankQueue = [productRoot.id]
    while (rankQueue.length) {
      const parentId = rankQueue.shift()!
      const childRank = rankById.get(parentId)! + 1
      ;(outgoing.get(parentId) ?? []).forEach((link) => {
        const currentRank = rankById.get(link.target)
        if (currentRank !== undefined && currentRank <= childRank) return
        rankById.set(link.target, childRank)
        rankQueue.push(link.target)
      })
    }
    const rootY = positions.get(productRoot.id)?.y ?? 0
    const fallbackRank = Math.max(1, ...rankById.values()) + 1
    visibleNodes.forEach((node) => {
      const position = positions.get(node.id)
      if (!position) return
      positions.set(node.id, {
        ...position,
        y: rootY + (rankById.get(node.id) ?? fallbackRank) * (nodeHeight + 260),
      })
    })
    const nodesByRank = new Map<number, typeof visibleNodes>()
    visibleNodes.forEach((node) => {
      const rank = rankById.get(node.id) ?? fallbackRank
      nodesByRank.set(rank, [...(nodesByRank.get(rank) ?? []), node])
    })
    nodesByRank.forEach((rankNodes) => {
      const orderedX = rankNodes.map((node) => positions.get(node.id)?.x ?? 0).sort((left, right) => left - right)
      rankNodes.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true })).forEach((node, index) => {
        const position = positions.get(node.id)
        if (position) positions.set(node.id, { ...position, x: orderedX[index] })
      })
    })
  }
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
    const value = upstreamTotal(link.target)
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
    return edges.map((edge) => {
      const baseWidth = Number(edge.style?.strokeWidth ?? 2)
      return edgeIds.has(edge.id)
        ? {
          ...edge,
          className: "sankey-path-edge is-path-highlighted",
          zIndex: 0,
          animated: false,
          style: {
            ...edge.style,
            "--sankey-dash-length": Math.max(12, baseWidth * 1.5),
            "--sankey-dash-gap": Math.max(10, baseWidth * .9),
            "--sankey-dash-offset": -(Math.max(12, baseWidth * 1.5) + Math.max(10, baseWidth * .9)),
            opacity: 1,
          } as React.CSSProperties,
          labelStyle: { ...edge.labelStyle, fill: "#fde68a", fontWeight: 700 },
        }
        : {
          ...edge,
          className: "sankey-path-edge is-path-dimmed",
          animated: false,
          style: { ...edge.style, opacity: .16 },
          labelStyle: { ...edge.labelStyle, opacity: .2 },
        }
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

function CurrentModelTitle({ title, className = "" }: { title: string; className?: string }) {
  return <span className={cn("current-model-title", className)} aria-label={`Current model: ${title}`} title={title}>{title}</span>
}

function ModelMenu({
  activeDocument,
  catalog,
  sessionDocuments,
  canSave,
  canSaveAs,
  canDownload,
  onNew,
  onSelectCatalog,
  onSelectSession,
  onSave,
  onSaveAs,
  onUpload,
  onDownload,
}: {
  activeDocument: ActiveDocument | null
  catalog: ProductGraphCatalogEntry[]
  sessionDocuments: SessionDocument[]
  canSave: boolean
  canSaveAs: boolean
  canDownload: boolean
  onNew: () => void
  onSelectCatalog: (id: string) => void
  onSelectSession: (id: string) => void
  onSave: () => void
  onSaveAs: () => void
  onUpload: () => void
  onDownload: () => void
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button data-model-menu-trigger className="navbar-menu-trigger model-menu-trigger" variant="ghost" size="sm">Model<ChevronDown data-icon="inline-end" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="navbar-dropdown model-menu-content">
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onNew}><FilePlus2 />New model</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Catalog models</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="navbar-dropdown model-catalog-submenu">
          {catalog.map((item) => {
            const selected = activeDocument?.kind === "catalog" && activeDocument.id === item.id
            return <DropdownMenuItem key={item.id} aria-current={selected ? "true" : undefined} onSelect={() => onSelectCatalog(item.id)}>
              <span className="model-menu-item-title" title={item.filename}>{productGraphLabel(item.name)}</span>{selected ? <Check className="model-menu-check" /> : null}
            </DropdownMenuItem>
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {sessionDocuments.length ? <>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>This session</DropdownMenuLabel>
          {sessionDocuments.map((document) => {
            const selected = activeDocument?.kind === "session" && activeDocument.id === document.id
            return <DropdownMenuItem key={document.id} aria-current={selected ? "true" : undefined} onSelect={() => onSelectSession(document.id)}>
              <span className="model-menu-item-title">{document.title}</span>{selected ? <Check className="model-menu-check" /> : null}
            </DropdownMenuItem>
          })}
        </DropdownMenuGroup>
      </> : null}
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={!canSave} onSelect={onSave}><SaveIcon />Save</DropdownMenuItem>
        <DropdownMenuItem disabled={!canSaveAs} onSelect={onSaveAs}><CopyPlus />Save As...</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onUpload}><FileUp />Upload YAML...</DropdownMenuItem>
        <DropdownMenuItem disabled={!canDownload} onSelect={onDownload}><Download />Download YAML</DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}

function GraphEditor({ onTitleChange, navbarTarget, active }: { onTitleChange: (title: string) => void; navbarTarget: HTMLDivElement | null; active: boolean }) {
  const { decimalPlaces, showAllDecimalPlaces, formatNumber, theme } = useDisplaySettings()
  const graphDecimalPlaces = showAllDecimalPlaces ? 20 : decimalPlaces
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ProcessNodeData>>(layoutNodes(initialNodes, initialEdges))
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [selected, setSelected] = useState<(NodeMeta & { id: string }) | null>(null)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<View>("graph")
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [pendingConfirmationOpen, setPendingConfirmationOpen] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState("")
  const [saveAsError, setSaveAsError] = useState("")
  const [modelWorkspace, dispatchModelWorkspace] = useReducer(modelWorkspaceReducer, initialModelWorkspace)
  const { activeDocument, sessionDocuments, yamlDraft } = modelWorkspace
  const [appliedYaml, setAppliedYaml] = useState("")
  const [appliedRevision, setAppliedRevision] = useState(0)
  const [productGraphs, setProductGraphs] = useState<ProductGraphCatalogEntry[]>([])
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "unavailable">("loading")
  const [yamlError, setYamlError] = useState("")
  const [resultsMarkdown, setResultsMarkdown] = useState("")
  const [resultsError, setResultsError] = useState("")
  const [contributionError, setContributionError] = useState("")
  const [isCalculating, setIsCalculating] = useState(false)
  const [loadingContributionKeys, setLoadingContributionKeys] = useState<Set<string>>(() => new Set())
  const [lcaResult, setLcaResult] = useState<LcaResult | null>(null)
  const [calculatedRevision, setCalculatedRevision] = useState<number | null>(null)
  const [graphMode, setGraphMode] = useState<"scaled" | "structure">("structure")
  const [showReferenceAmounts, setShowReferenceAmounts] = useState(false)
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
  const lastSelectedRef = useRef<(NodeMeta & { id: string }) | null>(null)
  const navbarUploadRef = useRef<HTMLInputElement>(null)
  const saveAsReturnFocusRef = useRef<HTMLElement | null>(null)
  nodesRef.current = nodes
  edgesRef.current = edges
  appliedRevisionRef.current = appliedRevision
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  useEffect(() => {
    if (view !== "graph" || !active) return
    let fitFrame = 0
    const resizeFrame = requestAnimationFrame(() => {
      fitFrame = requestAnimationFrame(() => fitView({ padding: 0.35, maxZoom: 0.75, duration: 250 }))
    })
    return () => {
      cancelAnimationFrame(resizeFrame)
      cancelAnimationFrame(fitFrame)
    }
  }, [active, fitView, view])
  const availableGraphProcessCount = (() => {
    try {
      return buildGraphFromYaml(appliedYaml, "structure").nodes.filter((node) => node.data.scope !== "background").length
    } catch {
      return Math.max(1, graphMaxProcesses)
    }
  })()

  useEffect(() => setGraphMaxProcesses(availableGraphProcessCount), [availableGraphProcessCount])
  useEffect(() => setShowReferenceAmounts(false), [graphMode, selected?.id])
  const currentModelTitle = activeDocument?.title
    ?? (catalogState === "unavailable" ? "Catalog unavailable" : "Loading product graphs…")
  useEffect(() => onTitleChange(currentModelTitle), [currentModelTitle, onTitleChange])
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
      const referenceInputs = details.exchanges.filter((exchange) => exchange.exchange_type === "technosphere").map((exchange) => ({
        label: exchange.input_name, kind: "background input", color: nodeScopeColors.background,
        amount: exchange.amount, unit: exchange.unit ?? undefined,
      }))
      const referenceOutputs = details.exchanges.filter((exchange) => exchange.exchange_type === "production").map((exchange) => ({
        label: exchange.input_product ?? exchange.input_name, kind: "reference output", color: nodeScopeColors.background,
        amount: exchange.amount, unit: exchange.unit ?? details.unit ?? node.data.backgroundDemandUnit,
      }))
      const referenceBiosphere = details.exchanges.filter((exchange) => exchange.exchange_type === "biosphere").map((exchange) => ({
        label: chemicalFlowLabel(exchange.input_name), amount: exchange.amount, unit: exchange.unit ?? "",
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
            referenceInputs,
            referenceOutputs,
            referenceBiosphere,
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
      const referenceInputs = technosphere.map((exchange) => ({
        label: exchange.input_name, kind: "background input", color: nodeScopeColors.background,
        amount: exchange.amount, unit: exchange.unit ?? undefined,
      }))
      const referenceOutputs = details.exchanges.filter((exchange) => exchange.exchange_type === "production").map((exchange) => ({
        label: exchange.input_product ?? exchange.input_name, kind: "reference output", color: nodeScopeColors.background,
        amount: exchange.amount, unit: exchange.unit ?? details.unit ?? node.data.backgroundDemandUnit,
      }))
      const referenceBiosphere = details.exchanges.filter((exchange) => exchange.exchange_type === "biosphere").map((exchange) => ({
        label: chemicalFlowLabel(exchange.input_name), amount: exchange.amount, unit: exchange.unit ?? "",
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
          referenceInputs,
          referenceOutputs,
          referenceBiosphere,
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
  }, [edges, hydrateBackgroundNode, setEdges, setNodes])

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
        setCatalogState("ready")
        dispatchModelWorkspace({
          type: "load-document",
          document: { ...catalogEntryToDocument(initial), title: productGraphLabel(initial.name) },
        })
        const revision = applyYaml(initial.product_graph)
        if (revision !== null) void calculateSource(initial.product_graph, revision)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not load product graphs from the LCA server."
        setCatalogState("unavailable")
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
      const proposedTitle = yamlFilenameStem(file.name).trim() || "Untitled model"
      const revision = applyYaml(source)
      if (revision === null) {
        dispatchModelWorkspace({
          type: "start-invalid-upload",
          title: proposedTitle,
          filename: file.name,
          yaml: source,
        })
        setView("yaml")
        return
      }
      const title = uniqueSessionTitle(proposedTitle, sessionDocuments)
      const document: SessionDocument = {
        kind: "session",
        id: crypto.randomUUID(),
        title,
        filename: safeYamlFilename(title),
        committedYaml: source,
        source: "upload",
      }
      dispatchModelWorkspace({ type: "commit-new-session", document })
      setView("yaml")
      void calculateSource(source, revision)
    }
    reader.onerror = () => setYamlError("Could not read the selected file.")
    reader.readAsText(file)
  }

  const loadProductGraph = (id: string) => {
    const entry = productGraphs.find((item) => item.id === id)
    if (!entry) return
    const document = { ...catalogEntryToDocument(entry), title: productGraphLabel(entry.name) }
    dispatchModelWorkspace({ type: "load-document", document })
    setYamlError("")
    setView("yaml")
    applyAndCalculateYaml(document.committedYaml, false)
  }

  const loadSessionModel = (id: string) => {
    const document = sessionDocuments.find((item) => item.id === id)
    if (!document) return
    dispatchModelWorkspace({ type: "load-document", document })
    setYamlError("")
    setView("yaml")
    applyAndCalculateYaml(document.committedYaml, false)
  }

  const downloadTextFile = (contents: string, filename: string, type: string) => {
    const url = URL.createObjectURL(new Blob([contents], { type }))
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const connectionCount = edges.length
  const isDirty = yamlDraft !== (activeDocument?.committedYaml ?? "")
  const isTransient = activeDocument?.kind === "new" || activeDocument?.kind === "invalid-upload"
  const hasUncommittedWorkspace = isDirty || isTransient
  const canSave = activeDocument?.kind === "session" && isDirty
  const canSaveAs = yamlDraft.trim().length > 0
  const canDownload = yamlDraft.trim().length > 0

  const suggestedSaveAsName = () => {
    let suggestion = "Untitled model"
    if (activeDocument?.kind === "catalog" || activeDocument?.kind === "session" || activeDocument?.kind === "invalid-upload") {
      suggestion = activeDocument.title
    } else {
      try {
        const source = parse(yamlDraft) as { name?: unknown }
        if (typeof source?.name === "string" && source.name.trim()) suggestion = productGraphLabel(source.name.trim())
      } catch {
        // Keep the transient model suggestion when the draft is incomplete.
      }
    }
    return uniqueSessionTitle(suggestion, sessionDocuments)
  }

  const openSaveAsDialog = () => {
    saveAsReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSaveAsName(suggestedSaveAsName())
    setSaveAsError("")
    setSaveAsOpen(true)
  }

  const openBlankYamlEditor = () => {
    dispatchModelWorkspace({ type: "start-new" })
    setYamlError("")
    setView("yaml")
  }

  const saveSessionModel = () => {
    if (activeDocument?.kind !== "session" || !isDirty) return false
    const revision = applyYaml(yamlDraft)
    if (revision === null) return false
    dispatchModelWorkspace({ type: "commit-active-session", yaml: yamlDraft })
    void calculateSource(yamlDraft, revision)
    return true
  }

  const saveAsSessionModel = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = saveAsName.trim()
    if (!title) { setSaveAsError("Enter a model name."); return }
    if (title.length > 120) { setSaveAsError("Use 120 characters or fewer."); return }
    if (sessionDocuments.some((item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase())) {
      setSaveAsError("A model with this name already exists in this session.")
      return
    }
    const revision = applyYaml(yamlDraft)
    if (revision === null) {
      setSaveAsOpen(false)
      setPendingAction(null)
      setView("yaml")
      return
    }
    const source: SessionDocument["source"] = activeDocument?.kind === "catalog"
      ? "catalog-copy"
      : activeDocument?.kind === "session"
        ? "session-copy"
        : activeDocument?.kind === "invalid-upload"
          ? "upload"
          : "new"
    const document: SessionDocument = {
      kind: "session",
      id: crypto.randomUUID(),
      title,
      filename: safeYamlFilename(title),
      committedYaml: yamlDraft,
      source,
    }
    const destination = pendingAction
    dispatchModelWorkspace({ type: "commit-new-session", document })
    setSaveAsOpen(false)
    setSaveAsError("")
    setPendingAction(null)
    void calculateSource(yamlDraft, revision)
    if (destination) performAction(destination)
  }

  const discardYamlChanges = () => {
    dispatchModelWorkspace({ type: "discard" })
    setYamlError("")
  }

  const downloadCurrentYaml = () => {
    downloadTextFile(yamlDraft, activeDocument?.filename || "untitled-model.yaml", "text/yaml")
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
  if (selected) lastSelectedRef.current = selected
  const inspectorSelection = selected ?? lastSelectedRef.current
  const selectedNode = inspectorSelection ? nodes.find((node) => node.id === inspectorSelection.id) : undefined
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
  const backgroundProcessing = nodes.some((node) => node.data.backgroundExploring || node.data.backgroundLoading)

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

  function performAction(action: PendingAction) {
    if (action.kind === "view") continueToView(action.view)
    else if (action.kind === "catalog") loadProductGraph(action.id)
    else if (action.kind === "session") loadSessionModel(action.id)
    else if (action.kind === "new") openBlankYamlEditor()
    else navbarUploadRef.current?.click()
  }

  const requestAction = (action: PendingAction) => {
    if (hasUncommittedWorkspace && !(action.kind === "view" && action.view === "yaml")) {
      setPendingAction(action)
      setPendingConfirmationOpen(true)
      return
    }
    performAction(action)
  }

  const requestView = (next: View) => {
    requestAction({ kind: "view", view: next })
  }

  const cancelPendingAction = () => {
    setPendingConfirmationOpen(false)
    setPendingAction(null)
  }

  const discardAndContinue = () => {
    if (!pendingAction) return
    const destination = pendingAction
    setPendingConfirmationOpen(false)
    setPendingAction(null)
    discardYamlChanges()
    performAction(destination)
  }

  const saveAndContinue = () => {
    if (!pendingAction) return
    const destination = pendingAction
    setPendingConfirmationOpen(false)
    if (!saveSessionModel()) {
      setPendingAction(null)
      setView("yaml")
      return
    }
    setPendingAction(null)
    performAction(destination)
  }

  const saveAsAndContinue = () => {
    setPendingConfirmationOpen(false)
    openSaveAsDialog()
  }

  return (
    <>
      {navbarTarget ? createPortal(<div className="desktop-navbar" aria-label="Application navigation">
        <CurrentModelTitle title={currentModelTitle} className="navbar-model-title" />
        <ModelMenu
          activeDocument={activeDocument}
          catalog={productGraphs}
          sessionDocuments={sessionDocuments}
          canSave={canSave}
          canSaveAs={canSaveAs}
          canDownload={canDownload}
          onNew={() => requestAction({ kind: "new" })}
          onSelectCatalog={(id) => requestAction({ kind: "catalog", id })}
          onSelectSession={(id) => requestAction({ kind: "session", id })}
          onSave={saveSessionModel}
          onSaveAs={openSaveAsDialog}
          onUpload={() => requestAction({ kind: "upload" })}
          onDownload={downloadCurrentYaml}
        />
        <input ref={navbarUploadRef} className="navbar-file-input" type="file" accept=".yaml,.yml,text/yaml" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; loadYamlFile(file) }} />
        <ToggleGroup type="single" value={primaryView} onValueChange={(next) => next && requestView(next as "graph" | "yaml")} className="desktop-primary-nav" aria-label="Primary views">
          <ToggleGroupItem value="graph">Graph</ToggleGroupItem>
          <ToggleGroupItem value="yaml">Editor</ToggleGroupItem>
        </ToggleGroup>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className={`navbar-menu-trigger${analysisView || primaryView === "results" ? " is-active" : ""}`} variant="ghost" size="sm" aria-label="Results">Results<ChevronDown data-icon="inline-end" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="navbar-dropdown">
            <DropdownMenuLabel>Analysis views</DropdownMenuLabel>
            <DropdownMenuGroup>
              {([
                ["results", "LCA results"],
                ["inventory", "Inventory"],
                ["impact", "Impact analysis"],
                ["process", "Process results"],
                ["contribution", "Contributions"],
                ["sankey", "Sankey"],
              ] as const).map(([resultView, label]) => {
                const selected = view === resultView
                return <DropdownMenuItem key={resultView} aria-current={selected ? "true" : undefined} onSelect={() => requestView(resultView)} disabled={resultView !== "results" && !hasCurrentResults}>
                  <span className="model-menu-item-title">{label}</span>{selected ? <Check className="model-menu-check" /> : null}
                </DropdownMenuItem>
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {calculationInProgress ? <span className="calculation-message navbar-status" role="status" aria-label="LCA calculation in progress">Calculating…</span>
          : backgroundProcessing ? <span className="calculation-message navbar-status" role="status" aria-label="Background graph processing">Processing…</span> : null}
      </div>, navbarTarget) : null}
      <div className="canvas-wrap">
        <div className="canvas-head">
          <div className="canvas-actions">
            <div className="view-tabs">
              <div className="navigation-model-group">
                <CurrentModelTitle title={currentModelTitle} className="navigation-model-title" />
                <ModelMenu
                  activeDocument={activeDocument}
                  catalog={productGraphs}
                  sessionDocuments={sessionDocuments}
                  canSave={canSave}
                  canSaveAs={canSaveAs}
                  canDownload={canDownload}
                  onNew={() => requestAction({ kind: "new" })}
                  onSelectCatalog={(id) => requestAction({ kind: "catalog", id })}
                  onSelectSession={(id) => requestAction({ kind: "session", id })}
                  onSave={saveSessionModel}
                  onSaveAs={openSaveAsDialog}
                  onUpload={() => requestAction({ kind: "upload" })}
                  onDownload={downloadCurrentYaml}
                />
              </div>
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
            <div><strong>Product graph YAML</strong><span>{isTransient ? "Start writing YAML, or upload an existing model from the Model menu." : activeDocument?.kind === "catalog" ? "Edit this catalog example, then save a session copy." : "Edit the current session model."}</span></div>
          </div>
          <textarea value={yamlDraft} onChange={(event) => { dispatchModelWorkspace({ type: "edit-draft", yaml: event.target.value }); setYamlError("") }} spellCheck={false} aria-label="Product graph YAML" />
          <div className="yaml-editor-foot">
            <span className={yamlError ? "yaml-error" : isDirty ? "yaml-dirty" : ""}>{yamlError || (!yamlDraft.trim() ? "Start writing YAML, or upload a model from the Model menu." : isDirty ? activeDocument?.kind === "session" ? "Unsaved changes. Save to update this session model." : "Unsaved draft. Save As to create a session model." : isCalculating ? "Calculating the saved YAML…" : activeDocument?.kind === "catalog" ? "Catalog model loaded as an immutable example." : "Saved in this browser session.")}</span>
            {activeDocument?.kind === "session" && isDirty ? <Button size="sm" onClick={saveSessionModel}><SaveIcon data-icon="inline-start" />Save</Button>
              : activeDocument?.kind === "catalog" || isTransient ? <Button size="sm" disabled={!canSaveAs} onClick={openSaveAsDialog}><CopyPlus data-icon="inline-start" />Save As...</Button>
                : null}
          </div>
        </div> : view === "inventory" ? <InventoryView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError} /> : view === "impact" ? <ImpactAnalysisView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError || contributionError} loadContributionGraphs={loadContributionGraphs} /> : view === "process" && hasCurrentResults && lcaResult ? <ProcessResultsView result={lcaResult} yaml={appliedYaml} /> : view === "contribution" ? <ContributionView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError || contributionError} loadContributionGraphs={loadContributionGraphs} /> : view === "sankey" && hasCurrentResults && lcaResult ? <SankeyView result={lcaResult} loadContributionGraphs={loadContributionGraphs} /> : <div className="results-panel">
          <div className="results-panel-head">
            <div><strong>LCA Results</strong>{isCalculating ? <span className="calculation-message">Calculating…</span> : null}</div>
          </div>
          <div className="results-panel-body">
            {resultsError ? <div className="results-error"><strong>Calculation failed</strong><p>{resultsError}</p></div>
              : resultsMarkdown ? <article className="markdown-report"><ReactMarkdown remarkPlugins={[remarkGfm]}>{resultsMarkdown}</ReactMarkdown></article>
              : <div className="results-placeholder"><div className="results-empty-icon"><BarChart3 size={22} /></div><strong>No LCA results yet</strong><p>Save a valid model to analyze its product graph.</p></div>}
          </div>
        </div>}
        {view === "graph" ? <div className="graph-meta">{nodes.length} nodes&nbsp;&nbsp;·&nbsp;&nbsp;{connectionCount} connections</div> : null}
      </div>

      {view === "graph" && inspectorSelection ? <aside className={`inspector${selected ? " is-open" : ""}`} aria-hidden={!selected} inert={!selected}>
        <>
          <div className="inspector-head"><span>NODE DETAILS</span><Button variant="ghost" size="icon" onClick={() => setSelected(null)} aria-label="Close property editor" title="Close property editor"><X size={16} /></Button></div>
          <div className="node-icon" style={{ background: selectedNode?.data.color ?? inspectorSelection.color }}><Box size={22} /></div>
          <h2>{selectedNode?.data.label ?? inspectorSelection.label}</h2><p>{selectedNode?.data.detail ?? inspectorSelection.detail}</p>
          {graphMode === "structure" ? <Button variant="outline" size="sm" className="reference-amounts-toggle" aria-pressed={showReferenceAmounts} onClick={() => setShowReferenceAmounts((current) => !current)}>{showReferenceAmounts ? "Hide reference amounts" : "Reference amounts"}</Button> : null}
          {graphMode === "structure" && showReferenceAmounts && selectedNode ? <>
            <div className="property-section">
              <h3>Technosphere inputs</h3>
              {selectedNode.data.referenceInputs?.length ? selectedNode.data.referenceInputs.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{formatNumber(item.amount ?? 0)}{item.unit ? ` ${item.unit}` : ""}</strong></div>) : <p>No technosphere inputs</p>}
            </div>
            <div className="property-section">
              <h3>Reference output</h3>
              {selectedNode.data.referenceOutputs?.length ? selectedNode.data.referenceOutputs.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{formatNumber(item.amount ?? 0)}{item.unit ? ` ${item.unit}` : ""}</strong></div>) : <p>No production exchange</p>}
            </div>
            {selectedNode.data.referenceExtractions?.length ? <div className="property-section is-extraction">
              <h3>Resource extractions</h3>
              {selectedNode.data.referenceExtractions.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{formatNumber(item.amount ?? 0)} {item.unit}</strong></div>)}
            </div> : null}
            {selectedNode.data.referenceEmissions?.length ? <div className="property-section is-emission">
              <h3>Emissions to air</h3>
              {selectedNode.data.referenceEmissions.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{formatNumber(item.amount ?? 0)} {item.unit}</strong></div>)}
            </div> : null}
            {selectedNode.data.referenceBiosphere?.length ? <div className="property-section is-emission">
              <h3>Biosphere exchanges</h3>
              {selectedNode.data.referenceBiosphere.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{formatNumber(item.amount ?? 0)}{item.unit ? ` ${item.unit}` : ""}</strong></div>)}
            </div> : null}
          </> : selectedNode?.data.scope === "background" ? <>
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
      <AlertDialog open={pendingConfirmationOpen} onOpenChange={(open) => { if (!open) cancelPendingAction() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved YAML changes</AlertDialogTitle>
            <AlertDialogDescription>
              {activeDocument?.kind === "session"
                ? `Save changes to "${activeDocument.title}" before continuing?`
                : "Save a copy before continuing?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelPendingAction}>Keep editing</AlertDialogCancel>
            <Button variant="destructive" onClick={discardAndContinue}>Discard changes</Button>
            {activeDocument?.kind === "session"
              ? <Button onClick={saveAndContinue}>Save</Button>
              : <Button disabled={!canSaveAs} onClick={saveAsAndContinue}>Save As...</Button>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={saveAsOpen} onOpenChange={(open) => { setSaveAsOpen(open); if (!open) { setSaveAsError(""); setPendingAction(null) } }}>
        <DialogContent onCloseAutoFocus={(event) => {
          event.preventDefault()
          const fallback = [...document.querySelectorAll<HTMLElement>("[data-model-menu-trigger]")].find((element) => element.offsetParent !== null)
          const target = saveAsReturnFocusRef.current?.isConnected ? saveAsReturnFocusRef.current : fallback
          target?.focus()
        }}>
          <form className="save-as-form" onSubmit={saveAsSessionModel}>
            <DialogHeader>
              <DialogTitle>Save model as</DialogTitle>
              <DialogDescription>Create a writable model for this browser session. It will not survive a page refresh.</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field data-invalid={Boolean(saveAsError)}>
                <FieldLabel htmlFor="save-as-model-name">Model name</FieldLabel>
                <Input id="save-as-model-name" value={saveAsName} maxLength={120} aria-invalid={Boolean(saveAsError)} autoFocus onChange={(event) => { setSaveAsName(event.target.value); setSaveAsError("") }} />
                <FieldError>{saveAsError}</FieldError>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setSaveAsOpen(false); setPendingAction(null) }}>Cancel</Button>
              <Button type="submit">Save As</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function WelcomeShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext("webgl")
    if (!gl) return

    const vertexSource = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `
    const fragmentSource = `
      precision highp float;
      uniform float u_time;
      uniform vec2 u_resolution;
      uniform vec2 u_mouse;
      varying vec2 v_texCoord;

      vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod(i, 289.0);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m;
        m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      void main() {
        vec2 uv = v_texCoord;
        vec2 center = u_mouse / u_resolution;
        float noise1 = snoise(uv * 1.2 + u_time * 0.04);
        float noise2 = snoise(uv * 2.0 - u_time * 0.06);
        vec3 deepBg = vec3(0.035, 0.043, 0.055);
        vec3 primaryViolet = vec3(0.545, 0.361, 0.965);
        vec3 indigo = vec3(0.388, 0.4, 0.945);
        vec3 accentCyan = vec3(0.22, 0.741, 0.973);
        float mask1 = smoothstep(-0.2, 0.8, noise1);
        float mask2 = smoothstep(-0.5, 0.5, noise2);
        float dist = distance(uv, center);
        float mousePulse = smoothstep(0.5, 0.0, dist) * 0.2;
        vec3 color = mix(deepBg, primaryViolet, mask1 * 0.35);
        color = mix(color, indigo, mask2 * 0.25);
        color = mix(color, accentCyan, (mask1 * mask2) * 0.1);
        float refraction = pow(abs(noise1 + noise2), 5.0) * 0.12;
        color += refraction * accentCyan;
        color += mousePulse * primaryViolet;
        gl_FragColor = vec4(color, 1.0);
      }
    `
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader)
        return null
      }
      return shader
    }
    const vertexShader = compile(gl.VERTEX_SHADER, vertexSource)
    const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource)
    if (!vertexShader || !fragmentShader) return
    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, "a_position")
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const timeUniform = gl.getUniformLocation(program, "u_time")
    const resolutionUniform = gl.getUniformLocation(program, "u_resolution")
    const mouseUniform = gl.getUniformLocation(program, "u_mouse")
    let mouseX = window.innerWidth / 2
    let mouseY = window.innerHeight / 2
    let frame = 0

    const syncSize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    const trackMouse = (event: MouseEvent) => {
      mouseX = event.clientX
      mouseY = canvas.height - event.clientY
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const render = (timestamp: number) => {
      gl.viewport(0, 0, canvas.width, canvas.height)
      if (timeUniform) gl.uniform1f(timeUniform, timestamp * .001)
      if (resolutionUniform) gl.uniform2f(resolutionUniform, canvas.width, canvas.height)
      if (mouseUniform) gl.uniform2f(mouseUniform, mouseX, mouseY)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (!reduceMotion) frame = requestAnimationFrame(render)
    }
    syncSize()
    window.addEventListener("resize", syncSize)
    window.addEventListener("mousemove", trackMouse)
    frame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", syncSize)
      window.removeEventListener("mousemove", trackMouse)
      if (buffer) gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
    }
  }, [])

  return <canvas ref={canvasRef} className="welcome-shader" aria-hidden="true" />
}

function WelcomePage({ onExplore }: { onExplore: () => void }) {
  return <section className="welcome-page" aria-labelledby="welcome-title">
    <WelcomeShader />
    <div className="welcome-aurora" aria-hidden="true" />
    <div className="welcome-panel">
      <div className="welcome-panel-glow" aria-hidden="true" />
      <div className="welcome-copy">
        <div>
          <div className="welcome-brand-mark" aria-hidden="true"><img src={prismLogoRound} alt="" /></div>
          <h1 id="welcome-title">Welcome to the Future of LCA</h1>
          <p>A precision-engineered workspace for product graph modeling and life-cycle assessment. Uncover environmental impacts with uncompromising detail.</p>
          <Button className="welcome-explore" variant="outline" onClick={onExplore}>Explore PRISM <ArrowRight size={14} /></Button>
        </div>
        <dl className="welcome-context">
          <div><dt>Current context</dt><dd>Global Supply Chain</dd></div>
          <div><dt>Status</dt><dd className="is-ready"><span />Ready</dd></div>
        </dl>
      </div>
      <div className="welcome-graph" aria-label="Product graph preview">
        <svg className="welcome-connections" viewBox="0 0 580 716" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="welcome-line-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity=".4" />
              <stop offset="50%" stopColor="#a78bfa" stopOpacity=".85" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity=".4" />
            </linearGradient>
          </defs>
          <path d="M 210 205 C 345 205, 270 315, 405 315" />
          <path d="M 405 315 C 350 430, 390 455, 310 525" />
        </svg>
        <article className="welcome-node is-raw">
          <header><i /><span>Raw Material Extraction</span></header>
          <div><span>Mass</span><strong>120.5 kg</strong></div>
        </article>
        <article className="welcome-node is-processing">
          <header><Factory size={14} /><span>Primary Processing</span></header>
          <div><span>Energy</span><strong>45.2 kWh</strong></div>
        </article>
        <article className="welcome-node is-transport">
          <header><i /><span>Transport to Facility</span></header>
          <div><span>Distance</span><strong>450 km</strong></div>
        </article>
      </div>
    </div>
  </section>
}

function AppContent() {
  const [welcomeOpen, setWelcomeOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [workspaceTitle, setWorkspaceTitle] = useState("Loading product graphs…")
  const [navbarTarget, setNavbarTarget] = useState<HTMLDivElement | null>(null)
  const { decimalPlaces, setDecimalPlaces, showAllDecimalPlaces, setShowAllDecimalPlaces, theme, setTheme } = useDisplaySettings()

  return (
    <TooltipProvider delayDuration={250}>
      <main className={`app-shell theme-${theme}`}>
        {welcomeOpen ? <WelcomePage onExplore={() => setWelcomeOpen(false)} /> : null}
        <header className="topbar" hidden={welcomeOpen}>
          <div className="brand"><button className="brand-home" type="button" onClick={() => setWelcomeOpen(true)} aria-label="Open PRISM welcome page"><span className="brand-mark"><img src={prismLogoRound} alt="" aria-hidden="true" /></span></button><span className="brand-product-name"><span>PRISM</span><span className="brand-product-descriptor"> Life Cycle Assessment</span></span><span className="brand-separator">·</span><h1 className="brand-study-title">{workspaceTitle}</h1></div>
          <div ref={setNavbarTarget} className="navbar-portal-target" />
          <div className="top-actions">
            <Popover modal open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" className={`global-settings-trigger ${settingsOpen ? "is-active" : ""}`} type="button" aria-label="Global settings"><Globe2 size={16} /><span>Settings</span></Button>
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

        <section className="workspace" hidden={welcomeOpen}>
          <ReactFlowProvider>
            <GraphEditor onTitleChange={setWorkspaceTitle} navbarTarget={navbarTarget} active={!welcomeOpen} />
          </ReactFlowProvider>
        </section>
      </main>
    </TooltipProvider>
  )
}

export default function App() {
  return <DisplaySettingsProvider><AppContent /></DisplaySettingsProvider>
}
