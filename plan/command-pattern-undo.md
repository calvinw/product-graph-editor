# Plan: Command Pattern and Undo

Status: **proposed**, not started
Date: August 21, 2026
Basis: `main` at `aa5108c`, derived from source code
Related: supersedes the undo/patch speculation in
[`ai-chat-tool-roadmap.md`](ai-chat-tool-roadmap.md) Phase 6

## Scope note: this plan is derived from code, not from prior plans

Every document in `plan/` predates the current source. The most recent plan doc
was committed 2026-08-19; `src/` has changed in five commits since
(`934d793`, `11b8ae3`, `48b5716`, `eaa04b7`, `aa5108c`, all 2026-08-20).

An earlier draft of this plan cited those documents and was wrong in four
places as a result. The corrections are recorded below because each one changes
the design, and because the same drift will mislead the next reader.

### Corrections to earlier plan documents

| Document | Claim | Actual code |
| --- | --- | --- |
| `yaml-source-of-truth.md` | "Preview Graph is the only action that applies a draft"; "do not introduce Zustand" | No Preview Graph control exists; the app is built on Zustand (`src/state/productGraphStore.ts`). The doc self-labels as historical. |
| `ai-chat-tool-roadmap.md` Phase 6 | `propose_yaml_patch` / `apply_yaml_patch` with "retain undo/recovery information" | Not built. 29 tools are registered in `src/ai/viewTools.ts`; none mutate YAML content. |
| `graph-native-scenario-editing.md` | The Realtime view "is retired once these surfaces exist" | `RealtimeView` is live, present in both navigation groups, and wired at `src/App.tsx:483`. |
| `ScenarioEdge.tsx:29-32` (comment) | The 0..2x drag cap is acceptable because "the NumberStepper in the property editor is the precise path" | `src/components/graph/Inspector.tsx` is entirely read-only. There is no NumberStepper in it and no precise-entry path. The cap is a hard ceiling. |

The one doc claim that is code-true: assistant actions call the same named
functions as the human controls (`src/App.tsx:278-317`). That shared membrane is
what makes a unified command layer cheap.

## Goal

A working undo/redo system at the granularity of a single model edit, and a
single command log that covers both human and assistant actions.

Undo is the user-facing goal. The Command pattern is the means, and it is worth
adopting for a second reason: the human and assistant mutation paths are
currently two dispatchers with duplicated policy, and only a shared command
layer can put them on one history.

## Verified mutation inventory

### Model data can be changed by exactly two surfaces

| # | Surface | Path |
| --- | --- | --- |
| 1 | YAML textarea | `App.tsx:476` -> `dispatchWorkspace({type:"edit-draft"})` |
| 2 | Scenario amount | `ScenarioEdge.tsx` drag/arrow keys, or `RealtimeView` sliders -> `setScenarioOverride`; committed separately by the ScenarioPanel or RealtimeView button -> `commitScenario` (`useGraphModel.ts:346`) |

Surface 2 is two steps, not one. Editing only writes `scenarioOverrides`
(Tier C). The write to YAML happens on an explicit commit, which routes through
`applyScenarioToYaml` -> `edit-draft` -> `applyScenarioSource`.

Only two controls call `commitScenario`: the ScenarioPanel button
(`App.tsx:498`) and the RealtimeView button (`RealtimeView.tsx:86`). The edge's
own commit callback is never supplied - see defect 1.

Both surfaces share one `scenarioOverrides` channel, so any coalescing must live
below them, not in either component.

### Everything else is document lifecycle, not content

The thirteen `dispatchWorkspace` call sites are load, save, save-as, rename,
delete, and discard. Twelve are in `src/hooks/useModelWorkspace.ts`; two are in
`src/App.tsx`.

### All YAML application funnels through one choke point

Nine call sites reach either `applySource` (`useGraphModel.ts:753`) or
`applyScenarioSource` (`useGraphModel.ts:360`). This single funnel is what makes
undo tractable here; it is not a property that has to be built.

### The assistant cannot edit the model

Of 29 registered tools, the mutating ones are lifecycle only:
`save_current_model`, `save_model_as`, `open_model`, `new_model`,
`delete_session_model`, `calculate_current_model`, `download_yaml`,
`export_results`. Content tools are read-only: `validate_yaml_draft`,
`get_yaml_outline`.

This matters for sequencing: per-turn revert has modest value today and
compounds sharply once YAML-editing tools exist. Build the command layer before
those tools, not after.

### Graph structure is not editable

`GraphCanvas.tsx` registers no `onConnect`, no add or delete handlers, and no
connectable handles. Node positions are draggable but are not persisted; any
`applyGraphSettings` or relayout recomputes them.

### No persistence

There is no Zustand middleware at all: no `persist`, no `devtools`, no `zundo`.
`sessionDocuments` live in memory only. Undo history is therefore
session-scoped, which is consistent with the rest of the app.

## State tiers

`src/state/productGraphStore.ts:47-81` flattens three tiers with very different
undo semantics into one object. Separating them is the core of the refactor.

| Tier | State | Undo semantics |
| --- | --- | --- |
| A. Document | `activeDocument`, `sessionDocuments`, `yamlDraft` (spread in from `ModelWorkspaceState`), `appliedYaml`, `appliedRevision` | This *is* undo. Snapshotted. |
| B. Presentation | `activeView`, `graphMode`, `graphOrientation`, `graphConnectionStyle`, `selectedNode`, `showReferenceAmounts`, `graphMaxProcesses`; React Flow `nodes`/`edges` in `useNodesState` outside the store | Never on the stack. Restored as a best-effort context hint. |
| C. Derived / async | `lcaResult`, `calculatedRevision`, `calculationStatus`, `scenarioCommitRevision`, `scenarioOverrides` | Never on the stack. Recomputed or discarded. |

`ModelWorkspaceState` (`src/lib/modelWorkspace.ts:35`) is already an isolated
type with a pure reducer and nine named, serializable actions
(`modelWorkspace.ts:41-51,63`) - roughly 80% of a Command implementation,
missing an invoker, history, and metadata. But it is *spread* into the store
rather than nested, so there is no object to snapshot. Un-spreading it into
`workspace: { ... }` is the single highest-leverage mechanical change in this
plan.

## Defects to fix first

Each is a real bug today, and each is exactly a boundary problem the command
layer must solve anyway.

### 1. The scenario commit boundary is explicit, and the UI hides it

**Decided:** the explicit button is the intended boundary. Editing a scenario
edge previews; a button writes the result back to YAML. Commit-on-release is
not wanted.

Three things follow.

**1a. Rename the button to say what it does.** `ScenarioPanel.tsx:122` labels
it `"Done"`, which reads as "dismiss this panel". It does not dismiss anything -
it rewrites the product graph YAML and starts a calculation. Rename to
`"Update YAML"`. Keep the `"Calculating…"` busy label.

**1b. Delete the dead commit plumbing.** The edge label is a real control:
`role="slider"`, `tabIndex={0}` (`ScenarioEdge.tsx:69-72`), draggable by pointer
and nudgeable with ArrowLeft/ArrowRight. Editing works, because
`onScenarioChange` is supplied. Committing is wired but never connected:
`onCommit` is optional on `ScenarioDecoration` (`yamlGraph.ts:16`) and the
`scenario` memo at `useGraphModel.ts:454-462` never supplies it, so
`yamlGraph.ts:303` passes `undefined` and both call sites are silent no-ops -
`ScenarioEdge.tsx:91` on pointer-up and `:102` on arrow keyup. The optional `?.`
and the optional `?` in the type together mean TypeScript cannot catch it.

Since commit-on-release is not wanted, remove `onCommit` from
`ScenarioDecoration`, `onScenarioCommit` from `ScenarioEdgeData`, the pass-through
at `yamlGraph.ts:303`, and both call sites. Correct the doc comment at
`ScenarioEdge.tsx:29-32`, which describes a NumberStepper that does not exist
and implies a commit-on-release that is not wanted.

**1c. Rename the second commit button to match.** `RealtimeView.tsx:86` calls
the same `commitScenario` under the label `"Calculate exactly"`. One action must
not have two names. Rename it to `"Update YAML"` as well, keeping its
`"Calculating…"` busy label and its `disabled={!dirty || committing}` guard.

Not a defect, verified: `ScenarioPanel` renders only when
`scenarioEditCount > 0` (`App.tsx:493`), so the button is never visible with
nothing to apply.

An earlier draft of this plan claimed `:102` fired a commit on every keypress
and produced roughly thirty undo entries per held arrow key. That was inferred
from the call site without tracing whether the callback was ever supplied. It
does not happen.

### 2. Delete the vestigial debounce

`useGraphModel.ts:321-325` describes an 800ms idle window collapsing a burst of
drag releases into one calculation. The code clears the timer and then runs the
work immediately inside a bare block (`:346-366`); `commitTimerRef` is
vestigial. There is no debounce in `useCalculation.ts` either.

With decision 1 settled, no debounce is needed: `commitScenario` fires on a
button press, one press at a time. Delete `commitTimerRef`, its cleanup effect
at `:328`, the `clearTimeout` at `:347`, and the bare block, and correct the
comment.

### 3. `applyScenarioToYaml` destroys the user's document

`realtimeScore.ts:118-130` does `parse()` -> mutate -> `stringify()`, dropping
all comments, formatting, and key ordering, then writes the result back into
`yamlDraft` (`useGraphModel.ts:359`) - which also silently marks the document
dirty and arms the unsaved-changes guard. One edge drag rewrites the whole file.

This is a hard prerequisite for the command layer: if commands reformat the
document, undo/redo round-trips are not identity and history diffs are
unreadable noise. Fix with `parseDocument()` ->
`doc.setIn(["processes", i, "inputs", j, "amount"], value)` -> `doc.toString()`.

### 4. Backspace probably deletes nodes from the canvas

`GraphCanvas.tsx` does not set `nodesDeletable={false}` and does not override
`deleteKeyCode`. The installed `@xyflow/react@12.11.2` defaults
`deleteKeyCode = 'Backspace'`, and `onNodeClick` sets `selected`. Backspace on a
selected node therefore appears to remove it from React Flow state via
`onNodesChange`, desyncing the canvas from `appliedYaml` with no model change
and no recovery short of re-applying YAML. Undo would have no record of it.

Verify in a browser before fixing; the code path has no guard either way.

### 5. The audit log is write-only

`recordToolAudit` (`AiChatPanel.tsx:64`) writes to `localStorage` under
`product-graph-editor:chat-tool-audit`. Nothing in `src/` reads it. A dead
command log already exists; Phase 6 replaces it rather than adding a second one.

## Why the Command pattern, specifically

Adding one assistant command today means editing four places that TypeScript
cannot keep in sync:

- `appToolDefinitions` - the JSON schema
- `confirmedToolNames` - a `Set` at `viewTools.ts:97`
- `confirmationSummary` - a `switch` at `viewTools.ts:356`
- `executeAppTool` - an if-chain at `viewTools.ts:414+`, roughly 300 lines

Meanwhile the policy those four places encode - confirmation, the
`STALE_CONFIRMATION` before/after revision check, and audit - lives inline in a
React component's `send` loop (`AiChatPanel.tsx:266-296`), where it protects
assistant actions only and cannot protect human ones.

A registry collapses all of this and makes the same guarantees available to both
callers.

## Architecture

### Snapshot (memento) undo, not per-command `undo()`

The undoable state is a handful of small strings.
`Jacket_product_graph.yaml` is 1.9 KB, so 100 undo levels is roughly 200 KB.

Per-command inverses would be genuinely hard for `commit-new-session`,
`discard`, and the `previousDocument` chain (`modelWorkspace.ts:58`) - three
places where `undo()` would subtly fail to invert `execute()`. Snapshots avoid
that class of bug entirely.

### Layout

```
src/commands/
  types.ts       Command: name, schema, risk, describe(), run(),
                 coalesceKey?, undoable, exposeToLlm
  registry.ts    one record per command - the single source of truth
  dispatch.ts    validate -> guard -> confirm -> snapshot -> run -> log -> push
  history.ts     memento stacks, transactions, coalescing
```

Derive rather than duplicate:

```
appToolDefinitions  = registry.filter(exposeToLlm).map(toToolDefinition)
confirmedToolNames  = registry.filter(c => c.risk >= "mutation")
confirmationSummary = command.describe(args, state)
executeAppTool      = dispatch(name, args, { source: "assistant" })
```

The if-chain in `viewTools.ts` is deleted, not wrapped.

### Two mementos per history entry

- **Model memento** (authoritative, restored):
  `{ workspace: ModelWorkspaceState, appliedYaml }`. Requires the un-spreading
  described under State tiers.
- **Context hint** (best-effort, not authoritative):
  `{ activeView, graphMode, selectedNodeId }`. Without it, undo is disorienting.

### Undo must not use `applySource`

`productGraphStore.ts:110-118` deliberately resets `graphMode` to `"structure"`,
clears `selectedNode`, and nulls `lcaResult`. Undoing through that path would
eject the user from scaled mode and blank their scores.

Use a variant of `applyScenarioSource` (`:130`), which exists precisely to
advance the revision while preserving mode, selection, and the previous result.
The undo apply-path is essentially already written.

### Result cache makes undo instant

Undo bumps `appliedRevision`, which otherwise means a full server round trip
before scores return. Cache `LcaResult` in a ~20-entry LRU keyed by a content
hash of `appliedYaml`; undoing a round-trip then restores results
synchronously.

The existing revision guard (`useCalculation.ts:75,80`) already makes
undo-during-in-flight-calculation safe with no additional work.

## Granularity

One history entry per semantic model edit - not per keystroke, and not per
React state change.

The transaction boundary already exists and is correctly placed: intermediate
`setScenarioOverride` calls are Tier C and never touch YAML; `commitScenario` is
the only writer.

That boundary is an explicit button press - Update YAML - and decision 1 keeps
it that way. One press is one command is one history entry. **No coalescing is
required for scenario edits**, which removes the most delicate part of the
original design.

A user who drags four edges and then presses Update YAML gets one undo entry
covering all four. That is the correct granularity: it matches what they did,
and it matches the one YAML write and the one calculation.

Should commit-on-release ever be revisited, two distinct windows would be
needed - time-based for the calculation, identity-based on `scenarioKey`
(`${process_index}:${input_index}`) for undo. Both would belong in the command
layer, since two surfaces write the same override channel. Not needed now.

The YAML textarea is the awkward case: a global Cmd+Z will fight the textarea's
native undo. Recommend exempting the textarea in Phase 3 - it is the least
valuable undo and the highest risk to get wrong - and revisiting later.

## Phases

| Phase | Work |
| --- | --- |
| 0 | Defects 1-5: rename Done -> Update YAML and delete the dead commit plumbing, delete the vestigial debounce, `parseDocument` round-trip, `nodesDeletable={false}` after confirming the Backspace behavior, drop the dead audit writer |
| 1 | Nest `ModelWorkspaceState` as a `workspace` slice; split the presentation slice |
| 2 | `src/commands/` registry and dispatcher; migrate `executeAppTool` and `runtime.actions`; delete the four-place duplication |
| 3 | History store: memento stacks, transactions, dual coalescing, Cmd+Z / Shift+Cmd+Z with textarea exemption |
| 4 | LCA result LRU keyed by YAML content hash |
| 5 | Chat invoker: `send` delegates to `dispatch`; one transaction per assistant turn; inline command log with revert |
| 6 | History panel; retire `recordToolAudit` |
| - | Vitest for `src/commands`, `src/lib/realtimeScore`, `src/lib/modelWorkspace` |

Phase 0 is five standalone bug fixes with no architectural commitment and is
worth doing whether or not the rest proceeds.

Phases 0-3 ship working undo on their own. Phases 5-6 are the agentic payoff
and depend on nothing in 4.

Vitest is listed last but should be done early: there is currently no unit test
runner (Playwright only), and command, reducer, and coalescing logic is pure and
the highest-value-per-line thing to test. Without it, Phase 3 correctness is
verified by driving a browser.

## Decisions required before Phase 3

Each changes the design; guessing wrong means redoing Phase 3.

1. Does Cmd+Z in the YAML textarea perform native undo or command undo?
2. Does undo restore the viewport and selection, or leave the camera untouched?
3. Does an assistant turn revert as one step, or per tool call?

Settled: the scenario commit boundary is the explicit Update YAML button, not
commit-on-release. See defect 1.

## Effort

Roughly one day of agent working time end to end, spread across review cycles.
As human-engineer estimates, about seven days.

The cheap alternative - a stack of `appliedYaml` snapshots behind `applySource`,
no registry - is about a day of human time and does deliver working
scenario-edit undo. It gives no unified human/assistant timeline and no per-turn
revert, and it gets rewritten when content-mutation tools land.

The real calendar cost is not typing. It is:

- the Playwright suites, which should run per phase rather than once at the end
- the three accepted visual failures recorded in `responsive-baseline.md`: if a
  refactor shifts a screenshot, baselines may not be updated without a human
  reviewing actual, expected, and diff images
- the three decisions above

## Non-goals

- Do not put presentation setters on the command stack. `setGraphOrientation`,
  `setGraphConnectionStyle`, `setReferenceAmountsVisible`, `fitGraph`, and view
  switching stay plain Zustand actions. Wrapping them adds ceremony and
  pollutes undo with view churn.
- Do not persist history across sessions. Models themselves are session-scoped;
  history should match.
- Do not add graph structure editing (add process, connect, delete) in this
  work. The command layer should exist first so those arrive as commands.
- Do not introduce `set_state`, `apply_patch`-style generic tools, or any
  confirmation-bypass flag. The registry should cover Tier A mutations plus the
  assistant surface, and nothing else.

The registry's membrane should be `runtime.actions` (`src/App.tsx:278`), which
is already almost exactly the right boundary.

## Verification

Per phase, run each separately:

```bash
npm run build
npm run lint
npm run test:responsive
npm run test:visual
```

Baseline: 24 responsive passed with no skips; 29 visual passed with 3 accepted
failures. `test:visual` exits nonzero because of those. Compare every failure
against `responsive-baseline.md`: previously passing tests must stay green, and
accepted failures must not change or expand. Never update screenshot baselines
without visually reviewing actual, expected, and diff images.

Beyond the suites, Phase 3 needs hands-on verification at the three supported
viewports - coalescing feel cannot be judged from a diff.
