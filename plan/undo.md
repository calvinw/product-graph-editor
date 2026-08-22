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

## This is artifact editing with a different transport

One document, two authors, edited through a chat, with a preview beside it.
That is the artifact pattern, and the only thing that differs here is how the
document moves: tool calls rather than `<artifact>` tags embedded in the message
body.

`calvinw/llm-artifacts` (Nov 2024) implemented the tag version of this and got
several things right that are worth carrying over directly. It also shows where
the work stops: `revisions` was initialized and never written, `saveRevision`
was never called, and the `prev-version` / `next-version` / `clear-revisions`
buttons exist in the DOM with no listeners. The exchange protocol was solved;
the history was not. That is the part this plan builds.

Tool transport is a real improvement in one respect. Tags could only ask the
model to honour a version handshake and hope. A tool takes a parameter and can
reject outright, so the same rule becomes enforceable in code rather than by
convention.

The one thing genuinely new here: the document drives a graph and a
calculation, so applying an edit invalidates downstream state. That is what
"apply" does; it does not change the versioning model.

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

A second stack, filled by undo and cheap once snapshots exist. Redoing an
assistant edit is no different from redoing your own - the snapshot does not
care who authored it.

Two rules need stating, because assistant editing makes them ambiguous:

**Only an accepted edit clears the redo stack.** Undo an assistant edit, then
ask a follow-up question, and redo must still be available - reading the graph,
listing views, or summarizing results are not edits. The stack clears when a new
document is committed, not when the assistant does something.

**A new proposal does not clear it either.** A proposal writes the draft; it
does not commit a document. Redo survives until you accept something.

### Proposals are not history

Only accepted changes become entries. A proposal that is never saved leaves no
trace in the stack, and a second proposal replaces the first in the draft rather
than queueing behind it.

This keeps the history honest: it lists documents that actually existed, not
things the assistant suggested. It also means the Discard action on a pending
proposal is not undo - it is just abandoning a draft, which the workspace
reducer already handles.

### Instant undo

Undo changes `appliedYaml`, which normally means waiting for the server to
recalculate. Cache `LcaResult` in a ~20-entry LRU keyed by a content hash of
`appliedYaml`, so stepping back to a document you calculated a minute ago
restores its scores immediately.

The existing revision guard (`useCalculation.ts:75,80`) already makes
undo-during-calculation safe. This is optional - skip it if calculations feel
fast enough.

## Staleness: the version handshake

The assistant can be working from a document that no longer exists. Undo is the
obvious way this happens - you accept an edit, undo it, and the transcript still
says the dyeing stage is there - but so is editing the YAML by hand between
turns, or restoring an old version from the history panel.

`llm-artifacts` solved this with two pieces, and both translate.

### A version stamp on every exchange

It kept an `exchangeVersion` counter that both sides stamped, and on each reply
checked `llmsReturnedVersion == exchangeVersion + 1`. Here the equivalent is:

- `get_yaml_source` returns the document **and** the current version id
- `propose_yaml_edit(yaml, basedOnVersion)` requires that id back
- the tool **rejects** the proposal if `basedOnVersion` is not the current
  version, and tells the model to re-read

The tag version could only check and shrug. A tool rejects, so a stale proposal
can never be written to the draft. This is the mechanism; everything else is
convenience.

### A dirty flag so the document is only re-sent when it changed

`llm-artifacts` tracked `llmNeedsUserChanges`: the artifact was re-embedded in
the next user message only when the user had actually edited it, set true on
editor change and blur and cleared once the model replied.

The same idea, adapted to pull-based tools: when the user has changed the
document since the assistant last read it, say so in the next turn - a short
system note, "the document changed since you last read it; call
`get_yaml_source` before proposing" - rather than pushing the whole document
again. When nothing has changed, say nothing and let the model use what it has.

This is better than the blanket "always re-read before every proposal" rule an
earlier draft of this plan recommended. It costs a tool call only when one is
actually needed, and the `basedOnVersion` rejection is the backstop for when the
model ignores the hint.

## Keeping the document out of the transcript

`cleanupOldArtifacts()` in `llm-artifacts` stripped embedded artifacts older
than `current - 2` out of the message history, so the conversation did not
accumulate a full copy of the document per turn.

The same problem exists here in a different shape. Tool results are pushed into
the conversation as messages (`AiChatPanel.tsx`, `apiMessages.push({ role:
"tool", ... })`), so every `get_yaml_source` result sits in the transcript
exactly as an embedded artifact would, and context grows linearly with the
number of reads.

Prune it the same way: keep the most recent one or two `get_yaml_source`
results in full and replace older ones with a short placeholder. The document is
always retrievable by calling the tool again, so nothing is lost - and the
version handshake means the model cannot silently rely on a pruned copy anyway.

Corollary: do not cache the document in the assistant's context across turns as
a token optimization. It saves little and reintroduces exactly the staleness
this section exists to prevent.

## The history panel

The undo stack made visible, and the main way to use it.

- newest first, one row per entry
- each row: label, a badge for `you` or `assistant`, relative time
- expand a row to see its diff
- "restore to here" to step back several entries at once

This is where the diff requirement is satisfied, and it is why the panel is not
an optional extra: for assistant edits, seeing what changed is the primary need
and undo is the response to it.

## Cmd+Z and the text editor

Two undo scopes exist and they must not fight. The browser gives the YAML
textarea per-keystroke undo for free; model-level undo steps between accepted
documents. Focus decides which one Cmd+Z drives:

- `event.target` is a text input or textarea -> let the browser handle it
- anything else -> `preventDefault` and run model undo

Same routing for Shift+Cmd+Z. This also leaves the chat composer's native undo
alone, which is what anyone would expect.

### The handoff: snapshot when text undo dies

Focus-based routing alone would leave a hole, because native text undo is not
durable. The Edit view is conditionally rendered (`App.tsx:485`), so the
textarea **unmounts** when you switch to the graph - and its undo stack is
destroyed with it. That is true today: type, look at the graph, come back, and
there is nothing to undo.

So capture a history entry at exactly the moment native undo stops being able to
help: when focus or the view leaves the editor. Text undo covers the current
editing session; model undo covers everything before it. Clean handoff, no
overlap, and it plugs an existing hole rather than only dividing labour.

Three rules make it behave:

**Only snapshot when the draft actually changed.** Blur fires constantly -
clicking a toolbar button, opening a menu, focusing the chat. Compare against
the last entry and do nothing if the text is identical. That removes most of the
noise without any timing heuristics.

**Do not rely on blur alone.** Removing a focused element does not fire `blur`
reliably across browsers. Also snapshot on a view change away from `yaml`, and
in the editor's unmount cleanup.

**Label draft entries differently.** These are unsaved drafts, not documents
that were ever applied. The history should distinguish "Edited YAML (unsaved)"
from "Saved", because undoing to a draft entry restores `yamlDraft` only -
`appliedYaml` does not move, so the graph stays put and the only visible changes
are the editor contents and the dirty flag. From any other view that undo step
looks like nothing happened, which is an argument for open decision 4.

### The poisoned native stack

When model undo programmatically replaces the textarea's contents, the browser's
undo stack for that element is stale but still live. Focus the field, press
Cmd+Z, and the browser may undo back to pre-restore text, desyncing the draft
from the history.

There is no API to clear a plain textarea's undo stack. **Fix: remount it** -
change the textarea's `key` after any programmatic replacement, which resets the
stack. One line, and the editor holds no other local state worth preserving.

### Deferred: a real code editor

Ace or CodeMirror ship their own undo managers with an API to reset them, which
would remove this problem rather than work around it. `llm-artifacts` used Ace
for exactly this surface.

Not now. Under this design the textarea stops being the main authoring surface -
it is mostly read, and diffs are accepted rather than typed - so investing in a
code editor for a surface being deliberately de-emphasized is backwards. It
costs a dependency, a wrapper, dark and light theming, responsive verification
at all three viewports, and visual snapshot churn, against a bundle already over
1 MB with Vite's chunk warning firing.

**What would justify it:** YAML syntax highlighting, and specifically error
markers on the line where `buildGraphStructure` failed. That is a real win for a
YAML-driven app and is the trigger to watch for. The undo behaviour would come
along free at that point.

**Keep the option cheap.** The textarea currently sits inline in `App.tsx:476`,
tangled with the editor chrome and the status line. Extract it into a
`<YamlEditor>` component - fifteen minutes, no behaviour change - so a later
swap is one file rather than surgery on `App.tsx`.

## The edit tools

Two tools, and a system-prompt change.

**`get_yaml_source`** - returns the full document **and the current version
id**. Must come first; the assistant cannot sensibly rewrite something it has
never seen. Two consequences to accept deliberately: the document goes to the
configured model provider, and this design assumes documents of a few KB rather
than a few thousand lines.

**`propose_yaml_edit(yaml, basedOnVersion)`** - takes the proposed document
and the version it was written against, then:

```
staleness: reject unless basedOnVersion is the current version
validate:  parse + buildGraphStructure, reject on throw
write:     dispatchWorkspace({ type: "edit-draft", yaml })
open:      the Edit view, showing the diff
you:       press Save
```

The staleness check comes first and is the load-bearing one - it is what makes
undo, hand edits, and history restores safe to perform mid-conversation. A
rejection returns the current version id so the model can re-read and retry.

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
| 3b | Extract `<YamlEditor>`; Cmd+Z routing, blur/unmount snapshots, remount | ~1 h |
| 4 | Diff rendering, in the panel and for assistant proposals | ~1 h |
| 5 | `get_yaml_source`, `propose_yaml_edit`, version handshake, prompt change | ~1 h |
| 5b | Transcript pruning for stale `get_yaml_source` results | ~30 min |
| 6 | Result cache for instant undo (optional) | ~30 min |
| - | Persist the workspace slice (optional, independent) | ~30 min |
| - | Vitest for the pure parts - reducer, stacks, validation | ~30 min |

**About 7.5 hours** of agent working time, or roughly a working day spread
across review cycles.

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
5. When an undo reverts an assistant edit, is a note appended to the
   conversation, or is the mandatory re-read before each proposal enough on its
   own?
6. Do unsaved draft snapshots belong in the same history list as accepted
   documents, or in a separate, quieter section of the panel?

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
