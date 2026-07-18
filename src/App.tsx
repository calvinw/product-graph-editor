import { useCallback, useEffect, useRef, useState } from "react"
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MarkerType,
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import * as Tooltip from "@radix-ui/react-tooltip"
import {
  Box, ChevronDown, CircleHelp, Download, Scan, LayoutGrid,
  Link2, Maximize, Minus, MousePointer2, Plus, Search, Share2, Sparkles,
} from "lucide-react"
import { Button } from "./components/ui/button"
import { ProcessNode, type ProcessNodeData } from "./components/ProcessNode"
import { layoutNodes } from "./lib/layout"

type NodeMeta = { label: string; kind: string; detail: string }

const kindColor: Record<string, string> = {
  material: "#38bdf8", process: "#a78bfa", component: "#fb923c", product: "#34d399",
}

const initialNodes: Node<ProcessNodeData>[] = [
  { id: "raw-material", type: "process", position: { x: 0, y: 0 }, data: { label: "Raw material extraction", kind: "material", detail: "Produces 1.00 kg raw fiber material", color: kindColor.material, emissions: [{ label: "CO₂", amount: 1.8, unit: "kg" }, { label: "CH₄", amount: 0.02, unit: "kg" }] } },
  { id: "spinning", type: "process", position: { x: 0, y: 0 }, data: { label: "Spinning", kind: "process", detail: "Uses 1.20 kg raw fiber to produce 1.00 kg fiber", color: kindColor.process, emissions: [{ label: "CO₂", amount: 1.2, unit: "kg" }, { label: "CH₄", amount: 0.01, unit: "kg" }] } },
  { id: "fabric-weaving", type: "process", position: { x: 0, y: 0 }, data: { label: "Fabric weaving", kind: "process", detail: "Uses 1.10 kg fiber to produce 1.00 kg fabric", color: kindColor.process, emissions: [{ label: "CO₂", amount: 1.5, unit: "kg" }, { label: "NOₓ", amount: 0.01, unit: "kg" }] } },
  { id: "zipper-production", type: "process", position: { x: 0, y: 0 }, data: { label: "Zipper production", kind: "component", detail: "Produces 1 zipper", color: kindColor.component, emissions: [{ label: "CO₂", amount: 0.4, unit: "kg" }, { label: "NOₓ", amount: 0.005, unit: "kg" }] } },
  { id: "jacket-assembly", type: "process", position: { x: 0, y: 0 }, data: { label: "Jacket assembly", kind: "product", detail: "Uses 0.60 kg fabric and 1 zipper to produce 1 jacket", color: kindColor.product, emissions: [{ label: "CO₂", amount: 0.8, unit: "kg" }] } },
]

const initialEdges: Edge[] = [
  { id: "raw-to-spinning", source: "raw-material", target: "spinning", label: "Raw fiber · 1.20 kg" },
  { id: "spinning-to-fabric", source: "spinning", target: "fabric-weaving", label: "Fiber · 1.10 kg" },
  { id: "fabric-to-jacket", source: "fabric-weaving", target: "jacket-assembly", label: "Fabric · 0.60 kg" },
  { id: "zipper-to-jacket", source: "zipper-production", target: "jacket-assembly", label: "Zipper · 1 unit" },
].map((edge) => ({
  ...edge,
  style: { stroke: "#343941", strokeWidth: 1.5 },
  labelStyle: { fill: "#7f8794", fontSize: 10, fontWeight: 600 },
  labelBgStyle: { fill: "#111318", fillOpacity: 0.92 },
  labelBgPadding: [5, 3] as [number, number],
  labelBgBorderRadius: 4,
  markerEnd: { type: MarkerType.ArrowClosed, color: "#343941", width: 16, height: 16 },
}))

const nodeTypes = { process: ProcessNode }

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
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  nodesRef.current = nodes
  edgesRef.current = edges
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  const removeNode = useCallback((id: string) => {
    const upstream = new Set<string>()
    const visit = (target: string) => {
      edgesRef.current.filter((edge) => edge.target === target).forEach((edge) => {
        if (!upstream.has(edge.source)) { upstream.add(edge.source); visit(edge.source) }
      })
    }
    visit(id)
    if (!upstream.size) return
    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, canRestore: true } }
      : upstream.has(node.id) ? { ...node, hidden: true } : node))
    setEdges((current) => current.map((edge) => upstream.has(edge.source) || upstream.has(edge.target) ? { ...edge, hidden: true } : edge))
  }, [setNodes, setEdges])

  const restoreNode = useCallback((id: string) => {
    const depths = new Map<string, number>()
    const queue: Array<{ id: string; depth: number }> = [{ id, depth: 0 }]
    while (queue.length) {
      const current = queue.shift()!
      edgesRef.current.filter((edge) => edge.target === current.id).forEach((edge) => {
        const nextDepth = current.depth + 1
        const knownDepth = depths.get(edge.source)
        if (knownDepth === undefined || nextDepth < knownDepth) {
          depths.set(edge.source, nextDepth)
          queue.push({ id: edge.source, depth: nextDepth })
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
            canRestore: edgesRef.current.some((edge) => edge.target === node.id && hiddenAfterReveal.has(edge.source)),
          },
        } : node))
    setEdges((current) => current.map((edge) => depths.has(edge.source) || depths.has(edge.target) || edge.target === id
      ? { ...edge, hidden: hiddenAfterReveal.has(edge.source) || hiddenAfterReveal.has(edge.target) }
      : edge))
  }, [setEdges, setNodes])

  useEffect(() => {
    setNodes((current) => current.map((node) => (
      node.data.onRemove === removeNode && node.data.onRestore === restoreNode
        ? node
        : { ...node, data: { ...node.data, onRemove: removeNode, onRestore: restoreNode } }
    )))
  }, [removeNode, restoreNode, setNodes])

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

  const addNode = useCallback(() => {
    const id = `node-${Date.now()}`
    const next: Node<ProcessNodeData> = {
      id, type: "process", position: { x: 40, y: 40 },
      data: { label: `New process ${nodes.length + 1}`, kind: "process", detail: "New product-system process", color: kindColor.process, onRemove: removeNode },
      selected: true,
    }
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), next])
    setSelected({ id, label: next.data.label, kind: next.data.kind, detail: next.data.detail })
  }, [nodes, removeNode, setNodes])

  const toggleExpanded = useCallback((nodeId: string) => {
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]))
      return current.map((node) => {
        if (node.id !== nodeId) return node
        const flowItem = (id: string) => {
          const connected = byId.get(id)
          return connected ? { label: connected.data.label, kind: connected.data.kind, color: connected.data.color } : null
        }
        const inputs = edges.filter((edge) => edge.target === nodeId).map((edge) => flowItem(edge.source)).filter((item): item is NonNullable<typeof item> => item !== null)
        const outputs = edges.filter((edge) => edge.source === nodeId).map((edge) => flowItem(edge.target)).filter((item): item is NonNullable<typeof item> => item !== null)
        return { ...node, data: { ...node.data, expanded: !node.data.expanded, inputs, outputs } }
      })
    })
  }, [edges, setNodes])

  const fit = () => fitView({ padding: 0.15, duration: 350 })
  const relayout = () => setNodes((current) => layoutNodes(current, edges))

  const connectionCount = edges.length

  return (
    <>
      <div className="rail">
        <div className="rail-group">
          <ToolButton label="Select"><MousePointer2 size={18} /></ToolButton>
          <ToolButton label="Add node" onClick={addNode}><Plus size={18} /></ToolButton>
          <ToolButton label="Connect nodes"><Link2 size={18} /></ToolButton>
        </div>
        <div className="rail-group">
          <ToolButton label="Auto layout" onClick={relayout}><LayoutGrid size={18} /></ToolButton>
          <ToolButton label="Fit graph" onClick={fit}><Scan size={18} /></ToolButton>
        </div>
        <div className="rail-bottom">
          <ToolButton label="Zoom in" onClick={() => zoomIn({ duration: 200 })}><Plus size={18} /></ToolButton>
          <ToolButton label="Zoom out" onClick={() => zoomOut({ duration: 200 })}><Minus size={18} /></ToolButton>
        </div>
      </div>

      <div className="canvas-wrap">
        <div className="canvas-head">
          <div><p className="eyebrow">LIFE CYCLE MODEL · PREVIEW</p><h1>Jacket product system</h1></div>
          <div className="search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a node…" aria-label="Find a node" /><kbd>⌘ K</kbd></div>
        </div>
        <ReactFlow
          className="reactflow-canvas"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => setSelected({ id: node.id, label: node.data.label, kind: node.data.kind, detail: node.data.detail })}
          onNodeDoubleClick={(_, node) => toggleExpanded(node.id)}
          onPaneClick={() => setSelected(null)}
          minZoom={0.35}
          maxZoom={2.4}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#242831" />
        </ReactFlow>
        <div className="legend">
          {Object.entries(kindColor).map(([kind, color]) => <span key={kind}><i style={{ backgroundColor: color }} />{kind}</span>)}
        </div>
        <div className="graph-meta">{nodes.length} nodes&nbsp;&nbsp;·&nbsp;&nbsp;{connectionCount} connections</div>
      </div>

      <aside className={`inspector ${selected ? "is-open" : ""}`}>
        {selected ? <>
          <div className="inspector-head"><span>NODE DETAILS</span><Button variant="ghost" size="icon" onClick={() => setSelected(null)}><Maximize size={16} /></Button></div>
          <div className="node-icon" style={{ background: kindColor[selected.kind] }}><Box size={22} /></div>
          <h2>{selected.label}</h2><p>{selected.detail}</p>
          <div className="field"><label>Type</label><div>{selected.kind}<ChevronDown size={14} /></div></div>
          <div className="field"><label>Owner</label><div>Product team<ChevronDown size={14} /></div></div>
          <div className="field"><label>Status</label><div><span className="status-dot" /> Active<ChevronDown size={14} /></div></div>
          <div className="insight"><Sparkles size={16} /><div><strong>Graph insight</strong><p>This node connects to {edges.filter((edge) => edge.source === selected.id || edge.target === selected.id).length} other capabilities.</p></div></div>
        </> : <div className="empty-inspector"><MousePointer2 size={24} /><strong>Nothing selected</strong><p>Select a node to inspect its properties and connections.</p></div>}
      </aside>
    </>
  )
}

export default function App() {
  return (
    <Tooltip.Provider delayDuration={250}>
      <main className="app-shell">
        <header className="topbar">
          <div className="brand"><div className="brand-mark"><Share2 size={16} /></div><span>Product Graph</span></div>
          <div className="divider" />
          <button className="project-switcher">Atlas workspace <ChevronDown size={14} /></button>
          <div className="save-state"><span /> Saved</div>
          <div className="top-actions">
            <Button variant="ghost" size="sm"><CircleHelp size={15} /> Help</Button>
            <Button variant="outline" size="sm"><Download size={15} /> Export</Button>
            <Button size="sm"><Share2 size={15} /> Share</Button>
          </div>
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
