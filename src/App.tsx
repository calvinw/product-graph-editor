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
  platform: "#a78bfa", service: "#60a5fa", feature: "#34d399", channel: "#fb923c",
}

const initialNodes: Node<ProcessNodeData>[] = [
  { id: "platform", type: "process", position: { x: 0, y: 0 }, data: { label: "Core Platform", kind: "platform", detail: "Shared product foundation", color: kindColor.platform } },
  { id: "identity", type: "process", position: { x: 0, y: 0 }, data: { label: "Identity", kind: "service", detail: "Authentication & access", color: kindColor.service } },
  { id: "billing", type: "process", position: { x: 0, y: 0 }, data: { label: "Billing", kind: "service", detail: "Plans, invoices & usage", color: kindColor.service } },
  { id: "analytics", type: "process", position: { x: 0, y: 0 }, data: { label: "Analytics", kind: "service", detail: "Events & reporting", color: kindColor.service } },
  { id: "workspace", type: "process", position: { x: 0, y: 0 }, data: { label: "Workspace", kind: "feature", detail: "Team collaboration", color: kindColor.feature } },
  { id: "automation", type: "process", position: { x: 0, y: 0 }, data: { label: "Automations", kind: "feature", detail: "Rules and workflows", color: kindColor.feature } },
  { id: "api", type: "process", position: { x: 0, y: 0 }, data: { label: "Public API", kind: "channel", detail: "Developer integrations", color: kindColor.channel } },
  { id: "mobile", type: "process", position: { x: 0, y: 0 }, data: { label: "Mobile App", kind: "channel", detail: "iOS & Android client", color: kindColor.channel } },
  { id: "web", type: "process", position: { x: 0, y: 0 }, data: { label: "Web App", kind: "channel", detail: "Primary customer experience", color: kindColor.channel } },
]

const initialEdges: Edge[] = [
  { id: "e1", source: "platform", target: "identity" },
  { id: "e2", source: "platform", target: "billing" },
  { id: "e3", source: "platform", target: "analytics" },
  { id: "e4", source: "identity", target: "workspace" },
  { id: "e5", source: "analytics", target: "automation" },
  { id: "e6", source: "workspace", target: "web" },
  { id: "e7", source: "workspace", target: "mobile" },
  { id: "e8", source: "automation", target: "api" },
  { id: "e9", source: "billing", target: "web" },
].map((edge) => ({
  ...edge,
  style: { stroke: "#343941", strokeWidth: 1.5 },
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
    const downstream = new Set<string>()
    const visit = (source: string) => {
      edgesRef.current.filter((edge) => edge.source === source).forEach((edge) => {
        if (!downstream.has(edge.target)) { downstream.add(edge.target); visit(edge.target) }
      })
    }
    visit(id)
    if (!downstream.size) return
    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, canRestore: true } }
      : downstream.has(node.id) ? { ...node, hidden: true } : node))
    setEdges((current) => current.map((edge) => downstream.has(edge.source) || downstream.has(edge.target) ? { ...edge, hidden: true } : edge))
  }, [setNodes, setEdges])

  const restoreNode = useCallback((id: string) => {
    const depths = new Map<string, number>()
    const queue: Array<{ id: string; depth: number }> = [{ id, depth: 0 }]
    while (queue.length) {
      const current = queue.shift()!
      edgesRef.current.filter((edge) => edge.source === current.id).forEach((edge) => {
        const nextDepth = current.depth + 1
        const knownDepth = depths.get(edge.target)
        if (knownDepth === undefined || nextDepth < knownDepth) {
          depths.set(edge.target, nextDepth)
          queue.push({ id: edge.target, depth: nextDepth })
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
            canRestore: edgesRef.current.some((edge) => edge.source === node.id && hiddenAfterReveal.has(edge.target)),
          },
        } : node))
    setEdges((current) => current.map((edge) => depths.has(edge.source) || depths.has(edge.target) || edge.source === id
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
      data: { label: `New capability ${nodes.length + 1}`, kind: "feature", detail: "New product capability", color: kindColor.feature, onRemove: removeNode },
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
          <div><p className="eyebrow">PRODUCT ARCHITECTURE</p><h1>Capability map</h1></div>
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
