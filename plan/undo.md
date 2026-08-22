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

### An append-only version list, not a stack pair

The artifact model is the right shape: every accepted change creates a
**version**, there is a list of them, and you can go back to any one. That is
not an undo stack, and the difference matters because two people are editing
here. A stack encodes "take back *my* last action", but half the actions are
the assistant's. A version list says what the document has been, who changed
it, and when.

Two consequences.

**Restoring appends.** Going back to v3 adds a new version whose content is
v3's, rather than truncating the list. Nothing is ever discarded. Go back to
v3, dislike it, jump forward to v7 - v7 is still there. With a stack pair,
making one edit after undoing would have destroyed everything ahead of you,
which is the worst possible behaviour when the thing ahead of you was written
by a model three steps ago and you have only just noticed it was wrong.

**There is no redo stack.** Redo is just restoring a later version, so the
"what clears redo" questions disappear. Cmd+Z outside the text editor restores
the previous version, so the muscle memory still works.

The cost: going back and forth leaves several restore entries in the list.
Artifacts behave the same way and nobody minds, because the list is the
interface rather than a hidden stack.

This also settles a question that looks separate: **a save does not clear
history, because saves are the entries.** The version list and the undo
history are one object, so there is no relationship between them to get wrong.

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

### When a version is written

Two triggers, and the second is the one that actually protects you.

**1. You committed something.** A Save, a Save to File, or accepting an
assistant proposal - which is itself a Save under this design.

**2. A proposal arrives, just before it overwrites your draft.** Version at the
boundary of risk, so there is always a restore point immediately in front of
every opaque change, whether or not you end up accepting it.

Trigger 2 closes a hole trigger 1 cannot. Type twenty lines by hand, do not
save, then ask the assistant to tidy it up: it rewrites, and those twenty lines
were never a version. They existed only as a draft. Versioning at the handoff
catches exactly that.

"Send it to the assistant" could mean the `get_yaml_source` call or the
proposal coming back. Take the proposal. Reading the document to answer a
question is not a risk boundary, and versioning on every read fills the list
with noise; capturing at proposal time is the same protection and is also
correct if you edited something between the read and the reply.

**Dedupe: never write a version identical to the latest one.** This makes
trigger 2 tidy. Save and then immediately ask the assistant, and the
pre-proposal snapshot equals the last version, so nothing is added. The
automatic version appears only when you actually have uncommitted work to
protect.

Nothing else is a version. No keystroke coalescing, no time windows.

### Where it hooks in

Every model change funnels through `applySource` (`useGraphModel.ts:753`) or
`applyScenarioSource` (`productGraphStore.ts:130`). One door, so one place to
file the copy.

Add a single store action that takes the snapshot before applying:

```
commitVersion(nextYaml, { label, source })
  -> skip if identical to the latest version (dedupe)
  -> append the document tier to the version list
  -> apply
```

Restoring is the same call with an older version's content, so a restore is an
ordinary append and needs no separate path.

### The restore path

Undo must **not** call `applySource`. It deliberately resets `graphMode` to
`"structure"`, clears `selectedNode`, and nulls `lcaResult`
(`productGraphStore.ts:110-118`), so undoing through it would eject you from
scaled mode and blank your scores.

Use a variant of `applyScenarioSource` (`:130`), which already advances the
revision while preserving mode, selection, and the previous result. The correct
apply path for undo is essentially already written.

### Going forward again

There is no redo stack to reason about. Restoring a later version is the same
operation as restoring an earlier one, and every version stays in the list, so
"going forward" needs no separate mechanism and no rules about what clears it.

Restoring an assistant's version is no different from restoring your own - the
snapshot does not care who wrote it.

### Proposals are not versions

A proposal writes the draft. It does not create a version of its own, and a
second proposal replaces the first in the draft rather than queueing behind it.
The only trace a proposal leaves is the pre-proposal snapshot described above,
and only when there was uncommitted work to protect.

This keeps the list honest: it records documents that actually existed, not
things that were suggested. It also means Discard on a pending proposal is not
a restore - it is abandoning a draft, which the workspace reducer already
handles.

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

## Whole documents everywhere, never patches

Two places a patch format could creep in. Both are rejected. The only diff in
this design is the one rendered on screen so you can see what changed, and it
is computed from two whole documents at display time - never stored, never
transported, never a source of truth.

**Do not store versions as deltas.** At roughly 2 KB a document, a hundred
versions is about 200 KB against a 5 MB localStorage budget - optimizing a
number that does not matter, and paying for it three ways: restoring becomes
replaying patches rather than assigning a string, one bad patch poisons every
version after it, and you own a patch-application implementation with all its
context-matching and fuzz. Assistant edits are large anyway, so a rewrite
touching half the file produces a delta barely smaller than the file. Git works
this way too: whole objects, packed into deltas later purely as an
optimization, with the full object always reconstructable.

**Do not have the assistant return a patch either.** Fewer tokens and clearer
intent, but models are unreliable at emitting patches that actually apply - line
numbers drift, context lines get paraphrased, whitespace shifts - and the
failure mode is a patch that lands in the wrong place. Full document in,
validated by `buildGraphStructure`, diffed by us. The model does what it is good
at; exact comparison is what code is good at.

A line-level LCS diff is about forty lines and needs no dependency. Revisit only
if documents reach thousands of lines with hundreds of versions.

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

**Correction from implementation (August 22, 2026).** The hole described below
is already closed by the existing unsaved-changes guard, so this section's
premise does not hold in this app.

Leaving the Edit view with a dirty draft does not silently unmount the
textarea: `requestAction` intercepts every view change except one *into* `yaml`
and opens the unsaved-changes dialog. Both outcomes resolve the dirtiness
before the editor unmounts — Save records a version, Discard reverts the draft
— so by the time the unmount fires there is nothing new to capture and dedupe
correctly records nothing.

The unmount capture is still implemented, as a cheap safety net and because it
stays correct if that guard is ever relaxed. But it is not the load-bearing
protection this section assumed, and blur was deliberately **not** used as a
trigger: a textarea's native undo stack survives losing focus, so capturing on
blur would add a spurious "unsaved" entry before every Save (clicking Save
blurs the field). A browser test pins the normal path to zero spurious entries.

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

## Later: a database

The version list is already the right shape for a server. It is append-only,
which is the easiest thing there is to store: no row updates, no write
conflicts, no locking.

```sql
models   (id, user_id, title, created_at, updated_at)
versions (id, model_id, parent_id, yaml, label, author, created_at)
```

**Versions sync, drafts do not.** Versions are committed and immutable, so they
are safe to store, share, and read back. Drafts - the working YAML in the
editor, a pending proposal, the scenario overrides - are per-session working
state; syncing them means two tabs fighting over one buffer and needing conflict
resolution for no benefit. The database holds the version history and the model
metadata; the current position in that history is a pointer, held locally.

What changes with a server: durability becomes real rather than a convenience,
the size ceiling disappears so full snapshots are even more clearly right,
`author` becomes a user id instead of "you"/"assistant", and writes become async
and can fail - append locally first, sync in the background, stay usable
offline. With Supabase specifically, row-level security on `user_id` and
realtime subscriptions for cross-tab updates both come nearly free.

**The one thing to get right now, before any of this exists:** put the version
store behind a small interface - `list(modelId)`, `get(versionId)`,
`append(modelId, version)` - with localStorage as the first implementation. The
database then becomes a second implementation and the migration is a day. The
failure mode to avoid is scattering `localStorage` calls through components the
way the chat panel currently does; retrofitting that later means touching
everything.

## Phases

| Phase | Work | Est. |
| --- | --- | --- |
| 1 | Nest the workspace slice so there is an object to snapshot | ~45 min |
| 2 | Version list behind a store interface, `commitVersion`, restore path | ~1.5 h |
| 3 | History panel with labels and "restore to here" | ~1 h |
| 3b | Extract `<YamlEditor>`; Cmd+Z routing, blur/unmount snapshots, remount | ~1 h |
| 4 | Diff rendering, in the panel and for assistant proposals | ~1 h |
| 5 | `get_yaml_source`, `propose_yaml_edit`, version handshake, prompt change | ~1 h |
| 5b | Transcript pruning for stale `get_yaml_source` results | ~30 min |
| 6 | Result cache for instant undo (optional) | ~30 min |
| - | Persist the version list to localStorage (optional, independent) | ~30 min |
| - | Vitest for the pure parts - reducer, version list, validation | ~30 min |

**About 7.5 hours** of agent working time, or roughly a working day spread
across review cycles.

Phases 1-3 give a working version history. Phase 4 is what makes it
trustworthy for assistant edits. Phase 5 is the editing itself and can land
before or after - they are independent, though 4 has little to show without 5.

Phase 2 should put the version list behind `list` / `get` / `append` from the
start, so the later move to a database is a second implementation rather than a
rewrite.

Do Vitest before Phase 2. The version list and the reducer are pure functions
and the highest-value thing to test; there is currently no unit test runner,
only Playwright.

## Open decisions

1. Does `propose_yaml_edit` take the whole document or a named section? Whole
   document is simpler and fine at current sizes.
2. Does the diff appear in the chat, in the Edit view, or both?
3. How many versions are kept? 100 is free at 2 KB per document, and the list
   is append-only, so this is a trimming policy rather than a limit.
4. Should restoring move the view to where the change is, or leave the camera
   alone?
5. When an undo reverts an assistant edit, is a note appended to the
   conversation, or is the mandatory re-read before each proposal enough on its
   own?
6. Do the automatic pre-proposal versions belong in the same list as the ones
   you committed deliberately, or in a quieter section of the panel?

## Verification

Per phase, run each separately:

```bash
npm run build
npm run lint
npm run test:responsive
npm run test:visual
```

**Done (August 22, 2026).** The stale baselines were re-measured at `0612d95`
and corrected in `AGENTS.md`, `CLAUDE.md`, `TODOs.md`, `README.md`, and
`responsive-baseline.md`. `README.md` also carried the stale numbers and was not
in the original list. The current baseline is **53 responsive passed with 1
deliberate viewport-conditional skip, and 31 visual passed with no failures**;
both suites exit zero. All three formerly accepted visual failures (#37, #38,
#39) are fixed and closed, so there is no accepted-failure allowance and a
failing visual test is now a regression.

Never update screenshot baselines without visually reviewing actual, expected,
and diff images.
