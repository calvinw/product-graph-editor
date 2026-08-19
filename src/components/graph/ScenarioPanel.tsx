import { useRef, useState } from "react"
import { ArrowRight, GripHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDisplaySettings } from "@/lib/displaySettings"
import { impactCategoryDisplayName } from "@/lib/lcaApi"
import { impactColor, type CategoryPreview } from "@/lib/realtimeScore"

/**
 * Impact of the pending scenario, shown only while edits are outstanding.
 *
 * These scores belong to the scenario rather than to any one node, which is
 * why they live here and not in the property editor. The panel can be dragged
 * by its header, since it sits over the graph and would otherwise cover the
 * part of it a person is working on.
 */
export function ScenarioPanel({
  editCount, categoryTotals, calculating, onReset, onCommit,
  categoryOrder, visibleCategories, onToggleCategory,
}: {
  editCount: number
  categoryTotals: CategoryPreview[]
  calculating: boolean
  onReset: () => void
  onCommit: () => void
  categoryOrder: string[]
  visibleCategories: string[]
  onToggleCategory: (label: string) => void
}) {
  const { formatNumber } = useDisplaySettings()
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)

  return (
    <aside
      className="scenario-panel"
      role="status"
      aria-label="Scenario impact"
      style={{ transform: `translateX(-50%) translate(${offset.x}px, ${offset.y}px)` }}
    >
      <header
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return
          event.preventDefault()
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX, startY: event.clientY,
            originX: offset.x, originY: offset.y,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return
          setOffset({
            x: drag.current.originX + event.clientX - drag.current.startX,
            y: drag.current.originY + event.clientY - drag.current.startY,
          })
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return
          drag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => { drag.current = null }}
      >
        <GripHorizontal size={14} className="scenario-panel-grip" aria-hidden />
        <strong>Scenario</strong>
        <span>{editCount} input{editCount === 1 ? "" : "s"} changed</span>
      </header>

      <div className="scenario-panel-toggles" role="group" aria-label="Categories shown on the graph">
        {categoryOrder.map((label, index) => {
          const on = visibleCategories.includes(label)
          return (
            <button
              key={label}
              type="button"
              className={`scenario-toggle${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => onToggleCategory(label)}
              style={on ? { borderColor: impactColor(index), color: impactColor(index) } : undefined}
            >
              <span className="scenario-toggle-dot" style={{ background: impactColor(index) }} />
              {impactCategoryDisplayName(label)}
            </button>
          )
        })}
      </div>
      <div className="scenario-panel-scores">
        {categoryTotals.map((total) => {
          const direction = total.delta < 0 ? "down" : total.delta > 0 ? "up" : "flat"
          return (
            <div className="scenario-score" key={total.label}>
              <span className="scenario-score-name">
                <span className="scenario-toggle-dot" style={{ background: impactColor(categoryOrder.indexOf(total.label)) }} />
                {impactCategoryDisplayName(total.label)}
              </span>
              <span className="scenario-score-values">
                <em>{formatNumber(total.baseline)}</em>
                <ArrowRight size={12} />
                <strong className={`is-${direction}`}>{formatNumber(total.preview)}</strong>
                <small>{total.unit}</small>
              </span>
              {total.relativeDelta === null ? null : (
                <span className={`scenario-score-delta is-${direction}`}>
                  {total.delta < 0 ? "−" : "+"}{(Math.abs(total.relativeDelta) * 100).toFixed(1)}%
                </span>
              )}
            </div>
          )
        })}
      </div>

      <footer>
        <span>Scores are exact. Inventory, contributions and Sankey need a calculation.</span>
        <Button variant="ghost" size="sm" onClick={onReset} disabled={calculating}>Reset</Button>
        <Button size="sm" onClick={onCommit} disabled={calculating}>
          {calculating ? "Calculating…" : "Done"}
        </Button>
      </footer>
    </aside>
  )
}
