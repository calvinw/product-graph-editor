# Model Menu and Session Save Plan

**Status:** Implemented on `agent-ui-responsive` on August 14, 2026. Retained as the model-workspace behavior specification; the later Zustand integration supersedes only its local-state implementation constraint.
**Branch:** `agent-ui-responsive`
**Recorded:** August 14, 2026
**Scope:** Model navigation, YAML editing, in-session saves, engine submission, and YAML import/export

## Purpose

Replace the current catalog selector and mixed File/editor actions with one simple model-document workflow.

The application should distinguish three separate operations:

```text
Save
  -> validate and commit the current YAML in this browser session
  -> apply it to the graph
  -> submit it to the LCA engine

Download YAML
  -> export YAML to the user's computer
  -> does not save, apply, or submit it

Upload YAML
  -> import a YAML file into the current browser session
  -> does not create backend persistence
```

This phase intentionally does not add authentication, a database, browser storage, or models that survive a page refresh. A user must download YAML and upload it later if they want to preserve work between sessions.

## Goals

- Rename the `File` menu to `Model`.
- Replace the catalog dropdown with the current model title.
- Move catalog selection into the Model menu.
- Treat catalog models as immutable examples/templates.
- Let users edit a catalog model, but require `Save As...` to create a writable session copy.
- Let `Save` commit later edits to a writable session model and submit the committed YAML to the LCA engine.
- Keep `Download YAML` as an explicit and independent export action.
- Add `New model`, which opens a blank YAML editor.
- Remove Paste YAML actions and language everywhere.
- Keep unsaved-change protection when an action would replace or leave a draft.
- Preserve the existing draft/applied YAML and calculation-revision consistency guarantees.
- Keep the workflow usable at phone, tablet portrait, and desktop sizes.

## Non-goals

- Account-backed or server-backed saved models
- `localStorage`, IndexedDB, or other browser persistence
- Authentication
- Collaboration or model sharing
- Automatic recovery after refresh or browser close
- A separate file manager or `My files` panel
- Creating a distinct `New from template` command in this phase
- Writing changes back to the engine's catalog
- Silently overwriting files on the user's computer
- Rewriting the YAML `name:` field when the session model is renamed

The catalog examples are the initial templates. A future release may rename the `Catalog models` group to `Templates` or expose `New from template` without changing the underlying document lifecycle.

## Terminology

### Draft YAML

The text currently shown in the editor. It may be incomplete or invalid and may differ from the model used by the graph and results.

### Committed YAML

The last valid YAML accepted by Save or Save As. It is the source used to build the visible graph and the only YAML sent to the LCA engine.

### Catalog model

An immutable model returned by the engine catalog. Its YAML may be edited as a draft, but the catalog entry itself can never be updated.

### Session model

A named, writable model held only in React memory for the current page session. It is created by Save As or Upload and disappears on refresh or browser close.

### Downloaded YAML

A file exported to the user's computer. Downloading does not change the draft, commit state, model title, or engine state.

## Navigation Design

Replace the catalog dropdown and File trigger with a static current-model title and a Model menu:

```text
[ Current model title ]  [ Model v ]  [ Graph ] [ Editor ] [ Results v ]
```

The title occupies the location currently used by the product-graph dropdown. It is not itself another model picker.

Title rules:

- Catalog model: use the catalog display name.
- New unsaved model: use `Untitled model`.
- Save As: immediately use the chosen session-model name after a successful commit.
- Uploaded model: use the uploaded filename without `.yaml` or `.yml`.
- Session model: use its saved session name.
- Long titles truncate visually and expose the complete title through accessible text or a tooltip.
- The document title is separate from the YAML domain-level `name:` value; Save As must not silently modify YAML content.

## Model Menu

Use a single grouped menu rather than separate catalog and file controls.

```text
Model

  New model

  Catalog models
    Jacket
    Cotton Fiber
    Simple Mock Plastic Broom

  This session                 shown only when session models exist
    My Jacket Study
    Packaging Comparison

  -------------------------

  Save                         contextual; writable session models only
  Save As...

  -------------------------

  Upload YAML...
  Download YAML
```

Behavior and availability:

- `New model` opens a blank draft in the Editor.
- Selecting a catalog entry loads its YAML, makes it the committed model, submits it for calculation, and opens the Editor.
- Selecting a session model restores its committed YAML, submits it for calculation, and opens the Editor.
- `Save` is available only for a writable session model with uncommitted changes.
- `Save As...` is available for any nonempty model and always creates a new session model.
- `Upload YAML...` opens the browser file picker.
- `Download YAML` is available when the editor contains nonempty YAML.
- Catalog and session groups scroll within the menu if their combined content exceeds the viewport.
- For the current small catalog, keep entries in a flat labeled group rather than adding a nested submenu.

## Document States

| State | Editable | Primary editor action | Save result |
| --- | --- | --- | --- |
| Catalog, unchanged | Yes | None or `Save As...` | Catalog remains immutable |
| Catalog, modified | Yes | `Save As...` | Creates a writable session model |
| New, blank | Yes | `Save As...` disabled until nonempty | Creates a writable session model |
| New, populated | Yes | `Save As...` | Creates a writable session model |
| Uploaded, unchanged | Yes | None | Already a writable session model |
| Uploaded, modified | Yes | `Save` | Updates the in-memory session model |
| Session model, unchanged | Yes | None | No action required |
| Session model, modified | Yes | `Save` | Updates the in-memory session model |

`Save As...` also remains available for a clean catalog or session model so the user can deliberately create a named copy.

## State Model

Keep state local to `GraphEditor` for this phase. Do not introduce a global state library.

A representative model is:

```ts
type CatalogDocument = {
  kind: "catalog"
  id: string
  title: string
  filename: string
  committedYaml: string
}

type SessionDocument = {
  kind: "session"
  id: string
  title: string
  filename: string
  committedYaml: string
  source: "new" | "catalog-copy" | "upload" | "session-copy"
}

type ModelDocument = CatalogDocument | SessionDocument

type ModelWorkspaceState = {
  activeDocument: ModelDocument | null
  sessionDocuments: SessionDocument[]
  yamlDraft: string
  appliedYaml: string
  appliedRevision: number
}
```

Derived state:

```ts
const isDirty = yamlDraft !== activeDocument?.committedYaml
const canSave = activeDocument?.kind === "session" && isDirty
const canSaveAs = yamlDraft.trim().length > 0
const canDownload = yamlDraft.trim().length > 0
```

An unsaved New model may use a small transient draft descriptor rather than being added to `sessionDocuments` before Save As. Preserve enough prior-document context for `Discard` to return to the last committed model.

Session identifiers may use `crypto.randomUUID()`. They are runtime identities only and must not be presented as persistent IDs.

## Save and Save As

### Save

Save is a commit-and-submit operation, not a file download.

For a writable session model:

1. Validate `yamlDraft` using the existing graph parser.
2. If validation fails, keep the draft, graph, committed YAML, and existing matching results unchanged; show the error in the Editor.
3. Update the active session document's `committedYaml` in memory.
4. Commit the same source to `appliedYaml` and increment `appliedRevision`.
5. Rebuild the graph from that committed source.
6. Clear results belonging to the previous applied revision.
7. Abort or invalidate calculations for older revisions.
8. Submit the committed YAML to `calculateLca`.
9. Accept a calculation response only when it still matches the current applied revision.

Save may return the user to a pending destination as soon as local validation and commit succeed. The destination can show the existing calculation-in-progress state while the engine request is running.

If local commit succeeds but the engine request fails:

- keep the session model committed
- keep the newly built structure graph
- show the engine error
- leave result-dependent views unavailable until a later successful calculation

This preserves the distinction between saving a valid model in the session and obtaining calculated results from the engine.

### Save As

Save As creates a new writable session model. It never changes a catalog entry.

1. Open a form dialog with a required `Model name` field.
2. Suggest the catalog name, uploaded filename stem, YAML `name`, or `Untitled model`, in that order when applicable.
3. Require a nonblank name of at most 120 characters.
4. Require names to be unique within `This session`, compared case-insensitively.
5. Validate the YAML before creating the session model.
6. Create the new in-memory document and make it active.
7. Change the visible model title to the chosen name.
8. Commit and submit the YAML through the same pipeline as Save.

Use a form-capable shadcn Dialog for Save As rather than an AlertDialog. Inspect `src/components/ui/` first and add the primitive through the shadcn CLI only if it remains absent at implementation time.

## New Model

`New model` replaces `New or paste YAML`.

- Open the Editor with a truly blank textarea.
- Set the transient title to `Untitled model`.
- Do not add the model to `This session` yet.
- Do not show Paste controls or instructions.
- Disable graph and result continuation until valid YAML is committed through Save As, or offer the normal discard path back to the prior committed model.
- Use guidance such as: `Start writing YAML, or upload an existing model from the Model menu.`

`New from template` is deferred. Catalog models already provide that workflow: choose a catalog example, edit it, and use Save As.

## Catalog Models

Catalog models are immutable templates supplied by the LCA engine.

- Selecting one loads its source as both draft and committed YAML.
- The selected model is submitted to the engine using the existing calculation flow.
- Editing updates only `yamlDraft`; it must not immediately change the selected document to a generic custom model.
- `Save` must never update a catalog entry.
- A dirty catalog model presents `Save As...` as its primary action.
- Save As records `source: "catalog-copy"` in session state for future migration, but no source badge is required in the first UI.

## Upload YAML

Upload is an import operation:

1. Accept `.yaml` and `.yml` files.
2. Read the source locally.
3. Validate it before replacing the current committed model.
4. If invalid, open or remain in the Editor, preserve the prior applied graph and results, and show the parsing error with the uploaded source available for correction.
5. If valid, create a writable session model using the filename stem as its title.
6. Commit, apply, and submit the YAML to the engine.
7. Add it to `This session`.

Uploading does not write back to the original file. Later Save operations update only the in-memory session model. The user must use Download YAML to write an exported version to disk.

## Download YAML

Download is intentionally independent of Save:

- Export the exact current `yamlDraft`, including uncommitted or invalid text.
- Do not validate, commit, apply, calculate, rename, or clear the dirty state.
- Use the active document's filename when available.
- For a named session model, derive a safe `<model-name>.yaml` filename.
- Fall back to `untitled-model.yaml`.
- Do not imply that an existing local file has been overwritten; normal browser download behavior applies.

Allowing draft export provides a recovery path even when the YAML is incomplete or the engine is unavailable.

## Unsaved-Change Protection

Guard any action that would replace a dirty draft or leave the Editor for a view representing committed YAML:

- Graph or Results navigation
- selecting a different catalog model
- selecting a different session model
- New model
- Upload YAML

For a dirty writable session model:

```text
Save changes to "My Jacket Study"?

[Keep editing] [Discard changes] [Save]
```

For a dirty catalog or new model:

```text
Save a copy before continuing?

[Keep editing] [Discard changes] [Save As...]
```

Rules:

- `Keep editing` cancels the pending action and returns focus to the Editor.
- `Discard changes` restores the active document's committed YAML and performs the pending action.
- Discarding a transient New model returns to the previously committed document before performing compatible navigation.
- `Save` or `Save As...` commits first, then performs the pending action after local validation succeeds.
- Invalid YAML keeps the user in the Editor and does not perform the pending action.
- Preserve the existing `beforeunload` warning for dirty drafts.
- Do not add an unload warning solely because clean session models have not been downloaded; loss on refresh is an accepted limitation of this phase.

## YAML Editor Simplification

Remove from the Editor header:

- Paste YAML
- Upload
- the catalog dropdown

Remove the phrases:

- `Paste YAML`
- `Pasted YAML`
- `New or paste YAML`

The Editor should contain:

- a compact `Product graph YAML` heading
- optional one-line state guidance
- the YAML textarea
- a status/error area
- one contextual primary action: `Save` or `Save As...`

The Model menu duplicates Save and Save As for global access. The contextual Editor button remains because it is the natural completion action while editing and is more discoverable than a menu-only command.

The current Calculate button is removed from the Editor. Save and Save As own the apply-and-submit boundary. Calculation progress and errors remain visible through the existing status patterns.

## Responsive and Accessible Behavior

Verify at:

- 375 x 812
- 768 x 1024
- 1440 x 900

Requirements:

- The model title truncates without pushing navigation outside the viewport.
- The Model menu stays within the viewport and scrolls internally when needed.
- Every catalog entry, session model, and action remains reachable by touch and keyboard.
- Menu items retain visible focus and appropriate disabled semantics.
- Save As traps focus, labels its input, supports Enter to submit, supports Escape/Cancel, and restores focus to its trigger.
- Unsaved-change dialogs stay inside the viewport and restore focus appropriately.
- The Editor retains useful textarea height after its header and footer are simplified.
- No page-level horizontal overflow is introduced.
- Do not create a separate mobile-only information architecture. Use the same groups and state rules in the responsive navigation surface.

## Implementation Sequence

### Phase 1: Document lifecycle state

- Introduce catalog/session document types and in-memory `sessionDocuments`.
- Keep `yamlDraft`, `appliedYaml`, `appliedRevision`, and `calculatedRevision` protections.
- Stop changing catalog identity to `custom` on the first textarea edit.
- Centralize valid commit, graph apply, and engine submission transitions.

### Phase 2: Model menu and title

- Replace the product graph dropdown with a static current-model title.
- Rename File to Model.
- Add New, Catalog models, This session, Save, Save As, Upload YAML, and Download YAML groups.
- Remove development-only Stitch navigation from the production-facing Model menu; preserve any still-required test route through an explicitly development-only mechanism.

### Phase 3: Save workflows

- Add the Save As form dialog.
- Implement session model creation, unique names, title changes, and contextual Save.
- Implement Upload as session-model creation.
- Keep Download as draft export without state mutation.

### Phase 4: Editor and transition guards

- Remove Paste and inline Upload controls.
- Replace Calculate with contextual Save or Save As.
- Replace the current Calculate/Discard navigation dialog with Save/Save As/Discard behavior.
- Add guards to model replacement actions, not only view changes.
- Retain stale-calculation cancellation and revision checks.

### Phase 5: Browser verification and cleanup

- Exercise the complete workflow at all supported viewports.
- Update behavioral tests that currently refer to Paste YAML, the catalog combobox, or Calculate as the commit action.
- Add focused lifecycle coverage.
- Inspect actual, expected, and diff images before considering any screenshot update.
- Run the required suites separately.

## Test Coverage

Add or update Playwright coverage for:

1. The current model title replaces the catalog dropdown.
2. The Model menu exposes New, catalog entries, Save/Save As, Upload, and Download.
3. No visible or accessible Paste YAML action remains.
4. Selecting a catalog model loads its YAML and opens the Editor.
5. Editing a catalog model leaves the catalog identity intact and requires Save As.
6. Save As validates YAML, creates a named session model, changes the title, applies the graph, and submits the exact committed YAML to the engine.
7. The new model appears under `This session` and can be reopened during the same page session.
8. Editing a session model presents Save and updates that model without creating a duplicate.
9. New model starts blank and cannot continue to committed views without Save As or discard.
10. Upload creates a writable session model using the filename stem.
11. Download exports the exact draft and does not clear dirty state or issue an engine request.
12. Invalid Save/Save As preserves the prior graph and matching results.
13. An engine failure preserves the locally committed session model and structure graph while result views remain unavailable.
14. A stale engine response cannot populate results after a newer save.
15. Dirty navigation offers the correct Save versus Save As action and resumes the original destination after a valid commit.
16. Model replacement actions also protect dirty changes.
17. Browser unload warns only when the current draft is dirty.
18. The menu, Save As dialog, and editor remain contained and keyboard-operable at all three supported viewports.

Mock the LCA API in browser tests and assert the POST body contains the committed YAML, not a stale applied source or a later uncommitted draft.

## Verification

Run separately:

```bash
npm run build
npm run lint
npm run test:responsive
npm run test:visual
```

Expected baseline rules:

- responsive tests continue to pass at 375 x 812, 768 x 1024, and 1440 x 900
- no previously passing visual test may fail
- the accepted visual failures in `plan/responsive-baseline.md` may not change or expand
- screenshots may not be updated without inspecting actual, expected, and diff images

## Future Persistence

This plan deliberately makes persistence replaceable.

In a later phase:

- load account-backed models into the same Model menu, replacing or extending `This session`
- make Save update a backend model record
- make Save As create a backend model record
- retain catalog immutability
- retain Upload and Download as import/export operations
- preserve the same title, dirty-state, and transition-guard behavior

The historical `origin/saved-files` branch contains a Supabase schema and private-model proof of concept. Treat it as reference material for a future persistence phase, not as code to merge into this UI phase. Its separate `My files` panel should not be reintroduced if the unified Model menu is already in place.

## Acceptance Criteria

- The current model name appears where the catalog dropdown is today.
- A single Model menu owns model creation, selection, save, import, and export actions.
- Catalog models remain immutable and require Save As before edited YAML can be committed.
- New models start with blank YAML and require Save As for the first commit.
- Uploaded models are writable session models.
- Save validates, commits in memory, applies to the graph, and submits the committed YAML to the engine.
- Save As creates a named writable session model and changes the displayed title.
- Download YAML exports the current draft without changing application state or contacting the engine.
- Session models can be revisited until the page is refreshed and are not persisted across sessions.
- Dirty drafts cannot be silently lost through view or model changes.
- No Paste YAML UI or copy remains.
- Graphs, results, and engine requests continue to use only the committed applied YAML.
- Stale engine responses cannot overwrite results for a newer committed revision.
- The workflow is accessible and contained at all supported viewport sizes.
- No authentication, database, browser persistence, or unrelated UI refactor is introduced.
