# AI Chat Tool Roadmap

## Purpose

Define a useful, safe set of Product Graph Editor tools that can be exposed to the embedded LLM over time. This roadmap is intentionally broader than the current implementation; documenting a tool here does not make it available to the model.

The current assistant remains limited to view discovery and navigation. Later tools should be added in small, independently tested phases.

## Design Rules

Every tool must:

- have one clear purpose and a stable, verb-based name
- use a strict JSON Schema with `additionalProperties: false`
- validate identifiers and enum values again at runtime
- expose only the minimum data needed for the workflow
- call the same named application action used by human controls
- respect result availability, unsaved-work guards, and stale-revision checks
- return a structured result with a stable status and error code
- record tool name, source, outcome, and timestamp in an audit history
- avoid returning complete YAML, graph, inventory, or result payloads by default

Suggested risk classes:

| Risk | Meaning | Default policy |
| --- | --- | --- |
| `read` | Returns a bounded state projection | Execute immediately |
| `ui` | Changes selection, view, filter, or presentation | Execute immediately and visibly |
| `mutation` | Changes model data or starts meaningful work | Require confirmation |
| `external` | Uploads, downloads, exports, or calls an external workflow | Require confirmation |
| `destructive` | Deletes or replaces recoverable user work | Require explicit confirmation |

## Phase 1 — View Navigation

**Status:** current implementation.

### `list_views`

Returns all model-accessible views with labels, descriptions, availability, and unavailable reasons.

Risk: `read`

### `get_active_view`

Returns the currently active application view.

Risk: `read`

### `switch_view`

Requests navigation through the application's guarded view-change path.

Input:

```json
{ "view": "graph | yaml | results | inventory | impact | process | contribution | sankey" }
```

Risk: `ui`

Important behavior:

- Reject unavailable analysis views when there are no current results.
- Preserve the unsaved-YAML confirmation flow.
- Never assign `activeView` directly.

## Phase 2 — Workspace and Status Queries

These tools help the assistant answer common questions without exposing model contents.

### `get_workspace_status`

Returns:

- current model title and document kind
- whether the YAML draft is dirty
- whether the draft is valid
- applied and calculated revision relationship
- calculation status and a bounded error summary
- whether current results exist

Risk: `read`

### `get_calculation_status`

Returns calculation state, current-result availability, and whether contribution graphs are still loading.

Risk: `read`

### `list_session_models`

Returns session model IDs, titles, filenames, active status, and dirty-state implications. It must not return YAML contents.

Risk: `read`

### `list_model_templates`

Returns available template IDs, names, and brief descriptions.

Risk: `read`

## Phase 3 — Graph Exploration

These tools let the assistant help users understand the graph without editing it.

### `get_graph_summary`

Returns bounded graph metadata:

- node and connection counts
- foreground/background counts
- graph mode, orientation, and connection style
- selected-node ID and label, if any
- whether scaled results are available

Risk: `read`

### `find_graph_nodes`

Input:

```json
{ "query": "string", "limit": 10 }
```

Returns a bounded list of matching IDs, labels, kinds, scopes, and short descriptions.

Risk: `read`

### `get_graph_node_summary`

Input:

```json
{ "nodeId": "string" }
```

Returns a bounded node summary and counts of connected inputs, outputs, emissions, and resource extractions. Detailed exchange values should require a separate, deliberate query.

Risk: `read`

### `select_graph_node`

Selects a validated node and opens the existing inspector.

Risk: `ui`

### `clear_graph_selection`

Clears the current node selection.

Risk: `ui`

### `set_graph_display`

Input may include only registered display settings:

```json
{
  "mode": "structure | scaled",
  "orientation": "horizontal | vertical",
  "connections": "curved | straight | step",
  "showReferenceAmounts": true,
  "maximumProcesses": 20
}
```

Validate result requirements for scaled mode and clamp process limits through existing actions.

Risk: `ui`

### `fit_graph_view`

Requests the same React Flow fit action available in the graph toolbar.

Risk: `ui`

## Phase 4 — Result Discovery and Analysis

These tools should return summaries or bounded ranked rows rather than full result payloads.

### `list_impact_categories`

Returns available impact-category IDs, display names, units, and current selection.

Risk: `read`

### `get_lca_summary`

Returns a bounded summary of the current calculation: method, functional unit, total scores by requested category, and result revision.

Input should allow category filtering and a strict result limit.

Risk: `read`

### `get_inventory_summary`

Returns bounded top inputs or outputs by absolute amount with names, types, units, and totals.

Input:

```json
{ "direction": "input | output", "limit": 10 }
```

Risk: `read`

### `get_process_results_summary`

Returns a bounded summary for one validated process ID, optionally filtered to inventory flows or impact categories.

Risk: `read`

### `get_top_contributors`

Input:

```json
{
  "impactCategory": "string",
  "scope": "all | foreground | background",
  "limit": 10
}
```

Returns ranked contributors with amount, unit, percent of total, and expansion status.

Risk: `read`

### `select_impact_category`

Updates the registered result-category selection through the same action as the human control.

Risk: `ui`

### `select_result_process`

Selects a validated process in Process Results or Contributions.

Risk: `ui`

### `select_inventory_flow`

Selects a validated inventory flow for contribution analysis.

Risk: `ui`

### `set_sankey_display`

Changes registered Sankey presentation settings such as impact category, orientation, connection style, contribution threshold, and maximum processes.

Risk: `ui`

## Phase 5 — Calculation and Safe Workspace Actions

These operations affect application state or initiate meaningful work and require confirmation.

### `calculate_current_model`

Validates that the applied source can be calculated, presents a confirmation summary, and invokes the existing calculation workflow.

Risk: `mutation`

Required protections:

- identify whether the draft differs from the applied source
- specify which saved/applied revision will be calculated
- prevent duplicate calculation starts
- ignore stale responses using the existing revision checks

### `save_current_model`

Saves an existing writable session model through the current Save action.

Risk: `mutation`

### `save_model_as`

Input:

```json
{ "name": "string" }
```

Opens or drives the existing Save As workflow after validating title length and uniqueness.

Risk: `mutation`

### `open_model`

Input identifies a registered template or session document. It must use the existing dirty-work guard.

Risk: `mutation`

### `new_model`

Requests the existing New workflow and preserves dirty-work confirmation.

Risk: `mutation`

## Phase 6 — Carefully Scoped YAML Assistance

Do not begin this phase until read-only and navigation tools are stable. Avoid a generic `set_state` or unrestricted `replace_yaml` tool.

### `validate_yaml_draft`

Returns structured validation errors for the current draft without returning the complete source.

Risk: `read`

### `get_yaml_outline`

Returns a bounded structural outline: product graph name, process IDs and labels, referenced activities, and validation status. It must not return the full document.

Risk: `read`

### `propose_yaml_patch`

Input contains a narrowly scoped semantic operation rather than arbitrary application state. The tool returns a preview/diff and a confirmation ID; it does not apply immediately.

Potential operations:

- update a named amount or unit
- add or remove a validated exchange
- rename a foreground process
- update the functional unit

Risk: `mutation`

### `apply_yaml_patch`

Applies only a previously generated, still-current proposal after explicit confirmation and revision matching.

Risk: `mutation`

Required protections:

- show a human-readable summary and exact diff
- validate the resulting YAML before applying
- reject stale proposals if the draft changed
- retain undo/recovery information
- never accept arbitrary JavaScript, JSON Patch paths, or raw Zustand mutations

## Phase 7 — Export and Destructive Operations

### `download_yaml`

Requests the current Download behavior with a user-visible filename.

Risk: `external`

### `export_results`

Exports a clearly identified result format and subset. The tool must not silently upload data.

Risk: `external`

### `delete_session_model`

Deletes one validated session model only after explicit confirmation naming the model and explaining recovery behavior.

Risk: `destructive`

## Tools That Should Not Exist

Do not expose:

- `set_state`
- `set_zustand_state`
- `execute_javascript`
- `run_code`
- unrestricted `fetch_url`
- unrestricted filesystem or shell access
- unrestricted `replace_yaml`
- tools returning the complete Zustand store
- tools returning all graph, YAML, inventory, contribution, or LCA data automatically
- confirmation-bypass flags such as `force`, `skipConfirmation`, or `unsafe`

These tools are too broad to validate reliably and would create a second mutation path outside normal application rules.

## Recommended Delivery Order

1. View navigation — current milestone
2. Workspace status and calculation status
3. Graph summary, search, and selection
4. Bounded result summaries and result selections
5. Confirmed calculation and save workflows
6. Proposed and reviewed semantic YAML patches
7. Export and destructive operations

Each phase should include fixture-based tool tests, mocked chat integration tests, responsive browser workflows, argument-validation tests, unavailable-state tests, and confirmation/revision tests before the next phase begins.

## Tool Result Contract

Use a consistent envelope:

```ts
type ToolResult<T> =
  | { status: "completed"; data: T }
  | { status: "unavailable"; code: string; reason: string }
  | { status: "confirmation_required"; confirmationId: string; summary: string; baseRevision: number }
  | { status: "rejected"; reason: string }
  | { status: "error"; code: string; message: string }
```

Stable codes let the chat controller and tests respond correctly without parsing human-readable messages.

## Definition of Done for Any New Tool

A tool is ready only when its schema, runtime validation, availability rules, risk policy, bounded output, named-action path, audit record, fixture coverage, responsive workflow, and user-facing error behavior are all documented and tested.
