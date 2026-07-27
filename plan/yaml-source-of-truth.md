# YAML Draft, Preview, and LCA Consistency Plan

## Status

Implemented on `shadcn-conversion` on July 27, 2026.

The implementation includes the draft/applied source boundary, result revisions, request cancellation and stale-response guards, dirty-state guidance, and focused Playwright workflow coverage.

## Purpose

Make the YAML shown by the graph, the YAML sent to the LCA engine, and the result-dependent views agree at all times.

The editor will retain an explicit **Preview Graph** boundary:

```text
Edit YAML
  → draft becomes dirty
  → Calculate is disabled
  → Preview Graph validates and applies the draft
  → previous results are cleared
  → Calculate is enabled for the newly visible graph
```

This is a focused consistency fix. It does not redesign the editor, introduce a global state library, or change LCA calculations.

## Why This Work Is Still Needed

The application currently uses one `yamlText` value for several different meanings:

- YAML being edited
- YAML used by Preview Graph
- YAML parsed by graph settings and graph-mode changes
- YAML sent to the LCA engine
- YAML compared with `calculatedYaml`

This creates a hybrid state:

- The main graph does not normally update until Preview Graph is selected.
- Calculate can still analyze an unpreviewed draft.
- Graph settings and graph-mode actions can parse an unpreviewed draft.
- Editing immediately clears results even though the visible graph still represents the previously previewed YAML.
- A late calculation response is not protected from a newer successful preview.

The graph editing boundary itself is already largely correct: Add and Connect actions have been removed, and current graph interactions are view-only.

## Decisions

- YAML remains the sole product-definition source of truth.
- Keep state local to `GraphEditor`; do not introduce Zustand.
- Do not add browser persistence.
- Maintain separate `yamlDraft` and `appliedYaml` values.
- Editing changes `yamlDraft` only.
- Preview Graph is the only action that applies a draft to the visible graph.
- Calculate is disabled while `yamlDraft !== appliedYaml`.
- Calculate always sends `appliedYaml`, never `yamlDraft`.
- Graph settings, graph modes, process counts, and graph label refreshes use `appliedYaml`.
- A successful Preview Graph clears results for the previously applied graph.
- An invalid preview leaves the applied graph and its matching results unchanged.
- An in-flight result must be aborted or ignored if a different YAML revision is successfully applied.
- Existing results may remain visible while the user edits a new draft because they still match the applied graph.
- The YAML editor must clearly indicate that unapplied changes exist and that the graph and results still represent the last successful preview.

## State Model

A reducer is optional. Separate React state values are sufficient if preview and calculation transitions remain atomic.

```ts
type EditorSourceState = {
  // Editable text. It may be incomplete or invalid.
  yamlDraft: string

  // Last draft successfully accepted through Preview Graph.
  appliedYaml: string

  // Incremented after each successful preview.
  appliedRevision: number

  yamlError: string

  // Result metadata must identify the applied source it represents.
  lcaResult: LcaResult | null
  calculatedRevision: number | null
  calculationError: string
  isCalculating: boolean
}
```

Derived values:

```ts
const isDirty = yamlDraft !== appliedYaml

const hasCurrentResults =
  lcaResult !== null &&
  calculatedRevision === appliedRevision

const canCalculate =
  !isDirty &&
  !isCalculating
```

An exact `calculatedYaml` comparison can be retained instead of numeric revisions, but revisions make stale-request checks and intent clearer.

## User-Visible Behavior

### Editing YAML

When the textarea changes:

- Update `yamlDraft`.
- Do not update `appliedYaml`.
- Do not rebuild or relabel the graph.
- Do not clear a result that still matches `appliedYaml`.
- Mark the editor as having unapplied changes.
- Disable Calculate.
- Show guidance such as: **Preview changes before calculating.**

The visible graph and any existing results continue to represent `appliedYaml`.

### Loading a case study or YAML file

Loading a case study or local file follows the same draft behavior:

- Replace `yamlDraft`.
- Mark it as unapplied when it differs from `appliedYaml`.
- Do not silently rebuild the graph.
- Require Preview Graph before Calculate becomes available.

If the product later prefers case-study selection to apply immediately, that should be a deliberate separate decision. It must not bypass validation accidentally.

### Previewing valid YAML

When Preview Graph succeeds:

1. Parse `yamlDraft` in structure mode.
2. Commit `yamlDraft` to `appliedYaml`.
3. Increment `appliedRevision`.
4. Replace the graph nodes, edges, and title.
5. Reset graph mode to `structure`.
6. Clear node selection and YAML errors.
7. Clear the previous LCA result and calculation error.
8. Clear `calculatedRevision`.
9. Abort or invalidate a calculation started for an older revision.
10. Switch to Graph and fit the new graph.

These updates should be one logical transition so the UI cannot briefly show the new graph with an old result.

### Previewing invalid YAML

When parsing fails:

- Set `yamlError`.
- Keep `appliedYaml` and `appliedRevision` unchanged.
- Keep the current graph unchanged.
- Keep the current matching result unchanged.
- Keep Calculate disabled because the draft is still dirty.

### Calculating

Calculate is disabled when:

- `yamlDraft !== appliedYaml`, or
- a calculation is already running.

The disabled control should explain why through adjacent text or a tooltip.

When calculation starts:

- Capture `appliedYaml` and `appliedRevision`.
- Send the captured `appliedYaml` to `calculateLca`.
- Clear the prior calculation error.
- Set `isCalculating`.

When calculation succeeds:

- Accept the response only if its captured revision still equals the current `appliedRevision`.
- Store the result and captured revision.
- Ignore responses for older revisions.

When calculation fails:

- Store the error only if the request still belongs to the current applied revision.
- Do not clear a newer result.

## Applied-YAML Consumers

The following operations must use `appliedYaml`, not `yamlDraft`:

- Graph construction
- Graph settings
- Maximum process count
- Structure/scaled graph switching
- Edge-label refreshes caused by decimal-setting changes
- Background graph projection
- Sankey derivation
- LCA calculation

Only the YAML editor, file loader, case-study loader, and Preview Graph parser should read or update `yamlDraft`.

## Result Availability

The following views require `hasCurrentResults`:

- Inventory
- Impact Analysis
- Process Results
- Contribution
- Sankey Graph
- Scaled Graph mode

LCA Results remains accessible in every state because it contains the Calculate action and idle, running, error, and success presentation.

While the user edits an unapplied draft:

- Existing result-dependent views may remain available because their result still matches `appliedYaml`.
- Their content must continue to use `appliedYaml` and its matching result.
- The YAML editor communicates that the draft has not been applied.

After a successful Preview Graph:

- Clear the previous result.
- Disable result-dependent views and Scaled Graph.
- Re-enable them only after a successful calculation for the new revision.

## Async Safety

Preferred implementation:

- Extend `calculateLca(productGraph, signal?)` to pass an `AbortSignal` to all fetch requests.
- Keep the active `AbortController` in a ref.
- Abort it when a different YAML revision is successfully previewed.
- Retain the revision equality check even when aborting, because abort timing alone is not a sufficient correctness guarantee.

If passing a signal through all discovery and calculation requests is deferred, the revision check is mandatory.

Editing a draft without previewing does not invalidate an in-flight request because the request still represents the unchanged applied graph. Successfully applying another draft does invalidate it.

## Graph Interaction Boundary

The following remain view-only interactions:

- Selecting a node
- Opening or closing node details
- Folding or restoring connected nodes
- Searching and fading nonmatching nodes
- Dragging nodes for temporary placement
- Applying layout and display settings
- Fitting, panning, and zooming
- Switching structure and scaled graph modes

These interactions may change React Flow state but must not change `yamlDraft` or `appliedYaml`.

Product-model editing from the graph remains out of scope:

- Add or delete process
- Connect or disconnect processes
- Edit process or flow properties

The Add and Connect toolbar actions have already been removed.

## Implementation Sequence

### Phase 1: Introduce the source boundary

- Rename `yamlText` to `yamlDraft`.
- Add `appliedYaml`, initialized from the bundled jacket YAML.
- Add `appliedRevision` and `calculatedRevision`, or equivalent exact-source tracking.
- Derive `isDirty`, `canCalculate`, and `hasCurrentResults`.
- Update the Calculate disabled state and its explanatory message.
- Stop clearing matching results merely because the draft was edited.

### Phase 2: Commit only through Preview Graph

- Parse `yamlDraft`.
- On success, atomically update the applied source and graph.
- Clear results only after a successful apply.
- On failure, preserve the current applied graph and result.
- Apply the same draft-only behavior to case-study and file loading.

### Phase 3: Move consumers to the applied source

- Change graph settings, graph modes, process counts, edge-label refreshes, Sankey derivation, and calculation to use `appliedYaml`.
- Audit every `buildGraphFromYaml` call.
- Audit every component receiving YAML alongside `lcaResult`.

### Phase 4: Add stale-request protection

- Pass an AbortSignal through `calculateLca`, or implement a revision guard first.
- Abort or invalidate older requests on successful preview.
- Prevent an older success or error from overwriting current result state.

### Phase 5: Add focused workflow tests

- Test the draft/applied boundary.
- Test Calculate disabled and enabled states.
- Test invalid preview preservation.
- Test applied-YAML use in graph settings.
- Test result availability across edit, preview, and calculation transitions.
- Test stale-response rejection.

## Acceptance Criteria

- Editing YAML does not change the visible graph.
- Editing YAML disables Calculate.
- The disabled state explains that Preview Graph is required.
- Existing graph and results remain associated with the last applied YAML while a draft is dirty.
- Previewing valid YAML applies it and re-enables Calculate.
- Previewing invalid YAML preserves the existing graph and matching result.
- Successful Preview Graph clears results for the previous revision.
- Calculate always sends the YAML represented by the visible graph.
- Graph settings and graph modes cannot apply an unpreviewed draft.
- A late response cannot populate results for an older applied revision.
- Inventory, Impact Analysis, Process Results, Contribution, Sankey, and Scaled Graph use only the current applied result.
- Graph interactions do not alter either YAML value.
- No browser persistence or global store is introduced.
- TypeScript, lint, and the production build pass.

## Testing Checklist

### Draft and preview

- Edit valid YAML and confirm the graph is unchanged.
- Confirm Calculate becomes disabled.
- Confirm the editor shows an unapplied-changes message.
- Preview valid YAML and confirm the graph and title update.
- Confirm Calculate becomes enabled after a successful preview.
- Preview invalid YAML and confirm the old graph and result remain visible.
- Correct the draft and confirm a later preview succeeds.

### Applied-source consumers

- Edit a process count without previewing and open Graph Settings.
- Confirm maximum counts and layout still represent the applied graph.
- Change decimal settings and confirm edge labels are refreshed from applied YAML.
- Confirm Scaled Graph remains tied to the current applied result.

### Calculation lifecycle

- Start a calculation with a clean draft and confirm it uses `appliedYaml`.
- Edit without previewing while the request is active and confirm the valid request may finish for the unchanged applied graph.
- Successfully preview a different draft while a request is active and confirm the older response is ignored.
- Cause an API failure and confirm it cannot erase a result for a newer revision.

### Result gating

- Confirm all five analysis views and Scaled Graph are unavailable before calculation.
- Confirm they become available after a successful current calculation.
- Edit an unapplied draft and confirm existing applied results remain internally consistent.
- Preview the draft and confirm old result-dependent views become unavailable.

## Sequencing With the Shadcn Migration

Shadcn configuration work that does not modify `src/App.tsx` may proceed first:

- ESLint and visual-test guardrails
- Import aliases
- `components.json`
- CLI initialization and generated-file reconciliation

Complete this YAML consistency work before the shadcn migration begins rewriting navigation, form controls, and settings inside `src/App.tsx`.

This avoids combining state-transition changes with component substitutions in the same review.

## Out of Scope

- Browser or backend persistence
- Authentication and saved projects
- Collaborative editing
- Graph-based product-model editing
- Replacing React Flow
- Redesigning the YAML editor
- Refactoring all `GraphEditor` state into a reducer
- Replacing result visualizations
