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

/**
 * The key a scenario override is stored under.
 *
 * The engine's `link_id` is a hash the browser cannot reproduce, but the graph
 * already identifies each edge by the same `(process_index, input_index)` pair
 * the engine keys providers on. Deriving the key from those two indices lets
 * an edge and a payload row agree without either needing the other's id.
 */
export const scenarioKey = (link: { process_index: number; input_index: number }) =>
  `${link.process_index}:${link.input_index}`

export type CategoryPreview = {
  label: string
  unit: string
  baseline: number
  preview: number
  delta: number
  relativeDelta: number | null
}

/**
 * Colours for impact categories, assigned by their order in the result.
 *
 * The same colour marks a category in the scenario panel and on every node, so
 * a number on the graph can be traced back to the category it belongs to
 * without a label beside it.
 */
export const IMPACT_COLORS = ["#38bdf8", "#f472b6", "#a78bfa", "#fbbf24", "#4ade80", "#fb923c"]
export const impactColor = (index: number) => IMPACT_COLORS[index % IMPACT_COLORS.length]

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
  const override = overrides[scenarioKey(link)]
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
    const amount = overrides[scenarioKey(link)]
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

/** Minimal process shape the cumulative solve needs from the product graph. */
export type ForegroundProcess = {
  name: string
  reference_output: { flow: string; amount: number }
  inputs?: Array<{ flow: string; amount: number; database?: string }>
}

export type NodeImpact = { label: string; unit: string; cumulative: number; percentage: number | null }

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solveDense(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = m[row][col] / m[col][col]
      if (!factor) continue
      for (let k = col; k <= n; k += 1) m[row][k] -= factor * m[col][k]
    }
  }
  return m.map((row, i) => row[n] / m[i][i])
}

/**
 * Cumulative impact of every foreground process, solved locally.
 *
 *   A_FF^T y_F = direct_char + Σ (background amount × y_B)
 *   cumulative(p) = s_F(p) × reference_output(p) × y_F(p)
 *
 * Every input is already in the Call 1 response: A_FF comes from the product
 * graph, `direct_char` is `direct_score / scaling_vector`, and the background
 * term is the Tier 2 payload. A background-amount edit changes only the right
 * hand side, so this re-solves exactly during a drag.
 */
export function solveForegroundCumulative(
  processes: ForegroundProcess[],
  result: LcaResult,
  overrides: ScenarioOverrides = {},
): Record<string, NodeImpact[]> {
  const links = backgroundLinks(result)
  const scaling = result.scaling_vector
  const index = new Map(processes.map((process, i) => [process.name, i]))
  const producer = new Map(processes.map((process) => [process.reference_output.flow, process.name]))
  const n = processes.length
  const impacts: Record<string, NodeImpact[]> = Object.fromEntries(processes.map((p) => [p.name, []]))
  if (!n) return impacts

  for (const [label, impact] of Object.entries(result.lcia)) {
    const category = result.process_contributions.categories.find((item) => item.label === label)
    if (!category) continue
    const direct = new Map(
      category.processes.filter((row) => row.scope === "foreground").map((row) => [row.process_name, row.direct_score]),
    )

    const a: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
    const rhs = Array(n).fill(0)
    processes.forEach((process, column) => {
      a[index.get(process.name)!][column] = process.reference_output.amount
      for (const input of process.inputs ?? []) {
        if (input.database) continue
        const row = index.get(producer.get(input.flow) ?? "")
        if (row !== undefined) a[row][column] = -input.amount
      }
      const scale = scaling[process.name]
      const directChar = scale ? (direct.get(process.name) ?? 0) / scale : 0
      const background = links
        .filter((link) => link.process_name === process.name)
        .reduce((total, link) => total + scenarioAmount(link, overrides) * (link.intensities[label] ?? 0), 0)
      rhs[column] = directChar + background
    })

    // Solve the transpose: rows are products, columns are activities.
    const transpose = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => a[j][i]))
    const y = solveDense(transpose, rhs)
    if (!y) continue

    processes.forEach((process, i) => {
      const raw = (scaling[process.name] ?? 0) * process.reference_output.amount * y[i]
      // Elimination leaves tiny signed residues where the true value is zero;
      // showing them as -0.000000 reads as a negative impact.
      const cumulative = Math.abs(raw) < Math.abs(impact.score) * 1e-9 ? 0 : raw
      impacts[process.name].push({
        label,
        unit: impact.unit,
        cumulative,
        percentage: impact.score ? (cumulative / impact.score) * 100 : null,
      })
    })
  }
  return impacts
}
