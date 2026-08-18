# Plan: Graph-Native Scenario Editing

Status: not started  
Date: August 18, 2026  
Depends on: engine Tier 2 (`background_link_intensities`), deployed August 18, 2026  
Related: [`realtime-scenario-view.md`](realtime-scenario-view.md)

## Goal

Let the user drag background input amounts **directly on the scaled product
graph**, see impact-category scores update live in the property editor, and have
the exact server calculation run on release and refresh the scaled graph.

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

Gate: both suites green, baseline committed separately.

Do not begin Phase 1 without this. A large extraction with no regression signal
is how a "pure refactor" silently changes behaviour.

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

### What the inspector shows

| Selection | Shown | Live and exact? |
|---|---|---|
| Foreground node | Its cumulative score per category | yes |
| Background node | That branch's contribution, `amount x s_F x intensity` | yes |
| Any selection | System total per category, with baseline preview | yes |

Because cumulative scores are live for every foreground node, they are also
worth rendering on the nodes themselves during a drag, not only in the
inspector. Decide that in Phase 7.

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

## Phase 8 — verify and document

- Re-run visual and responsive suites; refresh snapshots deliberately, since the
  graph now renders draggable labels.
- Confirm against the deployed engine on `plastic_broom` that a drag preview
  matches the exact recalculation to `1e-6` relative.
- Confirm the degraded paths: cache off, foreground-only graph, structure mode.
- Update this plan with as-built behaviour.

## Open decisions

**What happens to the Realtime tab?** Once the graph is editable, the tab is
either redundant or becomes the "no-graph" fallback. Options: retire it, keep it
as a list-style alternative for accessibility, or fold it into a panel. Worth
deciding before Phase 7, not after.

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
