import { useRef } from "react"
import {
  BaseEdge, EdgeLabelRenderer, getBezierPath,
  type Edge, type EdgeProps,
} from "@xyflow/react"

export type ScenarioEdgeData = {
  /** `${process_index}:${input_index}` — shared with the engine payload. */
  scenarioKey: string
  /** Amount from the last exact calculation, and the anchor for the range. */
  baselineAmount: number
  /** Current amount, which is the baseline unless a scenario override applies. */
  amount: number
  unit?: string
  /** Foreground scale of the consuming process, for the displayed quantity. */
  scale: number
  label: string
  onScenarioChange?: (key: string, amount: number) => void
}

/** Pixels of horizontal travel that sweep the whole range. */
const DRAG_SPAN = 220

/**
 * A background-input edge whose label is draggable.
 *
 * React Flow draws edge labels as SVG text, which cannot take interaction, so
 * the label is rendered as HTML through EdgeLabelRenderer and positioned over
 * the edge. Dragging maps horizontal travel onto 0..2x the baseline amount.
 *
 * Editing only previews: it writes a scenario override and nothing reaches the
 * YAML until the Update YAML button in the ScenarioPanel is pressed. There is
 * currently no way to set an amount beyond 2x the baseline on the graph.
 */
export function ScenarioEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, markerEnd, style, data,
}: EdgeProps<Edge<ScenarioEdgeData>>) {
  const drag = useRef<{ pointerId: number; startX: number; startAmount: number } | null>(null)
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  })
  if (!data) return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />

  const { scenarioKey, baselineAmount, amount, label, onScenarioChange } = data
  const max = baselineAmount > 0 ? baselineAmount * 2 : 1
  const edited = amount !== baselineAmount
  const draggable = Boolean(onScenarioChange)

  const setFromPointer = (clientX: number) => {
    if (!drag.current) return
    const delta = (clientX - drag.current.startX) / DRAG_SPAN * max
    const next = Math.min(max, Math.max(0, drag.current.startAmount + delta))
    onScenarioChange?.(scenarioKey, next)
  }

  const nudge = (step: number) => {
    onScenarioChange?.(scenarioKey, Math.min(max, Math.max(0, amount + step)))
  }

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className={`scenario-edge-label${edited ? " is-edited" : ""}${draggable ? " is-draggable" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          role={draggable ? "slider" : undefined}
          tabIndex={draggable ? 0 : undefined}
          aria-label={draggable ? `${label} amount` : undefined}
          aria-valuemin={draggable ? 0 : undefined}
          aria-valuemax={draggable ? max : undefined}
          aria-valuenow={draggable ? amount : undefined}
          onPointerDown={(event) => {
            if (!draggable) return
            // Without this React Flow pans the canvas instead of dragging the value.
            event.stopPropagation()
            event.preventDefault()
            drag.current = { pointerId: event.pointerId, startX: event.clientX, startAmount: amount }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return
            event.stopPropagation()
            setFromPointer(event.clientX)
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return
            event.stopPropagation()
            drag.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => { drag.current = null }}
          onKeyDown={(event) => {
            if (!draggable) return
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
            event.preventDefault()
            const step = (max / (event.shiftKey ? 20 : 100)) * (event.key === "ArrowRight" ? 1 : -1)
            nudge(step)
          }}
        >
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
