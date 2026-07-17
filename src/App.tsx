import { useCallback, useEffect, useRef, useState } from "react"
import cytoscape, { type Core, type ElementDefinition } from "cytoscape"
import * as Tooltip from "@radix-ui/react-tooltip"
import {
  Box, ChevronDown, CircleHelp, Download, Scan, LayoutGrid,
  Link2, Maximize, Minus, MousePointer2, Plus, Search, Share2, Sparkles,
} from "lucide-react"
import { Button } from "./components/ui/button"

const elements: ElementDefinition[] = [
  { data: { id: "platform", label: "Core Platform", kind: "platform", detail: "Shared product foundation" } },
  { data: { id: "identity", label: "Identity", kind: "service", detail: "Authentication & access" } },
  { data: { id: "billing", label: "Billing", kind: "service", detail: "Plans, invoices & usage" } },
  { data: { id: "analytics", label: "Analytics", kind: "service", detail: "Events & reporting" } },
  { data: { id: "workspace", label: "Workspace", kind: "feature", detail: "Team collaboration" } },
  { data: { id: "automation", label: "Automations", kind: "feature", detail: "Rules and workflows" } },
  { data: { id: "api", label: "Public API", kind: "channel", detail: "Developer integrations" } },
  { data: { id: "mobile", label: "Mobile App", kind: "channel", detail: "iOS & Android client" } },
  { data: { id: "web", label: "Web App", kind: "channel", detail: "Primary customer experience" } },
  { data: { id: "e1", source: "platform", target: "identity" } },
  { data: { id: "e2", source: "platform", target: "billing" } },
  { data: { id: "e3", source: "platform", target: "analytics" } },
  { data: { id: "e4", source: "identity", target: "workspace" } },
  { data: { id: "e5", source: "analytics", target: "automation" } },
  { data: { id: "e6", source: "workspace", target: "web" } },
  { data: { id: "e7", source: "workspace", target: "mobile" } },
  { data: { id: "e8", source: "automation", target: "api" } },
  { data: { id: "e9", source: "billing", target: "web" } },
]

const kindColor: Record<string, string> = {
  platform: "#a78bfa", service: "#60a5fa", feature: "#34d399", channel: "#fb923c",
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

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [selected, setSelected] = useState<{ id: string; label: string; kind: string; detail: string } | null>(null)
  const [query, setQuery] = useState("")
  const [nodeCount, setNodeCount] = useState(9)

  useEffect(() => {
    if (!containerRef.current) return
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.35,
      maxZoom: 2.4,
      wheelSensitivity: 0.18,
      layout: { name: "breadthfirst", directed: true, padding: 90, spacingFactor: 1.2 },
      style: [
        { selector: "node", style: {
          "background-color": (ele) => kindColor[ele.data("kind")],
          "border-color": "#0b0d10", "border-width": 5,
          width: 62, height: 62, label: "data(label)", color: "#dfe3ea",
          "font-family": "Inter, ui-sans-serif, system-ui", "font-size": 11, "font-weight": "bold",
          "text-valign": "bottom", "text-margin-y": 10, "text-wrap": "wrap", "text-max-width": "90px",
          "overlay-opacity": 0,
        } },
        { selector: "node:selected", style: { "border-color": "#f4f4f5", "border-width": 3, "background-blacken": -0.12 } },
        { selector: "edge", style: {
          width: 1.5, "line-color": "#343941", "target-arrow-color": "#343941",
          "target-arrow-shape": "triangle", "curve-style": "bezier", "arrow-scale": 0.7,
        } },
        { selector: ".faded", style: { opacity: 0.12 } },
      ],
    })
    cy.on("tap", "node", (event) => {
      const data = event.target.data()
      setSelected({ id: data.id, label: data.label, kind: data.kind, detail: data.detail })
    })
    cy.on("tap", (event) => { if (event.target === cy) setSelected(null) })
    cyRef.current = cy
    return () => { cy.destroy(); cyRef.current = null }
  }, [])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().removeClass("faded")
    if (!query.trim()) return
    const matches = cy.nodes().filter((node) => node.data("label").toLowerCase().includes(query.toLowerCase()))
    cy.elements().addClass("faded")
    matches.union(matches.connectedEdges()).removeClass("faded")
  }, [query])

  const addNode = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    const id = `node-${Date.now()}`
    const next = nodeCount + 1
    cy.add({ data: { id, label: `New capability ${next}`, kind: "feature", detail: "New product capability" }, position: { x: cy.extent().x2 / 2, y: cy.extent().y2 / 2 } })
    setNodeCount(next)
    cy.getElementById(id).select()
  }, [nodeCount])

  const fit = () => cyRef.current?.animate({ fit: { eles: cyRef.current.elements(), padding: 70 }, duration: 350 })
  const relayout = () => cyRef.current?.layout({ name: "breadthfirst", directed: true, padding: 90, animate: true, animationDuration: 450 }).run()

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
          <aside className="rail">
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
              <ToolButton label="Zoom in" onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.2)}><Plus size={18} /></ToolButton>
              <ToolButton label="Zoom out" onClick={() => cyRef.current?.zoom(cyRef.current.zoom() / 1.2)}><Minus size={18} /></ToolButton>
            </div>
          </aside>

          <div className="canvas-wrap">
            <div className="canvas-head">
              <div><p className="eyebrow">PRODUCT ARCHITECTURE</p><h1>Capability map</h1></div>
              <div className="search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a node…" aria-label="Find a node" /><kbd>⌘ K</kbd></div>
            </div>
            <div ref={containerRef} className="cytoscape-canvas" />
            <div className="legend">
              {Object.entries(kindColor).map(([kind, color]) => <span key={kind}><i style={{ backgroundColor: color }} />{kind}</span>)}
            </div>
            <div className="graph-meta">{nodeCount} nodes&nbsp;&nbsp;·&nbsp;&nbsp;9 connections</div>
          </div>

          <aside className={`inspector ${selected ? "is-open" : ""}`}>
            {selected ? <>
              <div className="inspector-head"><span>NODE DETAILS</span><Button variant="ghost" size="icon" onClick={() => setSelected(null)}><Maximize size={16} /></Button></div>
              <div className="node-icon" style={{ background: kindColor[selected.kind] }}><Box size={22} /></div>
              <h2>{selected.label}</h2><p>{selected.detail}</p>
              <div className="field"><label>Type</label><div>{selected.kind}<ChevronDown size={14} /></div></div>
              <div className="field"><label>Owner</label><div>Product team<ChevronDown size={14} /></div></div>
              <div className="field"><label>Status</label><div><span className="status-dot" /> Active<ChevronDown size={14} /></div></div>
              <div className="insight"><Sparkles size={16} /><div><strong>Graph insight</strong><p>This node connects to {cyRef.current?.getElementById(selected.id).connectedEdges().length ?? 0} other capabilities.</p></div></div>
            </> : <div className="empty-inspector"><MousePointer2 size={24} /><strong>Nothing selected</strong><p>Select a node to inspect its properties and connections.</p></div>}
          </aside>
        </section>
      </main>
    </Tooltip.Provider>
  )
}
