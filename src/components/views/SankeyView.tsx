import type React from "react"
import { useEffect, useRef, useState } from "react"
import dagre from "@dagrejs/dagre"
import {
  ReactFlow, Background, BackgroundVariant, Handle, Position, SelectionMode,
  useNodesState, useEdgesState, type Edge, type Node, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react"
import { BarChart3, Component, GripHorizontal, LayoutGrid, Minus, MousePointer2, Plus, Scan, Settings2 } from "lucide-react"
import { AppSelect, ToolButton } from "@/components/common/AppControls"
import { useDraggablePosition } from "@/hooks/useDraggablePosition"
import { NumberStepper } from "@/components/NumberStepper"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useDisplaySettings } from "@/lib/displaySettings"
import { impactCategoryDisplayName, type ContributionGraph, type LcaResult } from "@/lib/lcaApi"
import { inventoryFlowName } from "@/lib/resultFormatting"
import { unitsAreCompatible } from "@/lib/units"
import { nodeScopeColors } from "@/lib/yamlGraph"

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

export function SankeyView({ result, loadContributionGraphs }: {
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
  const [selectMode, setSelectMode] = useState(false)
  const { position: toolbarPosition, startDrag: startToolbarDrag } = useDraggablePosition("product-graph-editor:sankey-toolbar-position")
  const instanceRef = useRef<ReactFlowInstance<Node<SankeyProcessNodeData>, Edge> | null>(null)
  const [renderedNodes, setRenderedNodes, onSankeyNodesChange] = useNodesState<Node<SankeyProcessNodeData>>([])
  const [renderedEdges, setRenderedEdges, onSankeyEdgesChange] = useEdgesState<Edge>([])
  useEffect(() => setMaxProcesses(availableProcessCount), [availableProcessCount])
  useEffect(() => {
    let fitFrame = 0
    const onResize = () => {
      cancelAnimationFrame(fitFrame)
      fitFrame = requestAnimationFrame(() => instanceRef.current?.fitView({ padding: .45, maxZoom: 0.85, duration: 200 }))
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(fitFrame)
    }
  }, [])
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
    if (instance) requestAnimationFrame(() => instance.fitView({ padding: .35, maxZoom: 0.85, duration: 350 }))
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

  const fitSankey = () => instanceRef.current?.fitView({ padding: .45, maxZoom: 0.85, duration: 350 })

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
        panOnScroll={!selectMode}
        panOnDrag={!selectMode}
        selectionOnDrag={selectMode}
        selectionMode={SelectionMode.Partial}
        onlyRenderVisibleElements={false}
        fitView
        fitViewOptions={{ padding: .35, maxZoom: 0.85 }}
        proOptions={{ hideAttribution: true }}
      ><Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#242831" /></ReactFlow> : <div className="sankey-empty"><strong>No contributions for this selection</strong><p>Choose another flow or impact category.</p></div>}
    </div>
    {totalMagnitude && !impactGraphPending ? <div className="graph-toolbar sankey-toolbar" data-draggable-panel aria-label="Sankey graph tools" style={toolbarPosition ? { position: "fixed", left: toolbarPosition.left, top: toolbarPosition.top } : undefined}>
      <button type="button" className="toolbar-grip" aria-label="Move Sankey toolbar" onPointerDown={startToolbarDrag}><GripHorizontal size={14} /></button>
      <div className="toolbar-group"><ToolButton label="Chart settings" onClick={() => setChartPickerOpen((open) => !open)}><Settings2 size={18} /></ToolButton></div>
      <div className="toolbar-group"><ToolButton label="Select" pressed={selectMode} onClick={() => setSelectMode((current) => !current)}><MousePointer2 size={18} /></ToolButton></div>
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
