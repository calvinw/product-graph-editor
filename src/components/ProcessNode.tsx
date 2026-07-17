import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Component, Minus } from "lucide-react"

export type ProcessNodeData = {
  label: string
  kind: string
  detail: string
  color: string
  faded?: boolean
  onRemove?: (id: string) => void
}

function ProcessNodeImpl({ id, data, selected }: NodeProps & { data: ProcessNodeData }) {
  return (
    <div
      className={`pg-node ${selected ? "is-selected" : ""} ${data.faded ? "is-faded" : ""}`}
      style={{ "--node-color": data.color } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="pg-handle" />
      <span className="pg-node-icon"><Component size={12} /></span>
      <span className="pg-node-label">{data.label}</span>
      <button
        type="button"
        className="pg-node-remove"
        aria-label={`Remove ${data.label}`}
        onClick={(event) => { event.stopPropagation(); data.onRemove?.(id) }}
      >
        <Minus size={11} />
      </button>
      <Handle type="source" position={Position.Right} className="pg-handle" />
    </div>
  )
}

export const ProcessNode = memo(ProcessNodeImpl)
