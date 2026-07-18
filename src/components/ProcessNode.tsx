import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { ArrowRight, Component, Minus, Package, Plus } from "lucide-react"

type FlowItem = { label: string; kind: string; color: string }

export type ProcessNodeData = {
  label: string
  kind: string
  detail: string
  color: string
  faded?: boolean
  expanded?: boolean
  inputs?: FlowItem[]
  outputs?: FlowItem[]
  onRemove?: (id: string) => void
  onRestore?: (id: string) => void
  canRestore?: boolean
}

function ProcessNodeImpl({ id, data, selected }: NodeProps & { data: ProcessNodeData }) {
  return (
    <div
      className={`pg-node ${data.expanded ? "is-expanded" : ""} ${selected ? "is-selected" : ""} ${data.faded ? "is-faded" : ""}`}
      style={{ "--node-color": data.color } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="pg-handle" />
      {data.expanded ? (
        <>
          <div className="pg-node-head">
            <span className="pg-collapse-hint"><Minus size={11} /></span>
            <Component size={14} />
            <span className="pg-node-label">{data.label}</span>
            <div className="pg-node-actions">
              <button type="button" className="pg-node-restore" aria-label={`Show steps after ${data.label}`} disabled={!data.canRestore} onClick={(event) => { event.stopPropagation(); data.onRestore?.(id) }}><Plus size={11} /></button>
              <button type="button" className="pg-node-remove" aria-label={`Fold steps after ${data.label}`} onClick={(event) => { event.stopPropagation(); data.onRemove?.(id) }}><Minus size={11} /></button>
            </div>
          </div>
          <div className="pg-flow-section">
            <div className="pg-flow-title"><ArrowRight size={11} /> Input flows</div>
            {data.inputs?.length ? data.inputs.map((item) => (
              <div className="pg-flow-row" key={item.label}><Package size={14} style={{ color: item.color }} /><span>{item.label}</span><small>{item.kind}</small></div>
            )) : <div className="pg-flow-empty">No input flows</div>}
          </div>
          <div className="pg-flow-divider" />
          <div className="pg-flow-section is-output">
            <div className="pg-flow-title">Output flows <ArrowRight size={11} /></div>
            {data.outputs?.length ? data.outputs.map((item) => (
              <div className="pg-flow-row" key={item.label}><Package size={14} style={{ color: item.color }} /><span>{item.label}</span><small>{item.kind}</small></div>
            )) : <div className="pg-flow-empty">No output flows</div>}
          </div>
        </>
      ) : (
        <>
          <span className="pg-node-icon"><Component size={12} /></span>
          <span className="pg-node-label">{data.label}</span>
          <div className="pg-node-actions">
            <button type="button" className="pg-node-restore" aria-label={`Show steps after ${data.label}`} disabled={!data.canRestore} onClick={(event) => { event.stopPropagation(); data.onRestore?.(id) }}><Plus size={11} /></button>
            <button type="button" className="pg-node-remove" aria-label={`Fold steps after ${data.label}`} onClick={(event) => { event.stopPropagation(); data.onRemove?.(id) }}><Minus size={11} /></button>
          </div>
        </>
      )}
      <Handle type="source" position={Position.Right} className="pg-handle" />
    </div>
  )
}

export const ProcessNode = memo(ProcessNodeImpl)
