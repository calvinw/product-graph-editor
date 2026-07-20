import { useCallback, useEffect, useRef, useState } from "react"
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant,
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import * as Tooltip from "@radix-ui/react-tooltip"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  BarChart3, Box, Scan, LayoutGrid,
  FileUp, Link2, Maximize, Minus, MousePointer2, Plus, Search, Share2,
} from "lucide-react"
import { Button } from "./components/ui/button"
import { ProcessNode, type ProcessNodeData } from "./components/ProcessNode"
import { layoutNodes } from "./lib/layout"
import { buildGraphFromYaml } from "./lib/yamlGraph"
import { calculateLca, lcaResultToMarkdown, type LcaResult } from "./lib/lcaApi"
import jacketYaml from "../Jacket_product_graph.yaml?raw"

type NodeMeta = { label: string; kind: string; detail: string }

const kindColor: Record<string, string> = {
  material: "#38bdf8", process: "#a78bfa", component: "#fb923c", product: "#34d399",
}

const defaultGraph = buildGraphFromYaml(jacketYaml, "structure")
const initialEdges: Edge[] = defaultGraph.edges
const initialNodes: Node<ProcessNodeData>[] = defaultGraph.nodes.map((node) => ({
  ...node,
  data: { ...node.data, canFold: initialEdges.some((edge) => edge.target === node.id) },
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
  const [view, setView] = useState<"graph" | "yaml" | "inventory" | "contribution" | "sankey" | "results">("graph")
  const [yamlText, setYamlText] = useState(jacketYaml)
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

  const addNode = useCallback(() => {
    const id = `node-${Date.now()}`
    const next: Node<ProcessNodeData> = {
      id, type: "process", position: { x: 40, y: 40 },
      data: { label: `New process ${nodes.length + 1}`, kind: "process", detail: "New life cycle process", color: kindColor.process, onRemove: removeNode },
      selected: true,
    }
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), next])
    setSelected({ id, label: next.data.label, kind: next.data.kind, detail: next.data.detail })
  }, [nodes.length, removeNode, setNodes])

  const fit = () => fitView({ padding: 0.35, maxZoom: 0.75, duration: 350 })
  const relayout = () => setNodes((current) => layoutNodes(current, edges))

  const showGraphMode = (mode: "scaled" | "structure") => {
    try {
      const currentResult = calculatedYaml === yamlText ? lcaResult : null
      if (mode === "scaled" && !currentResult) return
      const parsed = buildGraphFromYaml(yamlText, mode, currentResult?.scaling_vector)
      foldDirectionRef.current = "upstream"
      setEdges(parsed.edges)
      setNodes(layoutNodes(parsed.nodes.map((node) => ({
        ...node,
        data: { ...node.data, canFold: parsed.edges.some((edge) => edge.target === node.id) },
      })), parsed.edges))
      setGraphMode(mode)
      setSelected(null)
      setYamlError("")
      requestAnimationFrame(() => fitView({ padding: 0.35, maxZoom: 0.75, duration: 350 }))
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
    reader.onload = () => { setYamlText(String(reader.result ?? "")); setYamlError(""); setResultsMarkdown(""); setLcaResult(null); setCalculatedYaml(""); setGraphMode("structure") }
    reader.onerror = () => setYamlError("Could not read the selected file.")
    reader.readAsText(file)
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
          fitViewOptions={{ padding: 0.35, maxZoom: 0.75 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#242831" />
        </ReactFlow>
        <div className="graph-toolbar" aria-label="Graph tools">
          <div className="toolbar-group">
            <ToolButton label="Select"><MousePointer2 size={18} /></ToolButton>
            <ToolButton label="Add node" onClick={addNode}><Plus size={18} /></ToolButton>
            <ToolButton label="Connect nodes"><Link2 size={18} /></ToolButton>
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
            <label className="yaml-upload"><FileUp size={15} /> Choose file<input type="file" accept=".yaml,.yml,text/yaml" onChange={(event) => loadYamlFile(event.target.files?.[0])} /></label>
          </div>
          <textarea value={yamlText} onChange={(event) => { setYamlText(event.target.value); setResultsMarkdown(""); setLcaResult(null); setCalculatedYaml(""); setGraphMode("structure") }} spellCheck={false} aria-label="Product graph YAML" />
          <div className="yaml-editor-foot">
            <span className={yamlError ? "yaml-error" : ""}>{yamlError || "Files are parsed locally in your browser."}</span>
            <Button onClick={previewYaml}>Preview graph</Button>
          </div>
        </div> : view === "inventory" ? <div className="results-empty">
          <span className="not-implemented">NOT IMPLEMENTED YET</span>
          <div className="results-empty-icon"><BarChart3 size={22} /></div>
          <strong>Inventory</strong>
          <p>Life cycle inventory flows from the current product graph will appear here.</p>
        </div> : view === "contribution" ? <div className="results-empty">
          <span className="not-implemented">NOT IMPLEMENTED YET</span>
          <div className="results-empty-icon"><BarChart3 size={22} /></div>
          <strong>Contribution</strong>
          <p>Process and flow contributions from the current product graph will appear here.</p>
        </div> : view === "sankey" ? <div className="results-empty">
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

      {view === "graph" ? <aside className={`inspector ${selected ? "is-open" : ""}`}>
        {selected ? <>
          <div className="inspector-head"><span>NODE DETAILS</span><Button variant="ghost" size="icon" onClick={() => setSelected(null)}><Maximize size={16} /></Button></div>
          <div className="node-icon" style={{ background: kindColor[selected.kind] }}><Box size={22} /></div>
          <h2>{selected.label}</h2><p>{selected.detail}</p>
          <div className="property-section">
            <h3>Input flows</h3>
            {inputNodes.length ? inputNodes.map((node) => <div className="property-row" key={node.id}><span>{node.data.label}</span><small>{node.data.kind}</small></div>) : <p>No input flows</p>}
          </div>
          <div className="property-section">
            <h3>Output flows</h3>
            {outputNodes.length ? outputNodes.map((node) => <div className="property-row" key={node.id}><span>{node.data.label}</span><small>{node.data.kind}</small></div>) : <p>No output flows</p>}
          </div>
          {selectedNode?.data.extractions?.length ? <div className="property-section is-extraction">
            <h3>Resource extractions</h3>
            {selectedNode.data.extractions.map((item) => <div className="property-row" key={item.label}><span>{item.label}</span>{selectedNode.data.showAmounts !== false ? <strong>{item.amount} {item.unit}</strong> : null}</div>)}
          </div> : null}
          {selectedNode?.data.emissions?.length ? <div className="property-section is-emission">
            <h3>Emissions to air</h3>
            {selectedNode.data.emissions.map((item) => <div className="property-row" key={item.label}><span>{item.label}</span>{selectedNode.data.showAmounts !== false ? <strong>{item.amount} {item.unit}</strong> : null}</div>)}
          </div> : null}
        </> : <div className="empty-inspector"><MousePointer2 size={24} /><strong>Nothing selected</strong><p>Select a node to inspect its properties and connections.</p></div>}
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
