# Plan: LLM YAML Editing and Undo

Status: **Phase 0 delivered**; the rest not started
Date: August 22, 2026
Basis: `main` at `928e5ba`, derived from source code
Delivered: `d116171`, `0abf734` (August 21, 2026)
Supersedes: this file's earlier contents, which planned a Command-pattern
refactor as the first step. See "Why this was rewritten".

## Goal

Let the assistant edit the product graph YAML, and make those edits safe to
accept: validated before they apply, visible as a diff, and reversible.

Graph-native structure editing - add process, connect, delete by clicking - is
**not** a goal. Editing happens through the YAML, and the assistant is the
primary way to author it.

## Why this was rewritten

The first version of this plan led with a Command-pattern refactor and treated
undo as the payoff. That order was wrong for two reasons.

**Undo was low-value on its own.** Nothing in the app can destroy much work in
one action. The graph is view-only, YAML typing has the browser's own undo, and
a scenario commit changes a handful of numbers. Five hours of undo protecting
that was a poor trade.

**The Command registry was solving duplication, not risk.** Its value was
collapsing four unsynchronized places that describe each assistant tool. Real,
but not urgent, and it does not become more urgent if there is essentially one
editing tool rather than fifteen.

Deciding that the assistant edits the YAML - instead of building direct graph
editing - inverts both judgments:

- Undo becomes necessary, because the user did not author the change, cannot
  see what changed, and cannot retype it. Without undo, every request is a
  commitment, so people stop experimenting and the feature goes unused.
- Undo becomes cheaper, because one request is one edit is one history entry.
  Every hard question in the old plan - coalescing windows, keystroke
  granularity, the Cmd+Z conflict with the textarea - was an artifact of
  hand-editing and simply does not arise.
- The registry becomes optional. One validated edit tool does not need a
  registry to stay consistent with itself.

What survives from the old plan: the code-verified mutation inventory, the state
tiers, the snapshot-over-inverse argument, and the Phase 0 defect fixes, which
are already delivered.

## What the assistant can do today

Verified in `src/ai/viewTools.ts`: 29 registered tools.

**It cannot edit the model.** The mutating tools are lifecycle only -
`save_current_model`, `save_model_as`, `open_model`, `new_model`,
`delete_session_model`, `calculate_current_model`, `download_yaml`,
`export_results`.

**It cannot even read the model.** The content tools are `validate_yaml_draft`
and `get_yaml_outline`, both of which return bounded summaries. The system
prompt in `AiChatPanel.tsx:118` instructs it to "never claim access to complete
YAML contents".

That policy has to be reversed before editing is possible: a read tool must come
before a write tool, because the assistant cannot sensibly rewrite a document it
has never seen.

## Verified mutation inventory

### Model data can be changed by exactly two surfaces

| # | Surface | Path |
| --- | --- | --- |
| 1 | YAML textarea | `App.tsx:476` -> `dispatchWorkspace({type:"edit-draft"})` |
| 2 | Scenario amount | `ScenarioEdge.tsx` drag/arrow keys, or `RealtimeView` sliders -> `setScenarioOverride`; committed by the Save to File button -> `commitScenario` (`useGraphModel.ts:346`) |

The assistant's edit tool becomes surface 3, and it should reuse surface 1's
path rather than inventing its own.

### All YAML application funnels through one choke point

Nine call sites reach either `applySource` (`useGraphModel.ts:753`) or
`applyScenarioSource` (`useGraphModel.ts:360`). This single funnel is what makes
snapshot undo tractable; it is not a property that has to be built.

### Graph structure is not editable

`GraphCanvas.tsx` registers no `onConnect`, no add or delete handlers, and no
connectable handles. Under this plan that stays true - it is a decision, not a
gap.

### No persistence

No Zustand middleware at all: no `persist`, no `devtools`, no `zundo`.
`sessionDocuments` live in memory only.

## The three guards

An assistant that rewrites whole sections of YAML is safe enough when three
things hold. The old `ai-chat-tool-roadmap.md` warned against an unrestricted
`replace_yaml`; that warning is answered by these guards rather than by building
a suite of narrow tools.

**1. Validate before applying.** Parse the proposed YAML and run
`buildGraphStructure` on it (`src/lib/yamlGraph.ts:95`). It already enforces a
non-empty process list, a resolvable `reference_process`, and a positive
`reference_output` on every process. A proposal that throws is rejected and
returned to the model as a structured error, never shown as an applied change.

**2. Show the diff.** The user approves what actually changed, not the model's
description of what it changed. This is the guard that catches the dangerous
case: a structurally valid edit that quietly also moved an amount nobody asked
about.

**3. Undo.** The backstop for whatever gets through 1 and 2.

Narrow semantic tools (`add_process`, `connect_flow`, `set_amount`) are safer per
call but are a large surface to build and maintain, and they limit the assistant
to operations that were anticipated in advance. The three guards do the same job
for far less code.

## Design: the edit tool

### Reuse the Save path

The natural shape, given the existing code, is that the assistant writes the
**draft**, not the applied source:

```
propose_yaml_edit(yaml)
  -> validate: parse + buildGraphStructure, reject on throw
  -> dispatchWorkspace({ type: "edit-draft", yaml })
  -> switch to the Edit view
  -> user sees the diff and presses Save
```

`Save` already applies the draft, recalculates, and commits the session document
(`useModelWorkspace.ts:183`). So the confirmation step is an existing button and
an existing code path, and the assistant never applies anything by itself. Almost
no new plumbing is required, and the model cannot bypass the human step because
it has no tool that applies a draft.

### The read tool comes first

`get_yaml_source` must exist before `propose_yaml_edit` is useful, and the system
prompt must stop asserting that complete YAML is off limits. Two consequences to
accept deliberately:

- the full document enters the model's context, so whatever the user's YAML
  contains is sent to the configured provider
- for a 2 KB product graph the token cost is trivial; this design does not scale
  to very large documents, and if models grow past a few thousand lines the
  narrow-tool approach becomes worth revisiting

### Comments

The Phase 0 fix stopped *the app* from reformatting the user's YAML. It cannot
stop the *model* from dropping comments when it regenerates a section. Instruct
the model to preserve comments and formatting, and rely on the diff to expose it
when it does not.

## Design: undo

### Snapshots, not inverses

Keep a stack of previous documents and restore them. Do not implement a reverse
operation per edit.

This was already the right choice and the reframe makes it more so: the bigger
and more opaque the assistant's edit, the worse a hand-written inverse gets and
the better a snapshot looks. A product graph is roughly 2 KB, so a hundred undo
levels is about 200 KB.

### What is on the stack

Only the document tier: `{ workspace: ModelWorkspaceState, appliedYaml }`.

`ModelWorkspaceState` (`src/lib/modelWorkspace.ts:35`) is already an isolated
type with a pure reducer, but it is spread into the store
(`productGraphStore.ts:47`) rather than nested, so there is no object to
snapshot. Nesting it under `workspace: { ... }` is the one structural change
undo requires.

Not on the stack: which view is open, scaled versus structure, the selected
node, zoom and pan, and every calculated result. Those are restored
best-effort as context, or recomputed.

### Granularity

One accepted assistant edit is one undo step. One Save is one undo step. One
Save to File is one undo step.

Navigating the app - clicking nodes, panning, changing views - is never a step.
Undo skips over it.

The old plan's coalescing rules are not needed under this design.

### Undo must not use `applySource`

`productGraphStore.ts:110-118` deliberately resets `graphMode` to `"structure"`,
clears `selectedNode`, and nulls `lcaResult`. Undoing through that path would
eject the user from scaled mode and blank their scores. Use a variant of
`applyScenarioSource` (`:130`), which already advances the revision while
preserving mode, selection, and the previous result.

### Cmd+Z and the textarea

Under this design the textarea is no longer the main editing surface, so the
conflict is much smaller. Recommended: leave native text undo alone inside the
textarea, and put model-level undo in the history list, where it is explicit and
visible. Revisit a global Cmd+Z later if it is actually missed.

### Instant undo

Undo changes `appliedYaml`, which normally means waiting for a recalculation.
Cache `LcaResult` in a small LRU keyed by a content hash of `appliedYaml` so
undoing a round trip restores results immediately. The existing revision guard
(`useCalculation.ts:75,80`) already makes undo-during-calculation safe.

Optional; skip it if the calculation feels fast enough in practice.

## Design: persistence

`sessionDocuments` and the active document live in memory only. Refresh, tab
close, or crash loses every model made in the session - and the `beforeunload`
warning only fires when there are *unsaved* changes
(`useModelWorkspace.ts:148`), so saving everything properly removes the warning
and the work is lost silently.

The app already persists the OpenRouter API key, chat panel width, and toolbar
position.

Persist the workspace slice to `localStorage`. Honest limits: this is a
convenience, not a backup - clearing site data wipes it, and it is per-browser
and per-device. `Download YAML` remains the real archive. It is included here
because assistant editing produces model variants faster than anyone remembers
to download them.

## Phases

| Phase | Work | Est. |
| --- | --- | --- |
| 0 | Bug fixes - **delivered** in `d116171`, `0abf734` | done |
| 1 | Persist the workspace slice to localStorage | ~30 min |
| 2 | `get_yaml_source`; relax the system prompt's YAML policy | ~30 min |
| 3 | `propose_yaml_edit`: validate, write the draft, open the Edit view | ~30 min |
| 4 | Diff view - assistant proposal against the committed document | ~1 h |
| 5 | Snapshot undo: nest the workspace slice, history stack, history list | ~2 h |
| - | Vitest for the pure parts (validation, reducer, history) | ~30 min |

**About 5 hours of agent working time.** Roughly six human-engineer days
becomes roughly four.

Phases 2-4 deliver assistant editing that is safe to ship without undo, because
validation plus the diff plus the existing Save button already require a human
to accept every change. Phase 5 is what makes it comfortable rather than merely
safe.

### Deferred

The Command registry (`src/commands/`, one record per action, derived tool
definitions, per-turn transactions). Revisit if the assistant's tool count grows
or if a second mutating surface appears. With one editing tool it is
duplication-reduction, not risk-reduction.

## Open decisions

1. Does `propose_yaml_edit` take the whole document, or a named section? Whole
   document is simpler and fine at current model sizes.
2. Should the diff appear inline in the chat, in the Edit view, or both?
3. Is model-level undo a keyboard shortcut, or only a history list? The
   recommendation above is list-only to start.

Settled: the scenario commit boundary is the explicit Save to File button, and
that button also commits the session document. Graph-native structure editing is
out of scope.

## Phase 0, delivered

Five defects, fixed in `d116171` and `0abf734`. Kept as the record of what
changed and why.

1. **The scenario commit callback was never wired.** `onCommit` was optional on
   `ScenarioDecoration` and the memo at `useGraphModel.ts:454` never supplied
   it, so `ScenarioEdge`'s pointer-up and arrow-keyup handlers were silent
   no-ops. Since the explicit button is the intended boundary, the dead props
   were deleted rather than connected.
2. **A documented 800ms debounce did not exist.** `commitTimerRef` was
   vestigial. Deleted, along with the bare block the removed `setTimeout` left
   behind.
3. **`applyScenarioToYaml` destroyed the document.** It did `parse` -> mutate ->
   `stringify`, discarding every comment, flow style, and key ordering on the
   first scenario commit. Now edits the parsed document with `setIn` and
   re-emits, so only the amount scalars that moved are rewritten.
4. **Backspace deleted canvas nodes.** `deleteKeyCode` defaulted to
   `'Backspace'` with no guard, removing a node from React Flow state only and
   desyncing the canvas from the YAML. Set `deleteKeyCode={null}`.
5. **A write-only audit log.** `recordToolAudit` wrote to `localStorage` and
   nothing read it. Deleted.

Plus: the commit button was renamed from `"Done"` to `"Save to File"` in both
places that call `commitScenario`, and now also dispatches
`commit-active-session`, so the editor no longer reports unsaved changes for an
edit the user just committed.

## Verification

Per phase, run each separately:

```bash
npm run build
npm run lint
npm run test:responsive
npm run test:visual
```

**The recorded baselines are stale.** `AGENTS.md`, `CLAUDE.md`, `TODOs.md`, and
`responsive-baseline.md` all state 24 responsive passed with no skips and 29
visual passed with 3 accepted failures, and warn that `test:visual` exits
nonzero. Measured on `main` at `0abf734`:

- responsive: **53 passed, 1 skipped, 0 failed** (the skip is a phone-width
  conditional at `ai-chat.responsive.spec.ts:181`, not a contract gap)
- visual: **31 passed, 0 failed** - the suite exits zero, and the failures
  tracked by issues #37, #38, and #39 appear resolved

Update those four documents and close or re-verify the three issues before
Phase 1, so later phases are not measured against a baseline that does not
describe the suite.

Never update screenshot baselines without visually reviewing actual, expected,
and diff images.

## A note on the older plan documents

Every document in `plan/` predates the current source; the most recent was
committed 2026-08-19 and `src/` has changed repeatedly since. Four specific
claims were checked and found wrong:

| Document | Claim | Actual code |
| --- | --- | --- |
| `yaml-source-of-truth.md` | "Preview Graph is the only action that applies a draft"; "do not introduce Zustand" | No Preview Graph control exists; the app is built on Zustand. The doc self-labels as historical. |
| `ai-chat-tool-roadmap.md` Phase 6 | `propose_yaml_patch` / `apply_yaml_patch` exist | Not built. This plan replaces that phase. |
| `graph-native-scenario-editing.md` | The Realtime view "is retired" | It is live and wired at `App.tsx:483`. |
| `ScenarioEdge.tsx:29-32` (comment) | A NumberStepper in the property editor is the precise entry path | `Inspector.tsx` is entirely read-only. Comment corrected in `d116171`. |

Prefer the code.
