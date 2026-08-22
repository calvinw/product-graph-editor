# Plan: Undo

Status: not started
Date: August 22, 2026
Basis: `main` at `75f3b7b`

## Goal

An undo system for the product graph model, designed for a world where the
assistant writes most of the edits.

## The editing model this is built for

Structure editing happens through the YAML, not through the graph. The graph
stays a view. The assistant is the primary way to author changes:

```
you:        "add a dyeing stage that draws 2 kWh of grid electricity"
assistant:  reads the YAML, writes a new version
app:        validates it, shows you what changed
you:        accept
app:        applies, recalculates, saves
undo:       takes it back
```

Neither the read nor the write tool exists yet. Today the assistant has 29
tools; the content ones (`validate_yaml_draft`, `get_yaml_outline`) return
bounded summaries only, and the system prompt tells it never to claim access to
complete YAML. Both of those change as part of this work.

Undo does not depend on the edit tools shipping first - it already covers Save
and Save to File. But it is designed around them, because that is where the
risk is.

## What that demands of undo

Assistant edits are unlike hand edits in four ways, and each one drives a
design decision.

**You did not write it, so you cannot rewrite it.** If a proposal is 90% right,
"redo it by hand" is not a recovery path. Undo has to be exact and complete, not
a hint.

**You cannot see what changed.** A hand edit is visible as you make it; an
assistant edit lands as a wall of new YAML. Every history entry needs a diff,
and the diff matters more than the undo itself. Being able to go back without
knowing what you are going back from is only half a feature.

**The failures are quiet.** Invalid YAML is caught on parse. The dangerous edit
is structurally valid and subtly wrong - it also moved an amount nobody asked
about. Undo is the answer to what validation cannot catch.

**You will edit far more often.** Asking is cheap, so the volume goes up an
order of magnitude, and the point of undo is that it makes "just try it"
reasonable. Without it, every request is a commitment, people hedge with Save As
first, and they stop experimenting.

## Design

### Snapshots, not inverses

Keep copies of the previous document and restore them. Do not write a reverse
operation per edit.

A product graph is roughly 2 KB, so a hundred undo levels is about 200 KB. And
the bigger and more opaque an edit is, the worse a hand-written inverse gets -
which is exactly the case here. Inverses are also where undo bugs come from: an
"undo" that is not quite the exact opposite of the action lets state drift over
a long session.

### What is on the stack

The document tier only:

```
{ yamlDraft, appliedYaml, activeDocument, sessionDocuments }
```

Plus metadata per entry: a label, the source (`you` or `assistant`), a
timestamp, and the diff against the previous entry.

`ModelWorkspaceState` (`src/lib/modelWorkspace.ts:35`) is already exactly this
shape with a pure reducer, but it is spread into the store
(`productGraphStore.ts:47`) rather than nested, so there is no object to
snapshot. Nesting it under `workspace: { ... }` is the one structural change
undo requires, and it is mechanical.

### What is not on the stack

Which view is open, structure versus scaled, the selected node, zoom and pan,
open inspector, and every calculated result.

Clicking around the graph is never an undo step. If you edit, save, then click
ten nodes and switch views three times, one undo takes you back to the pre-save
document and ignores the clicks. Results are recomputed rather than restored,
because they are derived from the document.

Undo should still put the view roughly back where the change is visible, so it
does not feel like the app teleported. That is a best-effort context hint, not
authoritative state.

### Granularity

One entry per accepted change:

- an accepted assistant edit
- a Save
- a Save to File

Nothing else. No keystroke coalescing, no time windows - one request is one
edit is one entry, which is the granularity the user already thinks in.

### Where it hooks in

Every model change funnels through `applySource` (`useGraphModel.ts:753`) or
`applyScenarioSource` (`productGraphStore.ts:130`). One door, so one place to
file the copy.

Add a single store action that takes the snapshot before applying:

```
commitDocument(nextYaml, { label, source })
  -> push the current document tier onto the undo stack
  -> clear the redo stack
  -> apply
```

### The restore path

Undo must **not** call `applySource`. It deliberately resets `graphMode` to
`"structure"`, clears `selectedNode`, and nulls `lcaResult`
(`productGraphStore.ts:110-118`), so undoing through it would eject you from
scaled mode and blank your scores.

Use a variant of `applyScenarioSource` (`:130`), which already advances the
revision while preserving mode, selection, and the previous result. The correct
apply path for undo is essentially already written.

### Redo

A second stack, filled by undo and cleared the moment a new edit lands. Standard
behavior, and cheap once snapshots exist.

### Instant undo

Undo changes `appliedYaml`, which normally means waiting for the server to
recalculate. Cache `LcaResult` in a ~20-entry LRU keyed by a content hash of
`appliedYaml`, so stepping back to a document you calculated a minute ago
restores its scores immediately.

The existing revision guard (`useCalculation.ts:75,80`) already makes
undo-during-calculation safe. This is optional - skip it if calculations feel
fast enough.

## The history panel

The undo stack made visible, and the main way to use it.

- newest first, one row per entry
- each row: label, a badge for `you` or `assistant`, relative time
- expand a row to see its diff
- "restore to here" to step back several entries at once

This is where the diff requirement is satisfied, and it is why the panel is not
an optional extra: for assistant edits, seeing what changed is the primary need
and undo is the response to it.

## Cmd+Z

The YAML textarea already has the browser's own undo, per keystroke. Model-level
undo steps between accepted documents. Two different scopes, and binding both to
Cmd+Z means the same key does different things depending on where the cursor is.

Recommendation: leave native text undo alone inside the textarea, and put
model-level undo in the history panel where it is explicit and labelled. Under
this design the textarea is no longer the main editing surface, so the loss is
small. Add a global shortcut later if it is actually missed.

## The edit tools

Two tools, and a system-prompt change.

**`get_yaml_source`** - returns the full document. Must come first; the
assistant cannot sensibly rewrite something it has never seen. Two consequences
to accept deliberately: the document goes to the configured model provider, and
this design assumes documents of a few KB rather than a few thousand lines.

**`propose_yaml_edit(yaml)`** - takes the proposed document, then:

```
validate:  parse + buildGraphStructure, reject on throw
write:     dispatchWorkspace({ type: "edit-draft", yaml })
open:      the Edit view, showing the diff
you:       press Save
```

`Save` already applies, recalculates, and commits the session document
(`useModelWorkspace.ts:183`). So the confirmation step is a button that already
exists, and the assistant has no tool that applies a draft by itself. Almost no
new plumbing, and the human step cannot be bypassed.

Validation is not a formality: `buildGraphStructure` (`src/lib/yamlGraph.ts:95`)
already requires a non-empty process list, a resolvable `reference_process`, and
a positive `reference_output` on every process. A rejected proposal is returned
to the model as a structured error and never shown as an applied change.

One thing to instruct explicitly: preserve comments and formatting. The app no
longer reformats YAML, but nothing stops a model from dropping your comments
when it regenerates a section. The diff will expose it when it does.

## Persistence

Undo history is session-scoped and does not need to survive a reload.

The **models** are a different matter. `sessionDocuments` lives in memory only,
so a refresh or tab close loses every model made this session - and the
"are you sure" prompt only fires when there are *unsaved* changes
(`useModelWorkspace.ts:148`), so saving everything properly removes the warning
and the work goes silently. The app already persists the chat API key, the chat
panel width, and the toolbar position.

Persisting the workspace slice to `localStorage` is about 30 minutes. It is not
strictly part of undo, but it belongs in the same conversation: undo protects
you from your last action, persistence protects you from a stray Cmd+W, and
assistant editing produces variants faster than anyone remembers to download
them. It is a convenience, not a backup - clearing site data wipes it, and
Download YAML remains the real archive.

## Phases

| Phase | Work | Est. |
| --- | --- | --- |
| 1 | Nest the workspace slice so there is an object to snapshot | ~45 min |
| 2 | Undo/redo stacks, `commitDocument`, the restore path | ~1.5 h |
| 3 | History panel with labels and "restore to here" | ~1 h |
| 4 | Diff rendering, in the panel and for assistant proposals | ~1 h |
| 5 | `get_yaml_source`, `propose_yaml_edit`, prompt change | ~1 h |
| 6 | Result cache for instant undo (optional) | ~30 min |
| - | Persist the workspace slice (optional, independent) | ~30 min |
| - | Vitest for the pure parts - reducer, stacks, validation | ~30 min |

**About 6 hours** of agent working time, or roughly a working day spread across
review cycles.

Phases 1-3 give working undo. Phase 4 is what makes it trustworthy for
assistant edits. Phase 5 is the editing itself and can land before or after
undo - they are independent, but 4 should not ship without 5 or there is nothing
interesting to diff.

Do Vitest before Phase 2. The stacks and the reducer are pure functions and the
highest-value thing to test; there is currently no unit test runner, only
Playwright.

## Open decisions

1. Does `propose_yaml_edit` take the whole document or a named section? Whole
   document is simpler and fine at current sizes.
2. Does the diff appear in the chat, in the Edit view, or both?
3. How many undo levels? 100 is free at 2 KB per document.
4. Should undo move the view to where the change is, or leave the camera alone?

## Verification

Per phase, run each separately:

```bash
npm run build
npm run lint
npm run test:responsive
npm run test:visual
```

The baselines recorded in `AGENTS.md`, `CLAUDE.md`, `TODOs.md`, and
`responsive-baseline.md` (24 responsive, 29 visual with 3 accepted failures) do
not match the suite. Measured on `0abf734`: 53 responsive passed with 1
viewport-conditional skip, and 31 visual passed with no failures. Re-measure and
update those documents before Phase 1 so later phases are not compared against a
baseline that describes nothing.

Never update screenshot baselines without visually reviewing actual, expected,
and diff images.
