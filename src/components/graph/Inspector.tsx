import { useRef } from "react"
import { Box, PanelRightClose, SlidersHorizontal, X } from "lucide-react"
import type { Node } from "@xyflow/react"
import { Button } from "@/components/ui/button"
import type { ProcessNodeData } from "@/components/ProcessNode"
import { useDisplaySettings } from "@/lib/displaySettings"
import type { SelectedGraphNode } from "@/state/productGraphStore"
import { RailResizeHandle } from "./RailResizeHandle"

export type ModelSummary = { title: string; activities: number; connections: number; status: string }

/**
 * The property editor.
 *
 * Docked (desktop) it shows the selected activity, or a summary of the model
 * when nothing is selected, and can be collapsed to a narrow strip and resized
 * from its left edge. As an overlay (narrow layouts) it opens on a click and
 * keeps the last selection (`inspectorSelection`) while animating closed. The
 * contents scroll inside .inspector-scroll so the resize handle stays put.
 */
export function Inspector({
  selected, inspectorSelection, selectedNode, inputNodes, outputNodes,
  graphMode, showReferenceAmounts, setReferenceAmountsVisible, clearNodeSelection,
  docked, collapsed, onCollapsedChange, summary,
}: {
  selected: SelectedGraphNode | null
  inspectorSelection: SelectedGraphNode | null
  selectedNode: Node<ProcessNodeData> | undefined
  inputNodes: Node<ProcessNodeData>[]
  outputNodes: Node<ProcessNodeData>[]
  graphMode: "scaled" | "structure"
  showReferenceAmounts: boolean
  setReferenceAmountsVisible: (visible: boolean) => void
  clearNodeSelection: () => void
  docked: boolean
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  summary: ModelSummary
}) {
  const { formatNumber } = useDisplaySettings()
  const panelRef = useRef<HTMLElement | null>(null)
  const open = docked || selected !== null
  const detailsSelection = docked ? selected : inspectorSelection

  if (docked && collapsed) {
    return (
      <button type="button" className="panel-tab is-right" onClick={() => onCollapsedChange(false)} aria-label="Expand property editor" title="Expand property editor">
        <SlidersHorizontal size={14} aria-hidden="true" /><span aria-hidden="true">Properties</span>
        {selected ? <span className="inspector-selection-dot" role="img" aria-label={`${selected.label} selected`} title={`${selected.label} selected`} /> : null}
      </button>
    )
  }

  return (
    <aside ref={panelRef} className={`inspector${open ? " is-open" : ""}${docked ? " is-docked" : ""}`} aria-label="Property editor" aria-hidden={!open} inert={!open}>
    {docked ? <RailResizeHandle panelRef={panelRef} label="Resize property editor" /> : null}
  <div className="inspector-scroll">
    <div className="inspector-head"><span>{detailsSelection ? "NODE DETAILS" : "MODEL"}</span>{docked
      ? <Button variant="ghost" size="icon" onClick={() => onCollapsedChange(true)} aria-label="Collapse property editor" title="Collapse property editor"><PanelRightClose size={16} /></Button>
      : <Button variant="ghost" size="icon" onClick={clearNodeSelection} aria-label="Close property editor" title="Close property editor"><X size={16} /></Button>}</div>
    {detailsSelection ? <>
    <div className="node-icon" style={{ background: selectedNode?.data.color ?? detailsSelection.color }}><Box size={22} /></div>
    <h2>{selectedNode?.data.label ?? detailsSelection.label}</h2><p>{selectedNode?.data.detail ?? detailsSelection.detail}</p>

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
    </> : <div className="inspector-summary">
      <h2>{summary.title}</h2>
      <p>Select an activity to see its details.</p>
      <div className="property-section">
        <h3>Summary</h3>
        <div className="property-row"><span>Activities</span><strong>{summary.activities}</strong></div>
        <div className="property-row"><span>Connections</span><strong>{summary.connections}</strong></div>
        <div className="property-row"><span>Results</span><strong>{summary.status}</strong></div>
      </div>
    </div>}
  </div>
    </aside>
  )
}
