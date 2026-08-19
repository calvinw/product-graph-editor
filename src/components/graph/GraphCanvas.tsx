import { Background, BackgroundVariant, ReactFlow, type Edge, type Node, type OnEdgesChange, type OnNodesChange } from "@xyflow/react"
import { ProcessNode, type ProcessNodeData } from "@/components/ProcessNode"
import { ScenarioEdge } from "@/components/graph/ScenarioEdge"
import type { SelectedGraphNode } from "@/state/productGraphStore"

const nodeTypes = { process: ProcessNode }
// Only background-input edges carry a scenario type; the rest stay default.
const edgeTypes = { scenario: ScenarioEdge }

/**
 * The React Flow surface for the product graph.
 *
 * Phase 4 registers an edgeTypes entry here for draggable scenario edges; only
 * edges carrying a link_id will use it, so foreground edges keep the default
 * renderer.
 */
export function GraphCanvas({
  nodes, edges, onNodesChange, onEdgesChange,
  inspectorOpen, theme,
  setSelected, clearNodeSelection, hydrateBackgroundNode, toggleExpanded,
}: {
  nodes: Node<ProcessNodeData>[]
  edges: Edge[]
  onNodesChange: OnNodesChange<Node<ProcessNodeData>>
  onEdgesChange: OnEdgesChange<Edge>
  inspectorOpen: boolean
  theme: string
  setSelected: (node: SelectedGraphNode) => void
  clearNodeSelection: () => void
  hydrateBackgroundNode: (id: string) => void | Promise<void>
  toggleExpanded: (id: string) => void
}) {
  return (
    <div className={`graph-viewport${inspectorOpen ? " has-inspector" : ""}`}><ReactFlow
      className="reactflow-canvas"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
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
  )
}
