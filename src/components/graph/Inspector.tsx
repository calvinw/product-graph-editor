import { useEffect, useState } from "react"
import { Box, GripHorizontal, X } from "lucide-react"
import type { Node } from "@xyflow/react"
import { Button } from "@/components/ui/button"
import type { ProcessNodeData } from "@/components/ProcessNode"
import { useDisplaySettings } from "@/lib/displaySettings"
import type { SelectedGraphNode } from "@/state/productGraphStore"
import { useDraggablePosition } from "@/hooks/useDraggablePosition"
import { RailResizeHandle } from "./RailResizeHandle"

/**
 * The property editor for the selected graph node.
 *
 * `inspectorSelection` is the last selection rather than the live one, so the
 * panel keeps its contents while animating closed.
 *
 * It opens when an activity is clicked and floats over the graph. It can be
 * resized from its left edge and moved by its header; until it is moved it sits
 * in its default spot on the right. It is anchored by its right edge so that
 * resizing from the left edge never moves the right edge. The contents scroll
 * inside .inspector-scroll so the resize handle stays put.
 */
const FLOATING_QUERY = "(min-width: 901px)"

/** Moving the editor is a desktop feature; narrower layouts keep it docked. */
function useFloatingAllowed() {
  const [allowed, setAllowed] = useState(() => window.matchMedia(FLOATING_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(FLOATING_QUERY)
    const update = () => setAllowed(query.matches)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return allowed
}

export function Inspector({
  selected, inspectorSelection, selectedNode, inputNodes, outputNodes,
  graphMode, showReferenceAmounts, setReferenceAmountsVisible, clearNodeSelection,
}: {
  selected: SelectedGraphNode | null
  inspectorSelection: SelectedGraphNode
  selectedNode: Node<ProcessNodeData> | undefined
  inputNodes: Node<ProcessNodeData>[]
  outputNodes: Node<ProcessNodeData>[]
  graphMode: "scaled" | "structure"
  showReferenceAmounts: boolean
  setReferenceAmountsVisible: (visible: boolean) => void
  clearNodeSelection: () => void
}) {
  const { formatNumber } = useDisplaySettings()
  const floatingAllowed = useFloatingAllowed()
  const { position, startDrag, panelRef } = useDraggablePosition<HTMLElement>("product-graph-editor:property-editor-position", { anchor: "right" })
  const floating = floatingAllowed && position
  const startHeaderDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!floatingAllowed) return
    // The close button keeps its own click; anywhere else on the header drags.
    if ((event.target as HTMLElement).closest("button:not(.inspector-grip)")) return
    startDrag(event)
  }
  return (
    <aside
      ref={panelRef}
      className={`inspector${selected ? " is-open" : ""}${floating ? " is-floating" : ""}`}
      aria-hidden={!selected}
      inert={!selected}
      data-draggable-panel
      style={floating ? { position: "fixed", right: position.right, top: position.top, bottom: "auto", maxHeight: `calc(100vh - ${position.top}px - 18px)` } : undefined}
    >
    <RailResizeHandle panelRef={panelRef} label="Resize property editor" />
  <div className="inspector-scroll">
    <div className="inspector-head" onPointerDown={startHeaderDrag}><button type="button" className="inspector-grip" aria-label="Move property editor" title="Drag to move"><GripHorizontal size={14} /></button><span>NODE DETAILS</span><Button variant="ghost" size="icon" onClick={clearNodeSelection} aria-label="Close property editor" title="Close property editor"><X size={16} /></Button></div>
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
  </div>
    </aside>
  )
}
