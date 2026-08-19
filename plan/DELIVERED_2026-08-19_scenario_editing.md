# Delivered: Graph-Native Scenario Editing

Date: August 19, 2026  
Status: shipped to `main` as `aac1673` and live at
<https://calvinw.github.io/product-graph-editor/>  
Engine counterpart: `life-cycle-assessment-mcp` `main` at `fde2d04`, deployed to
<https://lca.mathplosion.com>

Plans: [`graph-native-scenario-editing.md`](graph-native-scenario-editing.md),
[`realtime-scenario-view.md`](realtime-scenario-view.md)

## What it does

Open the app on the BAFU plastic broom, calculate, switch to Scaled Graph, and
drag the amount on any background input edge. Every impact category updates
live and exactly. A draggable panel shows baseline, preview, and relative
change. **Done** commits the scenario to a real calculation, which refreshes
inventory, contributions, and Sankey.

## How it works

The engine publishes the cumulative intensity of every resolved background
provider on the Call 1 response, so the browser can rescore locally:

```text
score_new = score_baseline
          + Σ  s_F(consumer) × (amount_new − amount_baseline) × y_B(provider)
```

Holding foreground structure fixed leaves the scaling vector untouched, so the
score is exactly linear in the edited amounts. Everything but `y_B` was already
in the response.

## Engine work

| Tier | Outcome |
|---|---|
| Tier 1 — cache `y_B` | Merged after a one-day production observation gate, deployed. Call 2 median 891ms to 756ms. |
| Tier 2 — publish provider intensities | `background_link_intensities` on Call 1. Warm cost **0.031ms**. Merged and deployed. |

Tier 2's gate was a reconciliation invariant checkable from the response alone:
`total − Σ foreground direct == Σ s_F × amount × y_B`. It holds against
production at `2.2e-10` and `3.4e-08`.

## Editor work

Groundwork first, because the feature could not be built into the monolith.

| | Before | After |
|---|---|---|
| `App.tsx` | 3095 lines | ~570 |
| Visual suite | 27 passed / 5 failed | 31 / 1 |

- Extracted five analysis views, the welcome screen, file menu, dialogs, app
  controls, resizable table, and result helpers.
- Extracted `useCalculation`, `useModelWorkspace`, `useGraphModel`, plus
  `Inspector`, `GraphCanvas`, `ScenarioEdge`, and `ScenarioPanel`.
- Split `buildGraphFromYaml` into `buildGraphStructure` (parses YAML, runs once
  per applied source) and `decorateAmounts` (cheap, safe per frame). A drag
  neither reparses YAML nor re-runs dagre.

## Findings worth keeping

**Brightway stores technosphere amounts as float32.** `0.52` is held as
`0.5199999809265137`. Any client-side reconstruction is bounded at about `1e-7`
relative, so comparisons use `1e-6`, never equality. Every "unexplained"
residual measured all day traced back to this. See
`life-cycle-assessment-mcp/plans/PLAN_tier2_provider_intensities.md`.

**Foreground cumulative scores are locally solvable.** An earlier claim that
they were not was wrong. `A_FF` comes from the YAML, `direct_char` is
`direct_score / scaling_vector` from Call 1, and the background term is the
Tier 2 payload. Verified against the engine's own contribution graphs on 14
node/category pairs, worst difference `5.71e-8`. Implemented as
`solveForegroundCumulative`.

**Foreground technosphere edits are also locally solvable**, verified but not
built. Changing `A_FF` invalidates the server's scaling vector, but the browser
can re-solve it — `direct_char`, per-unit background amounts, and `y_B` are all
invariant under such an edit. Measured `3.4e-08` and `7.9e-09` against the
engine on the jacket. This would make the jacket's whole internal chain
editable; today nothing on it is draggable.

**Two of the planned six hooks were single concerns.** Workspace and view
routing share the save-before-navigate flow; background hydration is a
graph-model mutation. Both were found by attempting the split, not by reading
the code. A third apparent cycle, `appliedRevisionRef`, was simply a misfiled
ref.

## Defects found and fixed

- **Mouse column resize did nothing on sticky-header tables.** The handle sat
  at `right: -5px`, protruding into the next header, which paints over it under
  `position: sticky`. Keyboard resize always worked, hiding it.
- **A column could not grow past its neighbour's 80px minimum.** Masked: the
  horizontal-scroll test passed only because of the protruding handle above.
- **The closed property editor stayed in the accessibility and hit-testing
  tree**, hidden by opacity alone.
- **The foreground scaling walk took the maximum rather than the sum** of what
  consumers required, under-scaling any shared provider. Latent, but Phase 3
  made the walk load-bearing.
- Two whole-page visual baselines predated the AI chat work.

Three defects introduced and fixed during the work: an infinite render loop
from an unstable callback in a memo dependency, the graph dropping to structure
mode mid-commit, and edges built without scenario data and patched afterwards,
which React Flow ignored.

## Deliberately not done

- **NumberStepper.** Bounds run 0 to 2x the current baseline and ratchet across
  commits. Arrow keys give keyboard access, and the YAML editor gives unbounded
  values, so this is inconvenience rather than a wall — but the drag alone
  cannot reach beyond 2x.
- **Per-node impacts on expanded cards.** `solveForegroundCumulative` is
  verified and wired; nothing renders it since the panel replaced the property
  editor placement.
- **Retiring the Realtime view.** Redundant now. When it goes, rename
  `realtimeScore.ts` to `scenarioScore.ts` in the same commit.
- **Foreground technosphere and yield dragging.** Feasible as above. Note that
  several places currently assume `s_F` is invariant, including the fix that
  holds scaled mode during a commit; foreground edits break that assumption.
- **Emission dragging.** Needs per-flow characterization factors, which no
  payload carries.
- **Graph toolbar and navbar extraction.** Routine, unfinished.

## Open question

`tests/visual/app.visual.spec.ts:900` still fails. Clicking a right-edge node
leaves it about 118px underneath the property editor. Tests 900 and 938 encode
opposite intentions — one wants the selection kept clear, the other asserts the
viewport does not move. Decide the intended behaviour before changing either.

## Verified live

Against the deployed site and engine: opens as Plastic Broom(bafu-linked) with
three draggable inputs; a drag moves acidification `0.006517` to `0.004086` and
climate change `1.708973` to `1.069264`; no console errors.
