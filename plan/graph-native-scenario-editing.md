# Plan: Graph-Native Scenario Editing

Status: not started  
Date: August 18, 2026  
Depends on: engine Tier 2 (`background_link_intensities`), deployed August 18, 2026  
Related: [`realtime-scenario-view.md`](realtime-scenario-view.md)

## Goal

Let the user drag background input amounts **directly on the scaled product
graph**, see impact-category scores update live in the property editor and on
expanded activity cards, and have the exact server calculation run after release
to refresh inventory, contributions, and Sankey.

The standalone Realtime view was a test harness for the Tier 2 payload and is
retired once these surfaces exist.

The prerequisite is a codebase that can absorb this without making `App.tsx`
worse. This project will carry several more tools, so Phases 1 and 2 decompose
the monolith first and are worth doing on their own merits.

## Why this is feasible

### The scaled graph does not go stale mid-drag

The obvious objection to editing on the *scaled* graph is that scaled numbers
are stale the moment an input changes. For background-input edits they are not.

A background-input change leaves the foreground scaling vector `s_F` untouched,
so every scaled foreground quantity — node output amounts, scaled emissions,
scaled extractions — remains exactly correct while dragging. Only two things
move, and both are computable in the browser:

- the edited edge's label, `amount x s_F(consumer)`
- the background node's aggregate demand, `sum(amount x s_F(consumer))`

This is what makes graph-native editing more defensible than the existing
Realtime tab, which conservatively hides scaled quantities while dragging.

### Identity already lines up

`yamlGraph.ts` builds edge ids as
`${source}-${target}-${consumerIndex}-${inputIndex}`. Those two indices are
exactly the engine's `(process_index, input_index)` key for
`background_link_intensities`. Mapping a dragged edge to its provider intensity
needs no new plumbing.

### The maths is done

`lib/realtimeScore.ts` is pure, already verified against the engine, and needs
no change. The engine needs nothing at all.

## What is genuinely hard

| Obstacle | Why | Phase |
|---|---|---|
| `buildGraphFromYaml` is one-shot: parse YAML, scale, build, then dagre layout | A drag cannot reparse YAML and re-layout per frame; the graph would thrash | 3 |
| Edges are default-typed, labels are plain SVG strings | Cannot host a drag handle or an input | 4 |
| `applySource` resets `graphMode` to `structure`, clears `selectedNode`, nulls `lcaResult` | Committing a drag would eject the user from scaled mode and blank the scores | 5 |
| `App.tsx` is 3095 lines; `GraphEditor` alone is ~1370 | Adding drag state, edge types, and inspector sections here is where this turns unpleasant | 1-2 |

## Phase 0 — establish the safety net

There is no unit-test runner, but there **are** Playwright visual and responsive
suites (`npm run test:visual`, `npm run test:responsive`) with committed
snapshots. For a behaviour-preserving refactor this is the right guard: the
correct result of Phases 1 and 2 is **zero snapshot diff**.

1. Run both suites on `main` and confirm green.
2. If snapshots are stale, refresh and commit them as a separate baseline commit
   *before* any refactor, so the baseline is never entangled with the change.

### Outcome, August 18 2026

The suites exist and are a usable guard: they mock the LCA API via `mockLcaApi`
and manage their own dev server on port 5178, so they need neither the engine
nor the network.

They are not fully green, and the team decided to proceed anyway:

- **Visual: 5 failed, 27 passed.** Verified pre-existing by running the suite on
  `7b0bc7d`, the commit before the Realtime work — the same five fail there.
  Accepted as known-bad.
- **Responsive: not run.** Responsive behaviour is being reworked on another
  branch, so failures there are expected and carry no signal for this work.
- **One flaky test**, `542 settings popovers dismiss predictably`: failed one of
  three full runs, passes in isolation. It dismisses popovers with
  `page.mouse.click(700, 700)`, which is position-sensitive. Expect the
  occasional false alarm.

**Working gate for Phases 1-2:** the 27 currently passing visual tests must stay
passing. Watch for *new* failures rather than a green run. Re-check `542` in
isolation before believing it.

## Phase 1 — extract leaves

Pure file moves. No logic edits, no prop-shape changes, no state relocation.
Every extracted component keeps its current signature.

Target layout:

```text
src/components/
  views/        InventoryView, ImpactAnalysisView, ProcessResultsView,
                ContributionView, SankeyView, ResultsView, RealtimeView
  workspace/    FileMenu, SaveAsDialog, UnsavedChangesDialog
  welcome/      WelcomePage, WelcomeShader
  graph/        ProcessNode, SankeyProcessNode
  common/       ToolButton, AppSelect, CurrentModelTitle,
                ColumnResizeHandle, ResizableTableHeader
```

These are already standalone functions in `App.tsx`; the work is moving them and
exporting the few shared helpers they use (`isInventoryInput`, `normalizedFlow`,
`inventoryFlowName`, and similar) into `lib/`.

Gate: zero snapshot diff. `tsc`, `eslint`, `vite build` clean.

Expected outcome: `App.tsx` drops from ~3095 lines to roughly the `GraphEditor`
body plus the shell.

## Phase 2 — extract GraphEditor's responsibilities into hooks

`GraphEditor` currently mixes six concerns. Each becomes a hook owning its own
state, returning a narrow interface.

| Hook | Absorbs |
|---|---|
| `useGraphModel` | `nodes`/`edges` state, `layoutNodes`, `removeNode`, `restoreNode`, `toggleExpanded`, `setAllExpanded`, `relayout`, `fit`, `applyGraphSettings`, `showGraphMode` |
| `useBackgroundHydration` | `hydrateBackgroundNode`, `toggleBackgroundBranch`, and their refs |
| `useCalculation` | `calculateSource`, `loadContributionGraphs`, `activeCalculationRef`, `contributionRequestsRef`, `loadingContributionKeys` |
| `useWorkspaceDocuments` | templates, `loadTemplate`, `loadSessionModel`, `loadYamlFile`, save / save-as / discard / download |
| `useViewRouting` | `pendingAction`, `requestAction`, `requestView`, `continueToView`, `openAnalysisView`, the unsaved-changes dialog |
| `useInspectorSelection` | `selected`, `lastSelectedRef`, `selectedNode`, `inputNodes`, `outputNodes` |

Then extract the remaining JSX:

```text
src/components/graph/
  GraphCanvas.tsx        ReactFlow, nodeTypes, edgeTypes, search overlay
  GraphToolbar.tsx       mode toggles, settings popover
  Inspector/
    Inspector.tsx
    PropertySection.tsx
```

Do these one hook per commit, running the visual suite each time. A single
"extract everything" commit is not reviewable and not bisectable.

Gate: zero snapshot diff after each commit.

### Also fix while here

`yamlGraph.ts`'s scaling BFS takes the **maximum** required scale per provider
rather than the sum (`requiredScale > (scales.get(provider.name) ?? 0)`), which
is wrong for a product consumed by more than one process. It does not affect
this feature, which uses the server's `scaling_vector`, but it is a live defect
sitting in the file Phase 3 restructures. Fix it with a test graph that has a
shared foreground provider.

## Phase 3 — split structure from amounts

The architectural change this feature actually needs.

`buildGraphFromYaml` becomes two functions:

| Function | Input | Cost | Runs |
|---|---|---|---|
| `buildGraphStructure(source)` | YAML text | expensive: parse, build, dagre | on apply |
| `decorateAmounts(structure, scaling, overrides, options)` | structure + numbers | cheap: label and amount fields only | per frame |

`decorateAmounts` must not move nodes, change ids, or add/remove elements. It
returns new node/edge `data` with updated amounts and labels, preserving
`position` so React Flow does not re-layout.

Verification: for every bundled template, and for both `structure` and `scaled`
modes, `decorateAmounts(buildGraphStructure(y), ...)` must be deep-equal to
today's `buildGraphFromYaml(y, ...)` output. Write this as a throwaway
comparison script over all ten templates, as was done for `realtimeScore`.

Gate: deep-equal on all templates in both modes; zero snapshot diff.

## Phase 4 — the draggable scenario edge

New `components/graph/ScenarioEdge.tsx` using React Flow 12's
`EdgeLabelRenderer`, which renders HTML in a portal positioned over the edge.
Register it in `edgeTypes`; only edges that carry a `link_id` in their data use
it, so foreground edges keep the default renderer.

Behaviour:

- Shows the scaled amount and unit, as today.
- Pointer-drag horizontally adjusts the amount; `pointerdown` must call
  `stopPropagation` so React Flow does not pan the canvas.
- Bounds come from `sliderBounds` in `realtimeScore.ts`.
- Edited edges get a visible treatment, matching `.realtime-slider.is-edited`.
- `pointerup` ends the scenario and triggers the commit.

The drag writes `scenarioOverrides` in the store. Nothing else changes during
the drag.

Accessibility and precision: a canvas drag on a small label is fiddly, and the
freight edge on the broom is 1.4% of the total. Pair the drag with the existing
`NumberStepper` in the inspector so there is a keyboard-reachable, precise path
to the same value. The drag is the demo; the stepper is the tool.

## Phase 5 — a store action that survives recalculation

Add `applyScenarioSource(yaml)` alongside `applySource`. Unlike `applySource` it
must:

- keep `graphMode` at `scaled`;
- keep `selectedNode`;
- keep the previous `lcaResult` visible until the new one arrives, rather than
  nulling it, so scores do not blank mid-refresh;
- still bump `appliedRevision` so stale responses are discarded.

`scenarioOverrides` clear on `completeCalculation`, which is already the case
and is correct: once the exact result lands, the new amounts are the baseline
and the deltas are spent.

## Phase 6 — impact categories in the property editor

Add an `ImpactCategorySection` to the inspector, styled as the existing
`property-section` blocks.

### Every foreground node can carry a live cumulative score

An earlier draft of this plan claimed per-node foreground cumulative scores were
not locally derivable. **That was wrong.** The decomposition closes with data
already in hand:

```text
A_FF^T y_F  =  direct_char  +  Σ (background amount × y_B)

per-node cumulative  =  supply_amount × y_F(p)
```

- `A_FF` comes from the YAML: reference outputs on the diagonal, negated
  foreground-to-foreground input amounts off it.
- `direct_char(p) = direct_score(p) / scaling_vector(p)`, both already in the
  Call 1 response. Guard the division for `s_F(p) == 0`.
- The background term is the Tier 2 payload.

During a background-input drag `s_F`, `direct_char`, and `y_B` are all
invariant; only the right-hand side moves. Re-solving is an `n x n` dense solve
where `n` is the foreground process count — 5 for the jacket, microseconds.

Verified against the deployed engine: every foreground node of `jacket.yaml`
(5 processes) and `polyester_tshirt.yaml` (3 processes) matched the server's own
`contribution_graphs` node `cumulative_score` to between `0` and `5.7e-08`, the
float32 floor.

Implement this as `solveForegroundCumulative` in `lib/realtimeScore.ts`.

### Two surfaces

Impact numbers appear in two places. Both read the same locally solved values,
so they stay consistent and cost one solve per frame between them.

**1. The property editor.** A new `ImpactCategorySection`, styled as the
existing `property-section` blocks.

| Selection | Shown | Live and exact? |
|---|---|---|
| Foreground node | Its cumulative score per category | yes |
| Background node | That branch's contribution, `amount x s_F x intensity` | yes |
| Any selection | System total per category, with baseline preview | yes |

**2. Expanded activity cards.** When a node card is expanded, show its impact
contribution on the card itself.

`ProcessNode` already renders the expanded body as a series of titled row
blocks — `pg-flow-section`, `pg-biosphere`, `pg-extractions`, `pg-emissions`.
An impacts block is the same shape and slots in beside them:

```text
ProcessNodeData gains:
  impacts?: Array<{
    label: string
    score: number
    unit: string
    percentage?: number   // share of the system total
  }>
```

Rendered as a `pg-impacts` section, only when `data.expanded` is true.
Collapsed cards stay as they are — label and toggle only.

`decorateAmounts` populates `impacts` from the local solve, which is why the
Phase 3 split matters here: expanding a card mid-drag must not require a server
call or show a stale number.

Show cumulative score for foreground nodes and branch contribution for
background boundary nodes. Both are exact; label them so the distinction is
visible rather than implied.

### What still requires the release-time calculation

| Quantity | Source |
|---|---|
| Elementary flow inventory (`lci`) | server |
| Background activity direct scores | server — the background supply vector changes |
| Full contribution graph including background nodes | server traversal |
| Sankey | server |

So the drag is exact for every score on the foreground, and the release-time
call fills in inventory, background detail, and Sankey. The two-stage model
holds, but with more landing on the live side than first assumed.

## Phase 7 — wire the loop

1. Drag updates `scenarioOverrides`.
2. A memo recomputes `decorateAmounts` and `scoreScenario` from the overrides.
3. Graph labels and inspector scores re-render; layout is untouched.
4. On release, `applyScenarioToYaml` writes the amounts, `applyScenarioSource`
   applies them, and the exact calculation runs.
5. On completion, the scaled graph rebuilds from the new `scaling_vector` and
   overrides clear.
6. If the exact score differs from the preview beyond
   `RELATIVE_DRIFT_TOLERANCE`, surface it rather than silently swapping the
   number.

## Phase 7b — refresh orchestration

The drag is a third tier beneath the two calls the app already makes. It does
not replace them and needs no new endpoint.

```text
Tier 0  drag           local, 0ms, no call
        category totals; foreground cumulative; boundary provider
        branch totals; background subtrees scaled per branch
        -> an overlay on the current baseline, never invalidating it

Tier 1  POST /api/lca/base            ~800ms
        lci, lcia, scaling_vector, process_contributions, sankey,
        background_link_intensities
        -> establishes a baseline keyed by result_id

Tier 2  POST /api/lca/contribution    ~700ms per category, lazy
        contribution_graphs, merged into that baseline,
        guarded by result_id
```

`result_id` is a hash of the product graph, so it self-invalidates when amounts
change, and `mergeContributionGraphs` already rejects batches whose `result_id`
does not match. That is exactly the staleness guard a scenario flow needs, and
it already exists.

### When Tier 0 gets promoted

A background-only drag produces **exact** scores, so the refresh is not needed
for scores at all — only for inventory, background direct contributions,
Sankey, and the contribution tree. That is the same data the analysis views
consume, so make the refresh lazy in the same way Tier 2 already is:

- on `pointerup`, mark the scenario pending; do **not** call;
- promote when the user opens a server-backed view, expands a background
  branch, or presses Calculate;
- plus a speculative idle debounce of roughly 1.5s after the last release, so a
  rapid series of drags fires one calculation rather than five, and the result
  is usually ready before the user switches views.

### Sequence

1. `pointerdown` on a scenario edge begins the scenario.
2. `pointermove` sets the override, re-runs `decorateAmounts` and
   `solveForegroundCumulative`, re-renders. No call.
3. `pointerup` marks the scenario pending and starts the idle timer.
4. Timer fires, or a server-backed view is opened.
5. `applyScenarioToYaml` then `applyScenarioSource`, preserving scaled mode and
   selection.
6. Tier 1 runs: new baseline, new `result_id`, overrides cleared.
7. Re-request the contribution categories that were loaded before the commit.
8. Reconcile: if the exact score differs from the preview by more than
   `RELATIVE_DRIFT_TOLERANCE`, surface it.

### Step 7 will not happen by itself

`calculateSource` currently calls `contributionRequestsRef.current.clear()`, and
the new `result_id` invalidates every previously merged graph. Today that is
harmless because the user reopens a view and it refetches. In a scenario flow it
reads as a regression: drag, commit, and the Contribution view goes blank.

Capture the set of loaded category labels before the commit and re-request them
after Tier 1 returns.

### Preserve expansion state across a commit

Contribution node ids are built as
`_stable_id("contribution-occurrence", label, unique_id, activity_id)`, where
`unique_id` is the traversal index. Pruning one node shifts every later index,
so ids churn wholesale even when the tree is nearly unchanged. Measured on the
BAFU broom with PLA halved:

| Keyed by | Shared nodes |
|---|---|
| raw occurrence `id` | 11 of 85 |
| `(activity_id, depth)` | 69 of 69 |

Every node in the changed graph already existed in the baseline; sixteen dropped
below the cutoff and none appeared. `activity_id` is `database` + `code` and is
stable.

So key expansion state on `(activity_id, depth)`, not on the occurrence id.
Without this, every commit destroys the user's expanded background branches.

### Cost

| | Calls | Latency |
|---|---|---|
| Per drag frame | 0 | ~0ms |
| Per committed scenario | 1 | ~800ms |
| Plus each previously-open category | 1 batch | ~700ms |

A committed scenario costs what pressing Calculate costs today. Everything
between drags is free.

## Relationship to the eager background graph plans

[`eager-background-contribution-graphs.md`](eager-background-contribution-graphs.md)
and its engine partner `PLAN_eager_background_graph_bundle.md`, both July 27,
2026, proposed returning every bounded background contribution graph in a single
`run_lca` response so exploration would be local.

`lazy-calculate-lca-engine-plan.md`, dated one day later, states that it
**supersedes the framing** of the engine-side eager plan, and the lazy two-call
design is what shipped. The editor-side eager plan still reads
`Status: Proposed` and should be marked superseded; leaving it dangling invites
someone to build against a contract that lost.

The eager plans and this one pursue the same goal by opposite means:

| | Eager | Tier 2 + scenario editing |
|---|---|---|
| Method | ship all the data | ship the coefficients and recompute |
| Payload | ~1,000 nodes x N categories | ~1 float per link per category |
| Rescoring under a changed input | not possible without a new full call | exact and local |

Scenario editing is an argument against reviving eager. Under frequent parameter
change an eager response is the wrong shape: every drag-release would ship the
full multi-category tree. Step 7 above exists only because contribution graphs
are lazy; under eager it would fold into Tier 1, at a much larger cost per
commit.

What remains valuable in those documents is their cutoff and topology analysis,
and their warning that rendering roughly 1,000 React Flow nodes is a frontend
problem even when transferring them is not. That applies directly here, since
scaling background subtrees live means holding a large tree in memory.

## Phase 8 — verify and document

- Re-run visual and responsive suites; refresh snapshots deliberately, since the
  graph now renders draggable labels.
- Confirm against the deployed engine on `plastic_broom` that a drag preview
  matches the exact recalculation to `1e-6` relative.
- Confirm the degraded paths: cache off, foreground-only graph, structure mode.
- Update this plan with as-built behaviour.

## Open decisions

**The Realtime tab is transitional and will be removed.** It existed to prove
the Tier 2 payload end to end, and it did that. Once impact numbers appear in
the property editor and on expanded cards, retire it: delete
`RealtimeView.tsx`, its `"realtime"` entry in `ProductGraphView`, the view
switcher entries in `App.tsx`, the `viewTools.ts` registration, and the
`.realtime-*` CSS.

Keep `lib/realtimeScore.ts` — the name is now misleading but the module is the
scoring core for this feature. Rename it `lib/scenarioScore.ts` when the view
goes, in the same commit, so the two never drift.

Do the removal **after** Phase 6 lands and is verified, not before. Until then
it is the reference implementation to check the new surfaces against.

**Structure mode.** Dragging is defined here only for `scaled` mode, because it
depends on the server's `scaling_vector`. Structure mode has no calculation
behind it. Either disable dragging there or define separate semantics.

## Out of scope

- Emission, yield, and provider-swap dragging. These need engine payloads that
  Tier 2 does not provide: characterization factors for emissions, and an
  intensity lookup for providers absent from the graph.
- Tier 3 and any change to the engine.
- Normalization and weighting panels.

## Sequencing note

Phases 0-2 are valuable independently of this feature and carry no feature risk.
If the scenario feature is deprioritised, they should still land. Phases 3-7 are
only worth doing together.
