import { useCallback, useEffect, useRef, useState } from "react"
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant,
  useNodesState, useEdgesState, useReactFlow, useNodesInitialized,
  type Node, type Edge,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import * as Tooltip from "@radix-ui/react-tooltip"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  BarChart3, Box, Scan, LayoutGrid, ChevronDown,
  FileUp, Maximize, Minus, MousePointer2, Plus, Search, Share2,
} from "lucide-react"
import { Button } from "./components/ui/button"
import { ProcessNode, type ProcessNodeData } from "./components/ProcessNode"
import { layoutNodes } from "./lib/layout"
import { chemicalFlowLabel } from "./lib/flowLabels"
import { buildGraphFromYaml, buildInventoryRequirements, nodeScopeColors } from "./lib/yamlGraph"
import { calculateLca, getBackgroundActivityDetails, impactCategoryAbbreviation, lcaResultToMarkdown, type LcaResult } from "./lib/lcaApi"
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

function InventoryView({ result, yaml, isCurrent, calculating, error, onCalculate }: {
  result: LcaResult | null
  yaml: string
  isCurrent: boolean
  calculating: boolean
  error: string
  onCalculate: () => void
}) {
  if (!result || !isCurrent) return <div className="results-panel inventory-panel">
    <div className="results-panel-head"><div><strong>Inventory results</strong><span>Calculated quantities for the current product graph.</span></div><Button onClick={onCalculate} disabled={calculating}>{calculating ? "Calculating…" : "Calculate LCA"}</Button></div>
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

function ContributionView({ result, yaml, isCurrent, calculating, error, onCalculate }: {
  result: LcaResult | null
  yaml: string
  isCurrent: boolean
  calculating: boolean
  error: string
  onCalculate: () => void
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
    <div className="results-panel-head"><div><strong>Contribution analysis</strong><span>Compare process contributions by inventory flow or impact category.</span></div><Button onClick={onCalculate} disabled={calculating}>{calculating ? "Calculating…" : "Calculate LCA"}</Button></div>
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
  const [view, setView] = useState<"graph" | "yaml" | "inventory" | "contribution" | "sankey" | "results">("graph")
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
  const initialFitDoneRef = useRef(false)
  const editorOpenRef = useRef(false)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  nodesRef.current = nodes
  edgesRef.current = edges
  const { fitView, getViewport, setViewport, zoomIn, zoomOut } = useReactFlow()
  const nodesInitialized = useNodesInitialized()

  useEffect(() => {
    if (!nodesInitialized || initialFitDoneRef.current) return
    const timer = window.setTimeout(() => {
      initialFitDoneRef.current = true
      void fitView({ nodes: nodesRef.current, padding: 0.35, maxZoom: 0.75, duration: 0 })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [fitView, nodesInitialized])

  useEffect(() => {
    if (!selected) {
      editorOpenRef.current = false
      return
    }
    if (!nodesInitialized || editorOpenRef.current) return
    editorOpenRef.current = true
    const timer = window.setTimeout(() => {
      const viewport = getViewport()
      void setViewport({ ...viewport, x: viewport.x - 260 }, { duration: 250 })
    }, 50)
    return () => window.clearTimeout(timer)
  }, [getViewport, nodesInitialized, selected, setViewport])

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
  const relayout = () => setNodes((current) => layoutNodes(current, edges))

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
              <button className={view === "inventory" ? "is-active" : ""} onClick={() => setView("inventory")}>Inventory</button>
              <button className={view === "contribution" ? "is-active" : ""} onClick={() => setView("contribution")}>Contribution</button>
              <button className={view === "sankey" ? "is-active" : ""} onClick={() => setView("sankey")}>Sankey Graph</button>
            </div>
          </div>
        </div>
        {view === "graph" ? <><ReactFlow
          className={`reactflow-canvas ${selected ? "with-inspector" : ""}`}
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
          fitView
          fitViewOptions={{ padding: 0.35, maxZoom: 0.75 }}
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
        </div> : view === "inventory" ? <InventoryView result={lcaResult} yaml={yamlText} isCurrent={calculatedYaml === yamlText} calculating={isCalculating} error={resultsError} onCalculate={runCalculation} /> : view === "contribution" ? <ContributionView result={lcaResult} yaml={yamlText} isCurrent={calculatedYaml === yamlText} calculating={isCalculating} error={resultsError} onCalculate={runCalculation} /> : view === "sankey" ? <div className="results-empty">
          <span className="not-implemented">NOT IMPLEMENTED YET</span>
          <div className="results-empty-icon"><Share2 size={22} /></div>
          <strong>Sankey Graph</strong>
          <p>A Sankey view of material and environmental flows will appear here.</p>
        </div> : <div className="results-panel">
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

      {view === "graph" && selected ? <aside className="inspector is-open">
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
