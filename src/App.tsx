import { useCallback, useEffect, useRef, useState } from "react"
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
  ArrowRight, BarChart3, Bot, Box, Check, Component, CopyPlus, Scan, LayoutGrid, ChevronDown, Download, Factory, FilePlus2, Globe2,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { NumberStepper } from "@/components/NumberStepper"
import { AiChatPanel } from "@/components/AiChatPanel"
import { RealtimeView } from "@/components/RealtimeView"
import type { AppToolRuntime, SwitchViewOutcome } from "@/ai/viewTools"
import { ProcessNode, type ProcessNodeData } from "./components/ProcessNode"
import { layoutNodes } from "./lib/layout"
import { chemicalFlowLabel } from "./lib/flowLabels"
import { buildGraphFromYaml, nodeScopeColors } from "./lib/yamlGraph"
import {
  calculateContributionGraphs, calculateLca, getBackgroundActivityDetails, getProductGraphTemplates, impactCategoryDisplayName, lcaResultToMarkdown,
  type ContributionGraph, type LcaResult, type ProductGraphTemplate,
} from "./lib/lcaApi"
import { applyScenarioToYaml, backgroundLinks } from "./lib/realtimeScore"
import { ImpactAnalysisView } from "@/components/views/ImpactAnalysisView"
import { AppSelect, CurrentModelTitle, ToolButton } from "@/components/common/AppControls"
import { ContributionView } from "@/components/views/ContributionView"
import { InventoryView } from "@/components/views/InventoryView"
import { ProcessResultsView } from "@/components/views/ProcessResultsView"
import { inventoryFlowName, productGraphLabel } from "./lib/resultFormatting"
import { unitsAreCompatible } from "./lib/units"
import { DisplaySettingsProvider, useDisplaySettings } from "./lib/displaySettings"
import {
  templateToDocument, safeYamlFilename,
  uniqueSessionTitle, yamlFilenameStem, type ActiveDocument, type SessionDocument,
} from "./lib/modelWorkspace"
import {
  selectHasCurrentResults,
  useProductGraphStore,
  type ProductGraphView as View,
} from "./state/productGraphStore"
type NodeMeta = { label: string; kind: string; detail: string; color: string; scope?: "foreground" | "background" }
type AnalysisView = Extract<View, "inventory" | "impact" | "process" | "contribution" | "sankey" | "realtime">
type PendingAction =
  | { kind: "view"; view: View }
  | { kind: "template"; id: string }
  | { kind: "session"; id: string }
  | { kind: "new" }
  | { kind: "upload" }
const analysisViews: AnalysisView[] = ["inventory", "impact", "process", "contribution", "sankey", "realtime"]
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

function FileMenu({
  activeDocument,
  templates,
  sessionDocuments,
  canSave,
  canSaveAs,
  canDownload,
  onNew,
  onSelectTemplate,
  onSelectSession,
  onSave,
  onSaveAs,
  onUpload,
  onDownload,
}: {
  activeDocument: ActiveDocument | null
  templates: ProductGraphTemplate[]
  sessionDocuments: SessionDocument[]
  canSave: boolean
  canSaveAs: boolean
  canDownload: boolean
  onNew: () => void
  onSelectTemplate: (id: string) => void
  onSelectSession: (id: string) => void
  onSave: () => void
  onSaveAs: () => void
  onUpload: () => void
  onDownload: () => void
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button data-file-menu-trigger className="navbar-menu-trigger model-menu-trigger" variant="ghost" size="sm">File<ChevronDown data-icon="inline-end" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="navbar-dropdown model-menu-content">
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onNew}><FilePlus2 />New...</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Templates...</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="navbar-dropdown template-submenu">
          {templates.map((item) => {
            const selected = activeDocument?.kind === "template" && activeDocument.id === item.id
            return <DropdownMenuItem key={item.id} aria-current={selected ? "true" : undefined} onSelect={() => onSelectTemplate(item.id)}>
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

function GraphEditor({ onTitleChange, navbarTarget, chatPortalTarget, active, chatOpen, onChatOpenChange }: { onTitleChange: (title: string) => void; navbarTarget: HTMLDivElement | null; chatPortalTarget: HTMLDivElement | null; active: boolean; chatOpen: boolean; onChatOpenChange: (open: boolean) => void }) {
  const { decimalPlaces, showAllDecimalPlaces, formatNumber, theme } = useDisplaySettings()
  const graphDecimalPlaces = showAllDecimalPlaces ? 20 : decimalPlaces
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ProcessNodeData>>(layoutNodes(initialNodes, initialEdges))
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const selected = useProductGraphStore((state) => state.selectedNode)
  const [query, setQuery] = useState("")
  const view = useProductGraphStore((state) => state.activeView)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [pendingConfirmationOpen, setPendingConfirmationOpen] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState("")
  const [saveAsError, setSaveAsError] = useState("")
  const activeDocument = useProductGraphStore((state) => state.activeDocument)
  const sessionDocuments = useProductGraphStore((state) => state.sessionDocuments)
  const yamlDraft = useProductGraphStore((state) => state.yamlDraft)
  const appliedYaml = useProductGraphStore((state) => state.appliedYaml)
  const appliedRevision = useProductGraphStore((state) => state.appliedRevision)
  const [templates, setTemplates] = useState<ProductGraphTemplate[]>([])
  const [templateState, setTemplateState] = useState<"loading" | "ready" | "unavailable">("loading")
  const [yamlError, setYamlError] = useState("")
  const [resultsMarkdown, setResultsMarkdown] = useState("")
  const resultsError = useProductGraphStore((state) => state.calculationError)
  const [contributionError, setContributionError] = useState("")
  const calculationStatus = useProductGraphStore((state) => state.calculationStatus)
  const isCalculating = calculationStatus === "calculating"
  const [loadingContributionKeys, setLoadingContributionKeys] = useState<Set<string>>(() => new Set())
  const lcaResult = useProductGraphStore((state) => state.lcaResult)
  const calculatedRevision = useProductGraphStore((state) => state.calculatedRevision)
  const scenarioOverrides = useProductGraphStore((state) => state.scenarioOverrides)
  const graphMode = useProductGraphStore((state) => state.graphMode)
  const showReferenceAmounts = useProductGraphStore((state) => state.showReferenceAmounts)
  const [graphSettingsOpen, setGraphSettingsOpen] = useState(false)
  const graphMaxProcesses = useProductGraphStore((state) => state.graphMaxProcesses)
  const graphOrientation = useProductGraphStore((state) => state.graphOrientation)
  const graphConnectionStyle = useProductGraphStore((state) => state.graphConnectionStyle)
  const storeActions = useProductGraphStore((state) => state.actions)
  const {
    requestViewChange: setView,
    selectNode: setSelected,
    clearNodeSelection,
    setGraphMode,
    setReferenceAmountsVisible,
    setGraphMaxProcesses,
    setGraphOrientation,
    setGraphConnectionStyle,
    dispatchWorkspace: dispatchModelWorkspace,
    applySource,
    startCalculation,
    completeCalculation,
    failCalculation,
    finishCalculation,
    mergeContributionGraphs,
    setScenarioOverride,
    resetScenario,
  } = storeActions
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
  useEffect(() => {
    if (!chatPortalTarget || view !== "graph" || !active) return
    let fitFrame = 0
    let previousWidth = chatPortalTarget.getBoundingClientRect().width
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry.contentRect.width
      if (Math.abs(nextWidth - previousWidth) < 1) return
      previousWidth = nextWidth
      cancelAnimationFrame(fitFrame)
      fitFrame = requestAnimationFrame(() => fitView({ padding: 0.35, maxZoom: 0.75 }))
    })
    observer.observe(chatPortalTarget)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(fitFrame)
    }
  }, [active, chatPortalTarget, fitView, view])
  const availableGraphProcessCount = (() => {
    try {
      return buildGraphFromYaml(appliedYaml, "structure").nodes.filter((node) => node.data.scope !== "background").length
    } catch {
      return Math.max(1, graphMaxProcesses)
    }
  })()

  useEffect(() => setGraphMaxProcesses(availableGraphProcessCount), [availableGraphProcessCount, setGraphMaxProcesses])
  useEffect(() => setReferenceAmountsVisible(false), [graphMode, selected?.id, setReferenceAmountsVisible])
  const currentModelTitle = activeDocument?.title
    ?? (templateState === "unavailable" ? "Templates unavailable" : "Loading templates…")
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
      const nextRevision = applySource(source)
      appliedRevisionRef.current = nextRevision
      foldDirectionRef.current = "upstream"
      setEdges(parsed.edges)
      setNodes(layoutNodes(parsed.nodes.map((node) => ({
        ...node,
        data: { ...node.data, canFold: parsed.edges.some((edge) => edge.target === node.id) },
      })), parsed.edges, { orientation: graphOrientation }))
      setYamlError("")
      setResultsMarkdown("")
      setContributionError("")
      contributionRequestsRef.current.clear()
      setLoadingContributionKeys(new Set())
      requestAnimationFrame(() => requestAnimationFrame(() => fitView({ padding: 0.35, maxZoom: 0.75, duration: 350 })))
      return nextRevision
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : "Could not parse this YAML file.")
      return null
    }
  }

  const commitScenario = () => {
    if (!lcaResult) return
    const source = applyScenarioToYaml(appliedYaml, backgroundLinks(lcaResult), scenarioOverrides)
    if (source === appliedYaml) return
    dispatchModelWorkspace({ type: "edit-draft", yaml: source })
    const revision = applyYaml(source)
    if (revision === null) return
    void calculateSource(source, revision)
  }

  const calculateSource = async (source: string, revision: number, openGraphWhenReady = false) => {
    activeCalculationRef.current?.abort()
    const controller = new AbortController()
    activeCalculationRef.current = controller
    startCalculation()
    setContributionError("")
    contributionRequestsRef.current.clear()
    setLoadingContributionKeys(new Set())
    try {
      const result = await calculateLca(source, controller.signal)
      if (controller.signal.aborted || appliedRevisionRef.current !== revision) return
      completeCalculation(result, revision)
      setResultsMarkdown(lcaResultToMarkdown(result, decimalPlaces, showAllDecimalPlaces))
      if (openGraphWhenReady) setView("graph")
    } catch (error) {
      if (controller.signal.aborted || appliedRevisionRef.current !== revision) return
      failCalculation(error instanceof Error ? error.message : "Could not calculate the current product graph.")
    } finally {
      if (activeCalculationRef.current === controller) {
        activeCalculationRef.current = null
        finishCalculation()
      }
    }
  }

  useEffect(() => {
    if (initialCalculationStartedRef.current) return
    initialCalculationStartedRef.current = true
    void (async () => {
      try {
        const templateCollection = await getProductGraphTemplates()
        const initial = templateCollection.product_graphs.find((item) => item.id === WEBAPP_DEFAULT_PRODUCT_GRAPH_ID)
          ?? templateCollection.product_graphs.find((item) => item.id === templateCollection.default_id)
        if (!initial) throw new Error("The product-graph templates have no default selection.")
        setTemplates(templateCollection.product_graphs)
        setTemplateState("ready")
        dispatchModelWorkspace({
          type: "load-document",
          document: { ...templateToDocument(initial), title: productGraphLabel(initial.name) },
        })
        const revision = applyYaml(initial.product_graph)
        if (revision !== null) void calculateSource(initial.product_graph, revision)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not load product graphs from the LCA server."
        setTemplateState("unavailable")
        setYamlError(message)
        failCalculation(message)
      }
    })()
    // The initial template load and calculation must run exactly once per app mount.
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
      setView("graph")
      void calculateSource(source, revision)
    }
    reader.onerror = () => setYamlError("Could not read the selected file.")
    reader.readAsText(file)
  }

  const loadTemplate = (id: string) => {
    const entry = templates.find((item) => item.id === id)
    if (!entry) return
    const document = { ...templateToDocument(entry), title: productGraphLabel(entry.name) }
    dispatchModelWorkspace({ type: "load-document", document })
    setYamlError("")
    setView("graph")
    applyAndCalculateYaml(document.committedYaml, false)
  }

  const loadSessionModel = (id: string) => {
    const document = sessionDocuments.find((item) => item.id === id)
    if (!document) return
    dispatchModelWorkspace({ type: "load-document", document })
    setYamlError("")
    setView("graph")
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
    if (activeDocument?.kind === "template" || activeDocument?.kind === "session" || activeDocument?.kind === "invalid-upload") {
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

  const saveAsSessionModelWithName = (proposedName: string) => {
    const title = proposedName.trim()
    if (!title) { setSaveAsError("Enter a model name."); return false }
    if (title.length > 120) { setSaveAsError("Use 120 characters or fewer."); return false }
    if (sessionDocuments.some((item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase())) {
      setSaveAsError("A model with this name already exists in this session.")
      return false
    }
    const revision = applyYaml(yamlDraft)
    if (revision === null) {
      setSaveAsOpen(false)
      setPendingAction(null)
      setView("yaml")
      return false
    }
    const source: SessionDocument["source"] = activeDocument?.kind === "template"
      ? "template-copy"
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
    return true
  }

  const saveAsSessionModel = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    saveAsSessionModelWithName(saveAsName)
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
  const hasCurrentResults = useProductGraphStore(selectHasCurrentResults)
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
          mergeContributionGraphs(batch.result_id, batch.contribution_graphs)
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
    else if (action.kind === "template") loadTemplate(action.id)
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

  const requestAssistantView = (next: View): SwitchViewOutcome => {
    const label = next === "yaml" ? "Edit" : next === "results" ? "LCA results" : next[0].toUpperCase() + next.slice(1)
    if (hasUncommittedWorkspace && next !== "yaml") {
      requestView(next)
      return { status: "confirmation_required", view: next, label, reason: "Confirm how to handle unsaved YAML changes in the application dialog." }
    }
    requestView(next)
    return { status: "completed", view: next, label }
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

  const assistantRuntime: AppToolRuntime = {
    activeView: view,
    hasCurrentResults,
    workspace: {
      activeDocument,
      sessionDocuments,
      yamlDirty: isDirty,
      yamlValid: (() => { try { parse(yamlDraft); return Boolean(yamlDraft.trim()) } catch { return false } })(),
      appliedRevision,
      calculatedRevision,
      calculationStatus,
      calculationError: resultsError,
      contributionLoading: loadingContributionKeys.size > 0,
      yamlDraft,
    },
    templates,
    result: lcaResult,
    graph: {
      nodes: nodes.filter((node) => !node.hidden).map((node) => ({
        id: node.id,
        label: node.data.label,
        kind: node.data.kind,
        detail: node.data.detail,
        color: node.data.color,
        scope: node.data.scope,
        inputCount: edges.filter((edge) => edge.target === node.id && !edge.hidden).length,
        outputCount: edges.filter((edge) => edge.source === node.id && !edge.hidden).length,
        emissionCount: node.data.emissions?.length ?? node.data.referenceEmissions?.length ?? 0,
        extractionCount: node.data.extractions?.length ?? node.data.referenceExtractions?.length ?? 0,
        biosphereCount: node.data.biosphere?.length ?? node.data.referenceBiosphere?.length ?? 0,
      })),
      connectionCount,
      mode: graphMode,
      orientation: graphOrientation,
      connectionStyle: graphConnectionStyle,
      showReferenceAmounts,
      maximumProcesses: graphMaxProcesses,
      selectedNodeId: selected?.id ?? null,
    },
    actions: {
      switchView: requestAssistantView,
      selectNode: (nodeId) => {
        const node = nodes.find((candidate) => candidate.id === nodeId && !candidate.hidden)
        if (!node) return
        setSelected({ id: node.id, label: node.data.label, kind: node.data.kind, detail: node.data.detail, color: node.data.color, scope: node.data.scope })
        requestView("graph")
        if (node.data.scope === "background") void hydrateBackgroundNode(node.id)
      },
      clearNodeSelection,
      setGraphDisplay: (settings) => {
        if (settings.mode) showGraphMode(settings.mode)
        if (settings.orientation) setGraphOrientation(settings.orientation)
        if (settings.connections) setGraphConnectionStyle(settings.connections)
        if (settings.showReferenceAmounts !== undefined) setReferenceAmountsVisible(settings.showReferenceAmounts)
        if (settings.maximumProcesses !== undefined) setGraphMaxProcesses(settings.maximumProcesses)
        if (settings.orientation || settings.connections || settings.maximumProcesses !== undefined) {
          applyGraphSettings({
            orientation: settings.orientation,
            connectionStyle: settings.connections,
            maximum: settings.maximumProcesses,
          })
        }
      },
      fitGraph: fit,
      calculateCurrentModel: () => { void calculateSource(appliedYaml, appliedRevision) },
      saveCurrentModel: saveSessionModel,
      saveModelAs: saveAsSessionModelWithName,
      openModel: (kind, id) => requestAction(kind === "template" ? { kind: "template", id } : { kind: "session", id }),
      newModel: () => requestAction({ kind: "new" }),
      downloadYaml: downloadCurrentYaml,
      exportResults: (format) => {
        if (!lcaResult) return
        const base = safeYamlFilename(currentModelTitle).replace(/\.ya?ml$/i, "")
        if (format === "json") downloadTextFile(JSON.stringify(lcaResult, null, 2), `${base}-lca-results.json`, "application/json")
        else downloadTextFile(resultsMarkdown, `${base}-lca-results.md`, "text/markdown")
      },
      deleteSessionModel: (id) => dispatchModelWorkspace({ type: "delete-session", id }),
    },
  }

  return (
    <>
      {navbarTarget ? createPortal(<div className="desktop-navbar" aria-label="Application navigation">
        <CurrentModelTitle title={currentModelTitle} className="navbar-model-title" />
        <FileMenu
          activeDocument={activeDocument}
          templates={templates}
          sessionDocuments={sessionDocuments}
          canSave={canSave}
          canSaveAs={canSaveAs}
          canDownload={canDownload}
          onNew={() => requestAction({ kind: "new" })}
          onSelectTemplate={(id) => requestAction({ kind: "template", id })}
          onSelectSession={(id) => requestAction({ kind: "session", id })}
          onSave={saveSessionModel}
          onSaveAs={openSaveAsDialog}
          onUpload={() => requestAction({ kind: "upload" })}
          onDownload={downloadCurrentYaml}
        />
        <input ref={navbarUploadRef} className="navbar-file-input" type="file" accept=".yaml,.yml,text/yaml" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; loadYamlFile(file) }} />
        <ToggleGroup type="single" value={primaryView} onValueChange={(next) => next && requestView(next as "graph" | "yaml")} className="desktop-primary-nav" aria-label="Primary views">
          <ToggleGroupItem value="yaml">Edit</ToggleGroupItem>
          <ToggleGroupItem value="graph">Graph</ToggleGroupItem>
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
                ["realtime", "Realtime"],
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
                <FileMenu
                  activeDocument={activeDocument}
                  templates={templates}
                  sessionDocuments={sessionDocuments}
                  canSave={canSave}
                  canSaveAs={canSaveAs}
                  canDownload={canDownload}
                  onNew={() => requestAction({ kind: "new" })}
                  onSelectTemplate={(id) => requestAction({ kind: "template", id })}
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
                  <ToggleGroupItem value="yaml">Edit</ToggleGroupItem>
                  <ToggleGroupItem value="graph">Graph</ToggleGroupItem>
                  <ToggleGroupItem value="results" aria-label="Results">Results</ToggleGroupItem>
                </ToggleGroup>
                <ToggleGroup type="single" value={analysisView} onValueChange={(next) => next && requestView(next as AnalysisView)} className="inline-flex items-center" aria-label="Result analysis views">
                  <ToggleGroupItem value="inventory" disabled={!hasCurrentResults}>Inventory</ToggleGroupItem>
                  <ToggleGroupItem value="impact" disabled={!hasCurrentResults}>Impact Analysis</ToggleGroupItem>
                  <ToggleGroupItem value="process" disabled={!hasCurrentResults}>Process Results</ToggleGroupItem>
                  <ToggleGroupItem value="contribution" disabled={!hasCurrentResults}>Contribution</ToggleGroupItem>
                  <ToggleGroupItem value="sankey" disabled={!hasCurrentResults}>Sankey Graph</ToggleGroupItem>
                  <ToggleGroupItem value="realtime" disabled={!hasCurrentResults}>Realtime</ToggleGroupItem>
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
          onPaneClick={clearNodeSelection}
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
            <div><strong>Product graph YAML</strong><span>{isTransient ? "Start writing YAML, or upload an existing file from the File menu." : activeDocument?.kind === "template" ? "Edit this template, then save a session copy." : "Edit the current session model."}</span></div>
          </div>
          <textarea value={yamlDraft} onChange={(event) => { dispatchModelWorkspace({ type: "edit-draft", yaml: event.target.value }); setYamlError("") }} spellCheck={false} aria-label="Product graph YAML" />
          <div className="yaml-editor-foot">
            <span className={yamlError ? "yaml-error" : isDirty ? "yaml-dirty" : ""}>{yamlError || (!yamlDraft.trim() ? "Start writing YAML, or upload a file from the File menu." : isDirty ? activeDocument?.kind === "session" ? "Unsaved changes. Save to update this session model." : "Unsaved draft. Save As to create a session model." : isCalculating ? "Calculating the saved YAML…" : activeDocument?.kind === "template" ? "Template loaded as an immutable example." : "Saved in this browser session.")}</span>
            {activeDocument?.kind === "session" && isDirty ? <Button size="sm" onClick={saveSessionModel}><SaveIcon data-icon="inline-start" />Save</Button>
              : activeDocument?.kind === "template" || isTransient ? <Button size="sm" disabled={!canSaveAs} onClick={openSaveAsDialog}><CopyPlus data-icon="inline-start" />Save As...</Button>
                : null}
          </div>
        </div> : view === "inventory" ? <InventoryView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError} /> : view === "impact" ? <ImpactAnalysisView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError || contributionError} loadContributionGraphs={loadContributionGraphs} /> : view === "process" && hasCurrentResults && lcaResult ? <ProcessResultsView result={lcaResult} yaml={appliedYaml} /> : view === "contribution" ? <ContributionView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError || contributionError} loadContributionGraphs={loadContributionGraphs} /> : view === "sankey" && hasCurrentResults && lcaResult ? <SankeyView result={lcaResult} loadContributionGraphs={loadContributionGraphs} /> : view === "realtime" ? <RealtimeView result={lcaResult} isCurrent={hasCurrentResults} error={resultsError} overrides={scenarioOverrides} onOverride={setScenarioOverride} onReset={resetScenario} onCommit={commitScenario} committing={calculationInProgress} /> : <div className="results-panel">
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
          <div className="inspector-head"><span>NODE DETAILS</span><Button variant="ghost" size="icon" onClick={clearNodeSelection} aria-label="Close property editor" title="Close property editor"><X size={16} /></Button></div>
          <div className="node-icon" style={{ background: selectedNode?.data.color ?? inspectorSelection.color }}><Box size={22} /></div>
          <h2>{selectedNode?.data.label ?? inspectorSelection.label}</h2><p>{selectedNode?.data.detail ?? inspectorSelection.detail}</p>
          {graphMode === "structure" ? <Button variant="outline" size="sm" className="reference-amounts-toggle" aria-pressed={showReferenceAmounts} onClick={() => setReferenceAmountsVisible(!showReferenceAmounts)}>{showReferenceAmounts ? "Hide reference amounts" : "Reference amounts"}</Button> : null}
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
      <AiChatPanel open={chatOpen} onOpenChange={onChatOpenChange} runtime={assistantRuntime} portalTarget={chatPortalTarget} />
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
          const fallback = [...document.querySelectorAll<HTMLElement>("[data-file-menu-trigger]")].find((element) => element.offsetParent !== null)
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
  const [chatOpen, setChatOpen] = useState(false)
  const [workspaceTitle, setWorkspaceTitle] = useState("Loading product graphs…")
  const [navbarTarget, setNavbarTarget] = useState<HTMLDivElement | null>(null)
  const [chatPortalTarget, setChatPortalTarget] = useState<HTMLDivElement | null>(null)
  const { decimalPlaces, setDecimalPlaces, showAllDecimalPlaces, setShowAllDecimalPlaces, theme, setTheme } = useDisplaySettings()

  return (
    <TooltipProvider delayDuration={250}>
      <main className={`app-shell theme-${theme}${chatOpen ? " has-chat" : ""}`}>
        {welcomeOpen ? <WelcomePage onExplore={() => setWelcomeOpen(false)} /> : null}
        <div className="app-main-pane">
          <header className="topbar" hidden={welcomeOpen}>
          <div className="brand"><button className="brand-home" type="button" onClick={() => setWelcomeOpen(true)} aria-label="Open PRISM welcome page"><span className="brand-mark"><img src={prismLogoRound} alt="" aria-hidden="true" /></span></button><span className="brand-product-name"><span>PRISM</span><span className="brand-product-descriptor"> Life Cycle Assessment</span></span><span className="brand-separator">·</span><h1 className="brand-study-title">{workspaceTitle}</h1></div>
          <div ref={setNavbarTarget} className="navbar-portal-target" />
          <div className="top-actions">
            <Button variant="ghost" className={`ai-chat-trigger ${chatOpen ? "is-active" : ""}`} type="button" aria-label="AI assistant" aria-expanded={chatOpen} onClick={() => setChatOpen(true)}><Bot /><span>Assistant</span></Button>
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
              <GraphEditor onTitleChange={setWorkspaceTitle} navbarTarget={navbarTarget} chatPortalTarget={chatPortalTarget} active={!welcomeOpen} chatOpen={chatOpen} onChatOpenChange={setChatOpen} />
            </ReactFlowProvider>
          </section>
        </div>
        <div ref={setChatPortalTarget} className="ai-chat-pane" aria-hidden={!chatOpen} />
      </main>
    </TooltipProvider>
  )
}

export default function App() {
  return <DisplaySettingsProvider><AppContent /></DisplaySettingsProvider>
}
