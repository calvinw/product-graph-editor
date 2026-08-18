import { parse, stringify } from "yaml"
import type { BackgroundLinkIntensity, LcaResult } from "./lcaApi"

/**
 * Local scoring for background-input scenario edits.
 *
 * Holding the foreground structure fixed and varying only background input
 * amounts leaves the foreground scaling vector unchanged, so the score is
 * exactly linear in the edited amounts:
 *
 *   score_new = score_baseline
 *             + Σ s_F(consumer) × (amount_new − amount_baseline) × y_B(provider)
 *
 * Every term but the provider intensity is already in the base result. The
 * intensity arrives as `background_link_intensities`.
 *
 * Precision: Brightway stores technosphere amounts as float32, so a YAML 0.52
 * is scored server-side as 0.5199999809265137. A local preview therefore cannot
 * agree with the exact refresh to better than roughly 1e-7 relative. Compare
 * with RELATIVE_DRIFT_TOLERANCE, never for equality.
 */

export type ScenarioOverrides = Record<string, number>

export type CategoryPreview = {
  label: string
  unit: string
  baseline: number
  preview: number
  delta: number
  relativeDelta: number | null
}

/** Bounded by float32 storage of technosphere amounts (eps 1.19e-7). */
export const RELATIVE_DRIFT_TOLERANCE = 1e-6

export function backgroundLinks(result: LcaResult | null): BackgroundLinkIntensity[] {
  return result?.background_link_intensities ?? []
}

export function supportsRealtime(result: LcaResult | null): boolean {
  return Array.isArray(result?.background_link_intensities)
}

export function scenarioAmount(
  link: BackgroundLinkIntensity,
  overrides: ScenarioOverrides,
): number {
  const override = overrides[link.link_id]
  return Number.isFinite(override) ? override : link.amount
}

/**
 * Score every category in the base result under the given amount overrides.
 * With no overrides this reproduces the baseline exactly.
 */
export function scoreScenario(
  result: LcaResult,
  overrides: ScenarioOverrides,
): CategoryPreview[] {
  const links = backgroundLinks(result)
  return Object.entries(result.lcia).map(([label, impact]) => {
    const delta = links.reduce((total, link) => {
      const intensity = link.intensities[label]
      if (!Number.isFinite(intensity)) return total
      const scale = result.scaling_vector[link.process_name]
      if (!Number.isFinite(scale)) return total
      return total + scale * (scenarioAmount(link, overrides) - link.amount) * intensity
    }, 0)
    const preview = impact.score + delta
    return {
      label,
      unit: impact.unit,
      baseline: impact.score,
      preview,
      delta,
      relativeDelta: impact.score === 0 ? null : delta / Math.abs(impact.score),
    }
  })
}

/** True when an exact server score has drifted from what the preview claimed. */
export function exceedsDriftTolerance(preview: number, exact: number): boolean {
  const scale = Math.max(Math.abs(preview), Math.abs(exact), 1)
  return Math.abs(preview - exact) > scale * RELATIVE_DRIFT_TOLERANCE
}

/**
 * Write scenario amounts back into the source YAML, addressing each exchange by
 * the process/input index the engine used to build the link.
 */
export function applyScenarioToYaml(
  source: string,
  links: BackgroundLinkIntensity[],
  overrides: ScenarioOverrides,
): string {
  const document = parse(source) as {
    processes?: Array<{ inputs?: Array<{ amount: number }> }>
  }
  let changed = false
  for (const link of links) {
    const amount = overrides[link.link_id]
    if (!Number.isFinite(amount) || amount === link.amount) continue
    const exchange = document.processes?.[link.process_index]?.inputs?.[link.input_index]
    if (!exchange) continue
    exchange.amount = amount
    changed = true
  }
  return changed ? stringify(document) : source
}

/** A sensible slider range around a baseline amount. */
export function sliderBounds(amount: number): { min: number; max: number; step: number } {
  const max = amount > 0 ? amount * 2 : 1
  const step = max / 200
  return { min: 0, max, step }
}
