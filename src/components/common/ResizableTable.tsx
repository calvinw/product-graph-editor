import { useRef } from "react"

export function ColumnResizeHandle({ label, width, onResize }: {
  label: string
  width: number
  onResize: (width: number) => void
}) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const resize = (nextWidth: number) => onResize(Math.max(80, Math.round(nextWidth)))

  return <span
    className="column-resize-handle"
    role="separator"
    aria-label={`Resize ${label} column`}
    aria-orientation="vertical"
    aria-valuemin={80}
    aria-valuenow={width}
    tabIndex={0}
    onPointerDown={(event) => {
      event.preventDefault()
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return
      resize(drag.current.startWidth + event.clientX - drag.current.startX)
    }}
    onPointerUp={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={() => { drag.current = null }}
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      event.preventDefault()
      const step = event.shiftKey ? 40 : 10
      resize(width + (event.key === "ArrowRight" ? step : -step))
    }}
  />
}

export function ResizableTableHeader({ labels, widths, onWidthsChange }: {
  labels: string[]
  widths: number[]
  onWidthsChange: (widths: number[]) => void
}) {
  const resizeColumn = (index: number, requestedWidth: number) => {
    const nextWidths = [...widths]
    const adjacentWidth = widths[index + 1]
    if (adjacentWidth === undefined) {
      nextWidths[index] = requestedWidth
    } else {
      // Honour the requested width, and let the neighbour absorb as much of the
      // change as it can without dropping below its minimum. Once it bottoms
      // out the table grows instead, which is what the wrapper scrolls.
      const change = requestedWidth - widths[index]
      const absorbed = Math.min(change, adjacentWidth - 80)
      nextWidths[index] = requestedWidth
      nextWidths[index + 1] = adjacentWidth - absorbed
    }
    onWidthsChange(nextWidths)
  }
  return <>
    <colgroup>{widths.map((width, index) => <col key={`${index}:${labels[index]}`} style={{ width }} />)}</colgroup>
    <thead><tr>{labels.map((label, index) => <th key={`${index}:${label}`}>{label}<ColumnResizeHandle label={label} width={widths[index]} onResize={(width) => resizeColumn(index, width)} /></th>)}</tr></thead>
  </>
}

