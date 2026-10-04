import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Component, Minus, Plus } from "lucide-react"

type FlowItem = { label: string; kind: string; color: string; amount?: number; unit?: string }
type InventoryItem = { label: string; amount?: number; unit?: string }

export type ProcessNodeData = {
  label: string
  kind: string
  detail: string
  color: string
  scope?: "foreground" | "background"
  database?: string
  code?: string
  location?: string
  backgroundDemand?: number
  backgroundDemandUnit?: string
  faded?: boolean
  inputs?: FlowItem[]
  outputs?: FlowItem[]
  referenceInputs?: FlowItem[]
  referenceOutputs?: FlowItem[]
  emissions?: InventoryItem[]
  extractions?: InventoryItem[]
  biosphere?: InventoryItem[]
  referenceEmissions?: InventoryItem[]
  referenceExtractions?: InventoryItem[]
  referenceBiosphere?: InventoryItem[]
  backgroundLoading?: boolean
  backgroundExploring?: boolean
  backgroundLoaded?: boolean
  backgroundError?: string
  backgroundParentId?: string
  backgroundExplored?: boolean
  onToggleBackground?: (id: string) => void
  showAmounts?: boolean
  onRemove?: (id: string) => void
  onRestore?: (id: string) => void
  canRestore?: boolean
  canFold?: boolean
  /** Per-category contribution of this activity, shown while a scenario is live. */
  impacts?: Array<{ label: string; value: string; color: string }>
}

/**
 * A compact activity card. Its details (flows, emissions, biosphere
 * exchanges) live in the Property Editor, which opens when the card is clicked.
 */
function ProcessNodeImpl({ id, data, selected, sourcePosition = Position.Right, targetPosition = Position.Left }: NodeProps & { data: ProcessNodeData }) {
  const showToggle = data.scope === "background" || data.canFold || data.canRestore
  const toggleLabel = data.scope === "background"
    ? `${data.backgroundExplored ? "Hide" : "Show"} upstream background steps for ${data.label}`
    : data.canRestore ? `Show connected steps for ${data.label}` : `Fold connected steps for ${data.label}`
  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (data.scope === "background") data.onToggleBackground?.(id)
    else if (data.canRestore) data.onRestore?.(id)
    else data.onRemove?.(id)
  }

  return (
    <div
      className={`pg-node ${selected ? "is-selected" : ""} ${data.faded ? "is-faded" : ""}`}
      style={{ "--node-color": data.color } as React.CSSProperties}
    >
      <Handle type="target" position={targetPosition} className="pg-handle" />
      {showToggle ? <button
        type="button"
        className="pg-node-toggle"
        aria-label={toggleLabel}
        onClick={toggle}
      >
        {data.scope === "background" ? (data.backgroundExplored ? <Minus size={11} /> : <Plus size={11} />) : data.canRestore ? <Plus size={11} /> : <Minus size={11} />}
      </button> : null}
      <span className="pg-node-icon"><Component size={12} /></span>
      <span className="pg-node-label">{data.label}</span>
      {data.impacts?.length ? <div className="pg-node-impacts">
        {data.impacts.map((impact) => (
          <span key={impact.label} style={{ color: impact.color }} title={impact.label}>{impact.value}</span>
        ))}
      </div> : null}
      <Handle type="source" position={sourcePosition} className="pg-handle" />
    </div>
  )
}

export const ProcessNode = memo(ProcessNodeImpl)
