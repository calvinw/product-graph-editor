import { useMemo } from "react"
import { ArrowRight, RotateCcw, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDisplaySettings } from "@/lib/displaySettings"
import { impactCategoryDisplayName, type LcaResult } from "@/lib/lcaApi"
import {
  backgroundLinks,
  scenarioKey,
  scenarioAmount,
  scoreScenario,
  sliderBounds,
  supportsRealtime,
  type ScenarioOverrides,
} from "@/lib/realtimeScore"

function Placeholder({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="results-panel realtime-panel">
    <div className="results-panel-head">
      <div><strong>Realtime scenario</strong><span>Vary background inputs and see impacts update immediately.</span></div>
    </div>
    <div className="results-placeholder">
      <div className="results-empty-icon"><Zap size={22} /></div>
      <strong>{title}</strong>
      {children}
    </div>
  </div>
}

export function RealtimeView({
  result,
  isCurrent,
  error,
  overrides,
  onOverride,
  onReset,
  onCommit,
  committing,
}: {
  result: LcaResult | null
  isCurrent: boolean
  error: string
  overrides: ScenarioOverrides
  onOverride: (linkId: string, amount: number) => void
  onReset: () => void
  onCommit: () => void
  committing: boolean
}) {
  const { formatNumber } = useDisplaySettings()
  const links = useMemo(() => backgroundLinks(result), [result])
  const previews = useMemo(
    () => (result ? scoreScenario(result, overrides) : []),
    [result, overrides],
  )

  if (!result || !isCurrent) return <Placeholder title="No current results">
    <p>Calculate the LCA to establish a baseline, then vary its background inputs here.</p>
    {error ? <div className="results-error"><strong>Calculation failed</strong><p>{error}</p></div> : null}
  </Placeholder>

  if (!supportsRealtime(result)) return <Placeholder title="Live preview unavailable">
    <p>
      This calculation engine did not return background provider intensities, so scores
      cannot be previewed locally. The engine needs its background intensity cache enabled.
    </p>
  </Placeholder>

  if (!links.length) return <Placeholder title="No background inputs to vary">
    <p>
      Every input in this product graph is produced by another foreground process. Realtime
      varies inputs drawn from a background database, and this graph has none.
    </p>
  </Placeholder>

  const dirty = links.some((link) => scenarioAmount(link, overrides) !== link.amount)

  return <div className="results-panel realtime-panel">
    <div className="results-panel-head">
      <div>
        <strong>Realtime scenario</strong>
        <span>{result.functional_unit}</span>
      </div>
      <div className="realtime-actions">
        <Button variant="ghost" size="sm" onClick={onReset} disabled={!dirty || committing}>
          <RotateCcw data-icon="inline-start" /> Reset
        </Button>
        <Button size="sm" onClick={onCommit} disabled={!dirty || committing}>
          {committing ? "Calculating…" : "Update YAML"}
        </Button>
      </div>
    </div>

    <div className="realtime-body">
      <section className="realtime-scores" aria-label="Impact category preview">
        {previews.map((preview) => {
          const changed = preview.delta !== 0
          const direction = preview.delta < 0 ? "down" : "up"
          return <article className="realtime-score" key={preview.label}>
            <header>{impactCategoryDisplayName(preview.label)}</header>
            <div className="realtime-score-values">
              {changed ? <span className="realtime-score-baseline">{formatNumber(preview.baseline)}</span> : null}
              {changed ? <ArrowRight size={14} className="realtime-score-arrow" /> : null}
              <span className={`realtime-score-preview${changed ? ` is-${direction}` : ""}`}>
                {formatNumber(preview.preview)}
              </span>
            </div>
            <footer>
              <span className="realtime-score-unit">{preview.unit}</span>
              {changed && preview.relativeDelta !== null
                ? <span className={`realtime-score-delta is-${direction}`}>
                    {preview.delta < 0 ? "−" : "+"}{(Math.abs(preview.relativeDelta) * 100).toFixed(1)}%
                  </span>
                : null}
            </footer>
          </article>
        })}
      </section>

      <section className="realtime-sliders" aria-label="Background inputs">
        {links.map((link) => {
          const amount = scenarioAmount(link, overrides)
          const { min, max, step } = sliderBounds(link.amount)
          const edited = amount !== link.amount
          return <div className={`realtime-slider${edited ? " is-edited" : ""}`} key={link.link_id}>
            <div className="realtime-slider-head">
              <div className="realtime-slider-label">
                <strong>{link.flow}</strong>
                <span>
                  {link.process_name} · {link.database}
                  {link.location ? ` · ${link.location}` : ""}
                </span>
              </div>
              <div className="realtime-slider-amount">
                <span className="number">{formatNumber(amount)}</span>
                <span className="realtime-slider-unit">{link.unit}</span>
              </div>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={amount}
              aria-label={`${link.flow} amount in ${link.unit}`}
              onChange={(event) => onOverride(scenarioKey(link), Number(event.target.value))}
            />
            <div className="realtime-slider-scale">
              <span>{formatNumber(min)}</span>
              <span>baseline {formatNumber(link.amount)} {link.unit}</span>
              <span>{formatNumber(max)}</span>
            </div>
          </div>
        })}
        <p className="realtime-note">
          Previewed scores are exact for background-input changes. Inventory, contributions,
          and Sankey widths stay at the last exact calculation until you recalculate.
        </p>
      </section>
    </div>
  </div>
}
