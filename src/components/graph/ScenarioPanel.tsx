import { useEffect, useRef } from "react"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDisplaySettings } from "@/lib/displaySettings"
import { impactCategoryDisplayName } from "@/lib/lcaApi"
import { impactColor, type CategoryPreview } from "@/lib/realtimeScore"
import { RailResizeHandle } from "./RailResizeHandle"

/**
 * Impact of the pending scenario, shown only while edits are outstanding.
 *
 * These scores belong to the scenario rather than to any one node, which is
 * why they are their own panel rather than part of the property editor.
 *
 * It docks in the same right-hand rail as the property editor and shares its
 * chrome, sitting above it when both are open. It used to float over the graph
 * and be draggable to get out of the way; docking removes that need, since the
 * canvas shrinks to make room exactly as it does for the property editor.
 */
export function ScenarioPanel({
  editCount, stacked, categoryTotals, calculating, onReset, onCommit,
  categoryOrder, visibleCategories, onToggleCategory,
}: {
  editCount: number
  /** True when the property editor is also open and the rail must be shared. */
  stacked: boolean
  categoryTotals: CategoryPreview[]
  calculating: boolean
  onReset: () => void
  onCommit: () => void
  categoryOrder: string[]
  visibleCategories: string[]
  onToggleCategory: (label: string) => void
}) {
  const { formatNumber } = useDisplaySettings()
  const panelRef = useRef<HTMLElement | null>(null)

  // The property editor sits below this panel in the same rail, so it needs to
  // know how tall this one is. Published as a CSS variable and kept current
  // with a ResizeObserver, because the height changes with the number of
  // impact categories rather than being fixed.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const root = document.documentElement
    const publish = () => root.style.setProperty("--scenario-panel-height", `${panel.offsetHeight + 12}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(panel)
    return () => {
      observer.disconnect()
      root.style.removeProperty("--scenario-panel-height")
    }
  }, [])

  return (
    <aside ref={panelRef} className={`scenario-panel${stacked ? " is-stacked" : ""}`} role="status" aria-label="Scenario impact">
      <RailResizeHandle panelRef={panelRef} label="Resize scenario and property panels" />
      <header>
        <strong>Scenario</strong>
        <span>{editCount} input{editCount === 1 ? "" : "s"} changed</span>
      </header>

      <div className="scenario-panel-toggles" role="group" aria-label="Impact category calculations">
        {categoryOrder.map((label, index) => {
          const on = visibleCategories.includes(label)
          return (
            <button
              key={label}
              type="button"
              role="switch"
              className={`scenario-toggle${on ? " is-on" : ""}`}
              aria-checked={on}
              aria-label={`${on ? "Disable" : "Enable"} ${impactCategoryDisplayName(label)} calculation`}
              onClick={() => onToggleCategory(label)}
              style={on ? { borderColor: impactColor(index), color: impactColor(index) } : undefined}
            >
              <span className="scenario-toggle-switch" aria-hidden="true"><span /></span>
              <span>{impactCategoryDisplayName(label)}</span>
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
                {/* Coloured by category, as on the graph. Direction is carried
                    by the arrow and the signed percentage, so colour never
                    means two different things. */}
                <strong style={{ color: impactColor(categoryOrder.indexOf(total.label)) }}>
                  {formatNumber(total.preview)}
                </strong>
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
        <Button variant="ghost" size="sm" onClick={onReset} disabled={calculating}>Reset</Button>
        <Button size="sm" onClick={onCommit} disabled={calculating}>
          {calculating ? "Calculating…" : "Save to File"}
        </Button>
      </footer>
    </aside>
  )
}
