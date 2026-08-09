import { memo, useEffect } from "react"
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { ArrowRight, Component, Minus, Package, Plus } from "lucide-react"
import { useDisplaySettings } from "../lib/displaySettings"

type FlowItem = { label: string; kind: string; color: string; amount?: number; unit?: string; handleId?: string }
type InventoryItem = { label: string; amount?: number; unit?: string }
export type MaterialMetadata = {
  category?: string
  materialFamily?: string
  composition?: Array<{ material: string; percentage: number }>
  geography?: string
  dataYear?: number
  sourceName?: string
  datasetCode?: string
  recycledContent?: number
  confidence?: "low" | "medium" | "high"
  qualityNotes?: string
}

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
  expanded?: boolean
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
  materialMetadata?: MaterialMetadata
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
}

function ProcessNodeImpl({ id, data, selected, sourcePosition = Position.Right, targetPosition = Position.Left }: NodeProps & { data: ProcessNodeData }) {
  const updateNodeInternals = useUpdateNodeInternals()
  const { formatNumber: displayNumber } = useDisplaySettings()
  const inputHandleSignature = data.inputs?.map((item) => item.handleId ?? "").join("|") ?? ""
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

  useEffect(() => {
    updateNodeInternals(id)
  }, [data.expanded, id, inputHandleSignature, updateNodeInternals])

  return (
    <div
      className={`pg-node ${data.expanded ? "is-expanded" : ""} ${selected ? "is-selected" : ""} ${data.faded ? "is-faded" : ""}`}
      style={{ "--node-color": data.color } as React.CSSProperties}
    >
      <Handle type="target" position={targetPosition} className="pg-handle" />
      {data.expanded ? (
        <>
          <div className="pg-node-head">
            {showToggle ? <button
              type="button"
              className="pg-node-toggle"
              aria-label={toggleLabel}
              onClick={toggle}
            >
              {data.scope === "background" ? (data.backgroundExplored ? <Minus size={11} /> : <Plus size={11} />) : data.canRestore ? <Plus size={11} /> : <Minus size={11} />}
            </button> : null}
            <Component size={14} />
            <span className="pg-node-label">{data.label}</span>
            <small className={`pg-node-scope is-${data.scope}`}>{data.scope}</small>
          </div>
          <div className="pg-flow-section">
            <div className="pg-flow-title"><ArrowRight size={11} /> {data.scope === "background" ? "Direct inputs" : "Input flows"}</div>
            {data.backgroundLoading ? <div className="pg-flow-empty">Loading unit process…</div>
              : data.backgroundError ? <div className="pg-flow-empty is-error">{data.backgroundError}</div>
              : data.inputs?.length ? data.inputs.map((item) => (
                <div className="pg-flow-row" key={item.handleId ?? `${item.kind}-${item.label}`}>
                  {item.handleId ? <Handle id={item.handleId} type="target" position={targetPosition} className={`pg-flow-handle ${targetPosition === Position.Bottom ? "is-vertical" : ""}`} /> : null}
                  <Package size={14} style={{ color: item.color }} /><span>{item.label}</span>{item.amount === undefined ? (data.scope === "background" ? null : <small>{item.kind}</small>) : <small>{displayNumber(item.amount)}{item.unit ? ` ${item.unit}` : ""}</small>}
                </div>
              )) : <div className="pg-flow-empty">No input flows</div>}
          </div>
          <div className="pg-flow-divider" />
          <div className="pg-flow-section is-output">
            <div className="pg-flow-title">Output flows <ArrowRight size={11} /></div>
            {data.outputs?.length ? data.outputs.map((item) => (
              <div className="pg-flow-row" key={`${item.kind}-${item.label}`}><Package size={14} style={{ color: item.color }} /><span>{item.label}</span>{item.amount === undefined ? (data.scope === "background" ? null : <small>{item.kind}</small>) : <small>{displayNumber(item.amount)}{item.unit ? ` ${item.unit}` : ""}</small>}</div>
            )) : <div className="pg-flow-empty">No output flows</div>}
          </div>
          {data.biosphere?.length ? <div className="pg-biosphere">
            <div className="pg-biosphere-title">Biosphere exchanges</div>
            {data.biosphere.map((item) => <div className="pg-biosphere-row" key={item.label}><span>{item.label}</span>{item.amount === undefined ? null : <strong>{displayNumber(item.amount)}{item.unit ? ` ${item.unit}` : ""}</strong>}</div>)}
          </div> : null}
          {data.extractions?.length ? <div className="pg-extractions">
            <div className="pg-extractions-title">Resource extractions</div>
            {data.extractions.map((extraction) => <div className="pg-extraction-row" key={extraction.label}><span>{extraction.label}</span>{data.showAmounts !== false ? <strong>{displayNumber(extraction.amount ?? 0)} {extraction.unit}</strong> : null}</div>)}
          </div> : null}
          {data.emissions?.length ? <div className="pg-emissions">
            <div className="pg-emissions-title">Emissions to air</div>
            {data.emissions.map((emission) => <div className="pg-emission-row" key={emission.label}><span>{emission.label}</span>{data.showAmounts !== false ? <strong>{displayNumber(emission.amount ?? 0)} {emission.unit}</strong> : null}</div>)}
          </div> : null}
        </>
      ) : (
        <>
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
        </>
      )}
      <Handle type="source" position={sourcePosition} className="pg-handle" />
    </div>
  )
}

export const ProcessNode = memo(ProcessNodeImpl)
