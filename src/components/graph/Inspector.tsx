import { Box, X } from "lucide-react"
import type { Node } from "@xyflow/react"
import { Button } from "@/components/ui/button"
import type { ProcessNodeData } from "@/components/ProcessNode"
import { useDisplaySettings } from "@/lib/displaySettings"
import { impactCategoryDisplayName } from "@/lib/lcaApi"
import type { SelectedGraphNode } from "@/state/productGraphStore"

/**
 * The property editor for the selected graph node.
 *
 * `inspectorSelection` is the last selection rather than the live one, so the
 * panel keeps its contents while animating closed.
 */
export type InspectorImpact = { label: string; unit: string; cumulative: number; percentage: number | null }

export function Inspector({
  selected, inspectorSelection, selectedNode, inputNodes, outputNodes,
  graphMode, showReferenceAmounts, setReferenceAmountsVisible, clearNodeSelection,
  nodeImpacts, categoryTotals,
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
  nodeImpacts: InspectorImpact[]
  categoryTotals: Array<{ label: string; unit: string; baseline: number; preview: number; delta: number }>
}) {
  const { formatNumber } = useDisplaySettings()
  const scope = selectedNode?.data.scope
  return (
    <aside className={`inspector${selected ? " is-open" : ""}`} aria-hidden={!selected} inert={!selected}>
  <>
    <div className="inspector-head"><span>NODE DETAILS</span><Button variant="ghost" size="icon" onClick={clearNodeSelection} aria-label="Close property editor" title="Close property editor"><X size={16} /></Button></div>
    <div className="node-icon" style={{ background: selectedNode?.data.color ?? inspectorSelection.color }}><Box size={22} /></div>
    <h2>{selectedNode?.data.label ?? inspectorSelection.label}</h2><p>{selectedNode?.data.detail ?? inspectorSelection.detail}</p>
    {graphMode === "scaled" && nodeImpacts.length ? <div className="property-section is-impact">
      <h3>{scope === "background" ? "Branch contribution" : "Cumulative impact"}</h3>
      {nodeImpacts.map((impact) => <div className="property-row" key={impact.label}>
        <span>{impactCategoryDisplayName(impact.label)}</span>
        <strong>
          {formatNumber(impact.cumulative)} <small>{impact.unit}</small>
          {impact.percentage === null ? null : <em className="property-share">{impact.percentage.toFixed(1)}%</em>}
        </strong>
      </div>)}
    </div> : null}
    {graphMode === "scaled" && categoryTotals.length ? <div className="property-section is-impact">
      <h3>System total</h3>
      {categoryTotals.map((total) => <div className="property-row" key={total.label}>
        <span>{impactCategoryDisplayName(total.label)}</span>
        <strong>
          {total.delta ? <em className="property-was">{formatNumber(total.baseline)}</em> : null}
          {formatNumber(total.preview)} <small>{total.unit}</small>
        </strong>
      </div>)}
    </div> : null}
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
    </aside>
  )
}
