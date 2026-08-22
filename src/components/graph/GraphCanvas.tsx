import { useCallback } from "react"
import {
  Background, BackgroundVariant, ReactFlow, SelectionMode, getNodesBounds, useReactFlow,
  type Edge, type Node, type OnEdgesChange, type OnNodesChange,
} from "@xyflow/react"
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
  inspectorOpen, theme, selectMode,
  setSelected, clearNodeSelection, hydrateBackgroundNode, toggleExpanded,
}: {
  nodes: Node<ProcessNodeData>[]
  edges: Edge[]
  onNodesChange: OnNodesChange<Node<ProcessNodeData>>
  onEdgesChange: OnEdgesChange<Edge>
  inspectorOpen: boolean
  theme: string
  selectMode: boolean
  setSelected: (node: SelectedGraphNode) => void
  clearNodeSelection: () => void
  hydrateBackgroundNode: (id: string) => void | Promise<void>
  toggleExpanded: (id: string) => void
}) {
  const { fitBounds, getNodes } = useReactFlow()
  // Alt+drag draws a selection box (selectionKeyCode below) and zooms to it.
  // Plain drag in Select mode stays a pure multi-select so the selected nodes
  // can be dragged as a group -- the two are deliberately separate (#67).
  const zoomToSelectionIfModified = useCallback((event: React.MouseEvent) => {
    if (!event.altKey) return
    const selectedNodes = getNodes().filter((node) => node.selected)
    if (!selectedNodes.length) return
    const bounds = getNodesBounds(selectedNodes)
    if (bounds.width && bounds.height) void fitBounds(bounds, { padding: 0.15, duration: 300 })
  }, [fitBounds, getNodes])

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
      // The graph renders appliedYaml and has no structural editing. Without
      // this, Backspace on a selected node removes it from React Flow's state
      // only, desyncing the canvas from the YAML with no way back.
      deleteKeyCode={null}
      minZoom={0.05}
      maxZoom={2.4}
      zoomOnScroll={false}
      panOnScroll={!selectMode}
      panOnDrag={!selectMode}
      selectionOnDrag={selectMode}
      selectionMode={SelectionMode.Partial}
      // Alt is free: Shift/Space/Meta are already React Flow defaults for
      // box-select, pan, and multi-select respectively.
      selectionKeyCode="Alt"
      onSelectionEnd={zoomToSelectionIfModified}
      onInit={(instance) => requestAnimationFrame(() => requestAnimationFrame(() => instance.fitView({ padding: 0.4, maxZoom: 0.85 })))}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={theme === "dark" ? "#242831" : "#cbd5e1"} />
    </ReactFlow></div>
  )
}
