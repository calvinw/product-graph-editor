# Plan: Realtime Scenario View

Status: awaiting the engine field; branch created  
Date: August 18, 2026  
Branch: `realtime`, branched from `ai-chat`  
Coordinated engine plan:
[`life-cycle-assessment-mcp/plans/PLAN_tier2_provider_intensities.md`](../../life-cycle-assessment-mcp/plans/PLAN_tier2_provider_intensities.md)

## Goal

Add a `Realtime` view where the user drags background input amounts and sees
every configured impact category update immediately, without a server round
trip. The exact server calculation still runs on release and remains the source
of truth.

## Agreed scope

- **Sliders in v1:** background input amounts only. Yield, emission, and
  provider-swap sliders are deferred; they need engine payloads Tier 2 does not
  add.
- **View source:** the current workspace graph. Realtime reads `appliedYaml` and
  `lcaResult` from `productGraphStore`. It does not get its own template picker;
  the existing model/template menu already loads graphs, and this way Realtime
  also works on a user's own edited or uploaded YAML.

## Prerequisite

Realtime requires the engine's `background_link_intensities` field, which is
present only when the server runs with `LCA_BACKGROUND_INTENSITY_CACHE` set to
`compare` or `on`. Production runs `on`. The view must degrade cleanly when the
field is absent.

## The local score

Because only background input amounts change, the foreground scaling vector is
unchanged and the score is exactly linear in the edited amounts:

```text
score_new = score_baseline
          + Σ  s_F(consumer) × (amount_new − amount_baseline) × y_B(provider)
```

`s_F(consumer)` is `lcaResult.scaling_vector[process_name]`. `score_baseline` is
`lcaResult.lcia[label].score`. `y_B(provider)` is the new field. The edited
amount is the slider value.

### Precision floor

Brightway stores technosphere amounts as **float32**: a YAML `0.52` becomes
`0.5199999809265137` in the matrix. The server scores with the rounded amount;
the browser multiplies the exact one. A local preview therefore cannot agree
with the exact refresh to better than about `1e-7` relative, and measured
residuals on the bundled graphs run `1.1e-8` to `5.8e-8`.

Set the drift check at `1e-6` relative. This is invisible at the five decimal
places the UI shows, but it means "preview equals exact" is the wrong assertion
to write in a test. The engine plan documents the measurement.

Do **not** reuse the scaling computed in `yamlGraph.ts`. Its BFS takes the
maximum required scale per provider rather than the sum
(`src/lib/yamlGraph.ts`, the `requiredScale >` comparison), which is wrong for a
product consumed by more than one process. Realtime uses the server's
`scaling_vector` instead, which is exact. Fixing the BFS is a separate concern
and is only required if yield sliders are added later.

## Changes

### `src/lib/lcaApi.ts`

- Add `BackgroundLinkIntensity` type mirroring the engine contract.
- Add `background_link_intensities?: BackgroundLinkIntensity[]` to `LcaResult`.
- Keep the `result_schema_version !== 3` gate at line 245 unchanged. The field is
  additive and optional; detect its presence rather than bumping the gate.

### `src/lib/realtimeScore.ts` (new)

A pure, dependency-free module:

```ts
type ScenarioOverrides = Record<string, number>   // link_id -> amount

function scoreScenario(
  result: LcaResult,
  overrides: ScenarioOverrides,
): Record<string, { baseline: number; preview: number; unit: string }>
```

Pure functions here keep the arithmetic unit-testable without React.

### `src/state/productGraphStore.ts`

- Add `"realtime"` to `ProductGraphView`.
- Add `scenarioOverrides: ScenarioOverrides` plus `setScenarioOverride` and
  `resetScenario` actions.
- Clear overrides in `applySource` and on `completeCalculation`, so a new
  baseline never carries stale deltas.

### `src/components/RealtimeView.tsx` (new)

- One slider per entry in `background_link_intensities`, labelled with the flow
  name, provider database/location, and unit.
- A live category panel showing baseline → preview per category, matching the
  delta treatment described in the engine repo's
  `plans/proposed_interactive_lca_scenario_ui.md`.
- Reset control.
- On slider release, write the edited amounts back into the YAML and trigger the
  normal exact calculation, then reconcile: if the exact score differs from the
  preview beyond a small tolerance, surface it rather than silently replacing
  the number. Any drift means a Tier 2 assumption is wrong and should be visible.
- While dragging, follow the existing structure-mode discipline: do not display
  inventory amounts, activity scales, or Sankey widths, which are stale until
  the exact refresh returns.

### `src/App.tsx`

- Register `realtime` in the view switcher near the existing entries at lines
  2586 and 2634, and in the render chain at line 2724.
- Decide whether Realtime belongs in `analysisViews` (line 70). It requires a
  completed baseline result, so it behaves like an analysis view and should
  respect `hasCurrentResults`.

### `src/ai/viewTools.ts`

- Add a `realtime` entry to the view list at line 118 with
  `requiresResults: true`, so the AI chat can navigate to it. This branch
  descends from `ai-chat`, so omitting this would leave the chat unable to reach
  the new view.

## Empty and degraded states

| Condition | Behaviour |
|---|---|
| No baseline result yet | Prompt to calculate, consistent with other analysis views |
| Graph has no background links | "This graph has no background inputs to vary." Four bundled graphs are in this case: `cotton_fiber`, `jacket`, `polyester_tshirt`, `wool_yarn` |
| `background_link_intensities` absent | Explain that live preview needs the server's intensity cache; keep the view usable read-only |

## Test targets

- `realtimeScore` reproduces the baseline exactly when overrides are empty.
- A single-link override matches a hand-computed expected value.
- Multi-link overrides are additive.
- Preview matches the engine's exact recalculation for the BAFU-linked plastic
  broom, the three-link reference case, to `1e-6` relative — not exactly; see
  the precision floor above.

## Out of scope

- Yield, emission, and provider-swap sliders.
- Normalization and weighting panel from the UI concept document.
- Any change to the contribution, Sankey, or inventory views.
- Fixing the `yamlGraph.ts` scaling BFS.
