# YAML Source-of-Truth and LCA State Plan

## Purpose

Refactor the editor state so that YAML is the only source of truth for the product graph. The graph is a read-only visualization: graph interactions may change how the graph is viewed, but they must not modify the product definition.

This work should be scheduled while other contributors are not changing the UI because the main integration point is currently `src/App.tsx`.

## Decisions

- Do not introduce Zustand at this stage.
- Do not add `localStorage`, IndexedDB, or another persistence layer yet.
- User accounts, saved projects, and durable state will eventually be handled by a backend database.
- YAML is the sole product-graph source of truth.
- The YAML editor has an explicit apply boundary: **Preview Graph**.
- Typing in the editor does not immediately rebuild the graph.
- A successful preview rebuilds the graph and invalidates all previous LCA results.
- Inventory, Contribution, and Sankey are available only after a successful LCA calculation for the currently applied YAML.
- Graph selection, dragging, folding, expansion, search, layout, pan, and zoom are view-only actions.
- Creating, connecting, deleting, or editing product nodes in the graph is out of scope and should not be presented as available graph actions.

## State Model

Keep the state local to the editor using ordinary React state.

```ts
type CalculationStatus = "idle" | "running" | "success" | "error"

type EditorState = {
  // YAML currently being edited. It may be incomplete or invalid.
  yamlDraft: string

  // Last YAML successfully accepted through Preview Graph.
  appliedYaml: string

  yamlError: string

  // Read-only graph projection of appliedYaml.
  nodes: Node<ProcessNodeData>[]
  edges: Edge[]
  graphTitle: string

  calculationStatus: CalculationStatus
  calculationError: string
  lcaResult: LcaResult | null

  // Temporary view state.
  view: EditorView
  selectedNodeId: string | null
  query: string
  graphMode: "structure" | "scaled"
}
```

Not every field needs to be placed in one state object. Separate `useState` values or a local `useReducer` are both acceptable. A reducer may be preferable if it makes the preview and calculation transitions atomic and easier to test.

## Source and Derived State

### Stored state

- `yamlDraft`
- `appliedYaml`
- YAML parsing error
- LCA result, status, and error
- Temporary graph/view interaction state

### Derived state

Do not store values that can be computed reliably from existing state:

- Results Markdown is derived from `lcaResult` using `lcaResultToMarkdown`.
- Inventory data is derived from `lcaResult.lci`.
- Contribution data is derived from the appropriate LCA result fields.
- Sankey data is derived from `appliedYaml` and `lcaResult`.
- Selected-node details are derived from `selectedNodeId` and the current nodes.
- Connection count is derived from `edges.length`.
- Whether result-dependent views are available is derived from `calculationStatus === "success" && lcaResult !== null`.

Do not keep a copied selected-node label, kind, or detail in separate state. Store only the selected node ID so the inspector cannot show stale node metadata.

## State Transitions

### 1. Edit YAML

When the textarea changes:

- Update `yamlDraft` only.
- Do not rebuild the graph.
- Do not change `appliedYaml`.
- Do not discard the current graph or its matching LCA result.
- Indicate that the draft differs from the applied YAML if the UI has an appropriate existing location for that message.

The existing graph and results continue to represent `appliedYaml`, not the uncommitted draft.

### 2. Preview Graph

When **Preview Graph** is selected:

1. Parse `yamlDraft` with `buildGraphFromYaml` in structure mode.
2. If parsing fails:
   - Set `yamlError`.
   - Keep `appliedYaml` unchanged.
   - Keep the existing graph unchanged.
   - Keep the existing LCA result unchanged because it still corresponds to the unchanged applied graph.
3. If parsing succeeds:
   - Set `appliedYaml` to `yamlDraft`.
   - Replace nodes, edges, and graph title with the newly parsed graph.
   - Reset graph mode to `structure`.
   - Clear the selected node.
   - Clear the YAML error.
   - Clear `lcaResult` and any calculation error.
   - Set calculation status to `idle`.
   - Switch to the Graph view.
   - Fit the rebuilt graph in the viewport.

These successful-preview updates should happen as one logical transition so the UI cannot briefly show a new graph with old results.

### 3. Run LCA

The calculation must use `appliedYaml`, never `yamlDraft`.

Before starting:

- Require a valid applied graph.
- If `yamlDraft !== appliedYaml`, disable Calculate or clearly require the user to preview the draft first. Disabling Calculate is preferred because it eliminates ambiguity about which YAML will be calculated.

On start:

- Set calculation status to `running`.
- Clear the previous calculation error.

On success:

- Store the returned `lcaResult`.
- Set calculation status to `success`.

On failure:

- Clear `lcaResult`.
- Store the error message.
- Set calculation status to `error`.

### 4. Result-Dependent Views

The following views require a successful result for the current applied YAML:

- Inventory
- Contribution
- Sankey Graph

Until `calculationStatus` is `success` and `lcaResult` exists, their tabs should be disabled or otherwise unavailable. The LCA Results tab remains available because it contains the Calculate action and can display idle, running, error, or success states.

After a successful Preview Graph transition, return these views to their unavailable state by clearing the result and resetting calculation status to `idle`.

## Async Calculation Safety

Protect against stale requests even if Calculate is normally disabled while a draft is unapplied.

If an LCA request is active and a different YAML document is successfully previewed:

- Abort the active request with `AbortController`, or
- Associate the request with the exact `appliedYaml` value/revision and ignore its response if the applied source has changed before it resolves.

An old request must never repopulate results after a different graph has been applied.

Passing an `AbortSignal` through `calculateLca` is the preferred approach, with a source/revision check retained as a defensive guard if practical.

## Graph Interaction Boundary

Allowed view-only interactions:

- Select a node
- Open or close node detail presentation
- Fold or restore connected nodes
- Search and visually fade nonmatching nodes
- Drag nodes for temporary positioning
- Auto-layout
- Fit graph
- Pan and zoom
- Switch between structure and scaled display modes

Disallowed product-model interactions:

- Add node
- Delete node
- Connect nodes
- Disconnect nodes
- Edit process or flow properties from the graph

Remove the Add Node and Connect Nodes controls and their handlers. Folding must continue to mean temporarily hiding connected nodes, not deleting product processes.

## Implementation Sequence

### Phase 1: Separate draft and applied YAML

- Rename the current editable YAML state to `yamlDraft`.
- Add `appliedYaml`, initialized from the bundled jacket YAML.
- Ensure Preview Graph parses the draft and commits it only after successful parsing.
- Ensure all graph construction and LCA calculation use `appliedYaml` after the commit.

### Phase 2: Make result invalidation explicit

- Introduce `calculationStatus`.
- On successful preview, clear the result and reset status to `idle`.
- Derive Markdown from `lcaResult` instead of storing `resultsMarkdown`.
- Remove `calculatedYaml`; the preview transition now guarantees result validity.
- Add stale-request protection.

### Phase 3: Gate dependent views

- Keep LCA Results accessible in every calculation state.
- Disable Inventory, Contribution, and Sankey unless a current result exists and status is `success`.
- Ensure these views read from the same `lcaResult` rather than maintaining their own copies.

### Phase 4: Enforce the read-only graph boundary

- Remove Add Node and Connect Nodes controls.
- Remove the `addNode` callback and any unused editing code.
- Keep view-only graph controls and interactions.
- Change selected-node state to store only an ID.

### Phase 5: Split components only where useful

After the behavior is correct, consider extracting:

- `YamlEditor`
- `GraphView`
- `LcaResultsView`
- `InventoryView`
- `ContributionView`
- `SankeyView`

Keep state in their nearest common parent. Do not introduce a global store merely because components have been extracted; reassess only if state coordination becomes difficult.

## Suggested Reducer Events

If a reducer is used, keep its events aligned with user/domain transitions:

```ts
type EditorAction =
  | { type: "yamlDraftChanged"; value: string }
  | { type: "yamlPreviewSucceeded"; value: string; graph: ParsedGraph }
  | { type: "yamlPreviewFailed"; error: string }
  | { type: "calculationStarted"; revision: number }
  | { type: "calculationSucceeded"; revision: number; result: LcaResult }
  | { type: "calculationFailed"; revision: number; error: string }
```

The revision identifies the applied YAML version and prevents a late result from being accepted for the wrong graph.

## Acceptance Criteria

- Editing the YAML textarea does not change the displayed graph before Preview Graph is selected.
- Previewing valid YAML updates the graph.
- Previewing invalid YAML shows an error and leaves the current graph unchanged.
- A successful preview clears all previous LCA data and returns calculation status to `idle`.
- Calculate always analyzes the YAML represented by the visible graph.
- Calculate cannot silently analyze an unpreviewed draft.
- A late response from an older calculation cannot populate results for a newly previewed graph.
- Inventory, Contribution, and Sankey are unavailable before a successful calculation.
- Inventory, Contribution, and Sankey become available after a successful calculation.
- Applying another valid YAML draft makes those views unavailable again.
- Result Markdown is derived from the current `lcaResult`.
- Graph actions cannot alter the YAML product definition.
- Refresh persistence is unchanged; no browser storage is introduced.
- No Zustand dependency is introduced.
- TypeScript and the production build pass.

## Testing Checklist

### YAML workflow

- Edit YAML without previewing and confirm the graph is unchanged.
- Preview valid YAML and confirm the graph and title update.
- Preview invalid YAML and confirm the old graph remains visible.
- Correct the YAML and confirm a later preview succeeds.

### LCA lifecycle

- Confirm the initial calculation state is `idle`.
- Run a calculation and confirm `running` then `success`.
- Preview different valid YAML and confirm results are cleared and status returns to `idle`.
- Cause an API failure and confirm status becomes `error` without exposing dependent views.
- Start a calculation, apply different YAML before it resolves, and confirm the old response is ignored.

### View gating

- Confirm Inventory, Contribution, and Sankey are unavailable with no result.
- Confirm all three become available after a successful result.
- Confirm all three become unavailable after a new successful preview.

### Graph boundary

- Confirm there are no add/connect/delete editing controls.
- Confirm selection, dragging, folding, search, layout, pan, and zoom still work.
- Confirm none of those actions change YAML or invalidate LCA results.

## Out of Scope

- Browser persistence
- Backend/database persistence
- Authentication or user accounts
- Multiple saved projects
- Collaborative editing
- Graph-based product-model editing
- Implementing the actual Inventory, Contribution, or Sankey visualizations beyond wiring their availability and shared result input
