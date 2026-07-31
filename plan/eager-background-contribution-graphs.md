# Eager Background Contribution Graphs

Status: Proposed

Date: July 27, 2026

Repositories:

- Engine: `../life-cycle-assessment-mcp`
- Webapp: `product-graph-editor`

## Goal

Make one explicit `run_lca` request return every bounded background contribution
graph needed by the result views. After Calculate finishes, expanding a process,
impact category, elementary flow, table row, or graph branch must be a local
browser operation. Result views must not mutate the YAML and must not call
`run_lca` again.

"Entire graph" means the complete occurrence graph produced by Brightway up to
the configured:

- impact cutoff;
- biosphere-flow cutoff;
- maximum depth;
- calculation or node limit; and
- flow-record limit.

It does not mean serializing the entire cyclic Brightway database. Any impact
excluded by these bounds must remain represented as an explicit unexpanded
score, count, and truncation reason.

## Recommendation

Proceed with eager background graph delivery. A single graph with about 1,000
process occurrences and 1,500 emission records is a reasonable REST response.
Keep both direct and cumulative scores returned by Brightway.

Do not, however, duplicate a 1,000-node topology blindly for every EF category.
The first implementation should use the existing per-category schema to prove
the one-request behavior and establish production benchmarks. If all nonzero
categories exceed the total runtime or payload budgets below, introduce a
schema-version-4 shared graph bundle: one union topology with per-category score
overlays and category membership.

The webapp must keep the complete bounded result in memory but render only the
currently expanded subset. Rendering 1,000 React Flow nodes or 1,500 table rows
at once is a frontend performance problem even though transferring and storing
that data is acceptable.

## Current Engine Behavior

The engine already implements most of the required calculation.

### Calculation lifecycle

[`lca_core/engine.py`](../../life-cycle-assessment-mcp/lca_core/engine.py):

- creates one temporary foreground database per `run_lca`;
- creates one `bw2calc.LCA`;
- calls `lci(factorize=True)` once;
- switches LCIA methods on the same LCA object;
- computes flat foreground `process_contributions` for every category;
- builds contribution graphs only for categories explicitly listed in
  `lcia.contribution_graph.categories`; and
- returns `contribution_graphs: []` when no categories were requested.

When a graph is requested, its `activity_contributions` replace that category's
foreground-only process rows, and its graph-level `unexpanded_score` replaces
the flat residual.

### Brightway traversal

[`lca_core/contribution_graph.py`](../../life-cycle-assessment-mcp/lca_core/contribution_graph.py)
uses `bw-graph-tools 0.9`:

```python
NewNodeEachVisitGraphTraversal(
    lca,
    GraphTraversalSettings(
        cutoff=...,
        biosphere_cutoff=...,
        max_calc=...,
        max_depth=...,
        separate_biosphere_flows=...,
    ),
)
```

The traversal is occurrence-aware. Repeated visits to the same activity receive
different occurrence IDs, which is required for shared suppliers and cycles.
The adapter already returns:

- process occurrence nodes;
- producer-to-consumer edges;
- supply amounts and units;
- foreground/background identity;
- direct score;
- cumulative score and percentage;
- per-node unexpanded score;
- terminal status;
- characterized elementary-flow records;
- graph coverage and total unexpanded score; and
- an activity-level aggregation of occurrence direct scores.

For each node, the engine verifies the intended relationship:

```text
direct score
+ child cumulative scores
+ unexpanded score
= node cumulative score
```

The browser must never sum cumulative scores across arbitrary nodes because a
parent cumulative score already includes its descendants.

### Current shallow `sankey`

[`_build_sankey`](../../life-cycle-assessment-mcp/lca_core/engine.py) is not a
recursive Brightway graph. It is built from the submitted YAML and includes:

- all foreground processes;
- only the background activities referenced directly by foreground inputs;
- foreground emissions and resources; and
- the final product.

It does not traverse from polypropylene to grid electricity or deeper into
BAFU. The field is therefore better understood as a calculated foreground flow
graph, not the source of truth for recursive background contribution views.

### Current REST input

`run_lca` and `POST /api/lca/run` currently accept only `product_graph`.
Contribution traversal options live inside the YAML. This makes the graph an
opt-in product-graph setting rather than an explicit result-delivery option.

## Current Webapp Behavior

The webapp already understands the version-3 contribution graph fields, but it
does not consistently treat the original result as the source of truth.

### Unwanted second calculation

[`ImpactAnalysisView`](../src/App.tsx) currently:

1. notices that a selected category is absent from `result.contribution_graphs`;
2. parses the applied YAML;
3. injects `lcia.contribution_graph.categories`;
4. calls `calculateLca()` again; and
5. keeps the second graph in component-local `loadedGraphs`.

This is a complete second `run_lca`, not a lightweight child fetch.

### Existing local consumers

When contribution graphs are present, the webapp already uses them locally for:

- inventory flow children;
- total requirement trees;
- Impact Analysis graph nodes and edges;
- contribution trees;
- elementary-flow rows; and
- direct/cumulative result display.

The Impact Sankey and Process Results views still rely primarily on the shallow
`sankey` plus `process_contributions`. That works for foreground-only cases but
assigns zero direct impact to background Sankey nodes when the category remains
in `residual_score`.

### Rendering issue

The Impact Analysis graph currently converts every returned contribution node
to a React Flow node and runs Dagre over the full set. A 1,000-node response
should not be rendered this way. The full result should stay in memory while a
collapsed visible-subgraph selector supplies tens of nodes to React Flow.

## Measured Feasibility

Measurements were taken locally against the current engine, Brightway data, and
BAFU Plastic Broom climate-change graph. Sizes are compact JSON. "Core response"
includes LCIA, LCI, process contributions, graph data, and shallow Sankey, but
does not include the two REST SVG strings.

| Impact cutoff | Coverage | Nodes | Edges | Flows | Time | Graph raw | Graph gzip | Core raw | Core gzip |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1% | 64.8% | 42 | 41 | 22 | 4.1 s | 65 KB | 8.9 KB | 148 KB | 25 KB |
| 0.5% | 71.2% | 85 | 84 | 39 | 5.0 s | 131 KB | 17.9 KB | 221 KB | 36 KB |
| 0.1% | 81.0% | 249 | 248 | 99 | 6.4 s | 369 KB | 47.5 KB | 482 KB | 70 KB |
| 0.05% | 84.1% | 439 | 438 | 160 | 7.7 s | 637 KB | 80.5 KB | 773 KB | 106 KB |
| 0.01% | 86.8% | 1,003 | 1,002 | 457 | 8.7 s | 1.45 MB | 177 KB | 1.62 MB | 209 KB |

The 0.01% run used a 0.001% biosphere cutoff and stopped at the configured
1,000-calculation limit. The other runs used a 0.01% biosphere cutoff.

The Simple Mock Plastic Broom climate graph was:

- 5 nodes;
- 4 edges;
- 3 flows;
- 7.6 KB raw; and
- 1.3 KB gzipped.

### Estimate for 1,500 emissions

In the measured large graph, 457 serialized flow records occupied about 188 KB,
or roughly 410 bytes per record before compression. At the same shape:

```text
1,500 flows × approximately 410 bytes
= approximately 615 KB raw JSON
```

Adding 1,500 flow records to a 1,000-node graph should normally keep one
category below roughly 2–2.5 MB raw and a few hundred KB compressed. This is
acceptable for one Calculate response.

The current server does not appear to return gzip encoding even when the client
advertises gzip. Compression must be enabled and verified before eager large
graphs are deployed.

### What can become too large

One 1,000-node graph is not too large. The dangerous cases are:

- duplicating the topology for 20–25 impact categories;
- performing up to 1,000 traversal calculations for each category;
- returning hundreds of thousands of flow occurrences across all categories;
- laying out all nodes at once; and
- mounting all emission rows in the DOM at once.

For example, 25 copies of the measured largest graph would be about 36 MB raw
and 4.4 MB gzipped before SVGs. More importantly, the engine could spend several
minutes traversing all categories. Payload and traversal budgets must apply to
the complete response, not just each category independently.

## Target Behavior

### One calculation

The Calculate action sends one request. The engine:

1. validates the product graph and result options;
2. runs one LCI factorization;
3. calculates all LCIA totals;
4. detects whether the solved model contains background providers;
5. skips recursive traversal for foreground-only models;
6. generates bounded graphs for the requested background impact categories;
7. returns all graph data in the original response; and
8. deletes the temporary foreground database.

After the response arrives, no result component may invoke `calculateLca`.

### Explicit result options

Graph delivery is a presentation/result-shaping concern and should not require
the webapp to invisibly modify the product YAML. Extend the REST and Python
interfaces with optional result options:

```json
{
  "product_graph": "...",
  "result_options": {
    "background_graphs": {
      "mode": "all_nonzero",
      "categories": [],
      "cutoff": 0.001,
      "biosphere_cutoff": 0.0001,
      "max_depth": 12,
      "max_calculations_per_category": 1000,
      "max_total_calculations": 5000,
      "max_nodes_per_category": 1250,
      "max_flows_per_category": 5000,
      "include_flows": true
    }
  }
}
```

Supported modes should be:

- `none`: return no recursive background graphs;
- `explicit`: use the supplied category names;
- `all_nonzero`: traverse categories whose absolute total exceeds numerical
  tolerance; and
- `yaml`: retain the existing `lcia.contribution_graph` behavior for backward
  compatibility.

The webapp should use `all_nonzero` only after the benchmark gate below passes.
Bundled demonstrations can initially use `explicit` categories such as climate
change and acidification.

### Bounded completeness

Every category result must say whether it is complete relative to its configured
bounds:

```json
{
  "status": "complete | partial | zero_total | budget_exhausted",
  "truncation_reasons": [
    "impact_cutoff",
    "biosphere_cutoff",
    "max_depth",
    "max_calculations",
    "max_nodes",
    "max_flows",
    "total_request_budget"
  ],
  "coverage": 0.86,
  "unexpanded_score": 0.2256,
  "omitted_flow_count": 0,
  "omitted_flow_score": 0
}
```

Cutoff terminal nodes and aggregate omitted-flow rows must be included in the
original response. A user can expand everything the engine returned and see
what was intentionally omitted without making another request.

## Response Contract Strategy

### Phase A: use the existing version-3 graph shape

First prove the behavior using the current `contribution_graphs[]` objects.
They already contain sufficient information, and this minimizes engine risk.

Required additions:

- accept result options outside the YAML;
- support `all_nonzero`;
- report truncation reasons and omitted-flow counts;
- add total-request budgets;
- enable HTTP compression; and
- stop the webapp from requesting graphs after calculation.

### Phase B: shared topology if benchmarks require it

An impact cutoff is category-specific. Climate change, acidification, and water
use can visit different node sets, so one category's graph cannot simply be
reused as another category's complete cutoff graph.

If per-category duplication exceeds the budgets, introduce result schema 4 with
a union graph:

```json
{
  "background_graph_bundle": {
    "categories": [
      {
        "id": "climate",
        "label": "climate change | ...",
        "unit": "kg CO2-Eq",
        "total_score": 1.71
      }
    ],
    "nodes": [
      {
        "id": "occurrence:path-stable-id",
        "activity_id": "background-process:...",
        "process_name": "...",
        "supply_amount": 0.52,
        "unit": "kilogram",
        "category_scores": {
          "climate": {
            "included": true,
            "direct": 0.12,
            "cumulative": 0.89,
            "unexpanded": 0.01,
            "terminal": false
          }
        }
      }
    ],
    "edges": [],
    "flows": []
  }
}
```

This design requires category-independent occurrence IDs based on the producer
path, not the current traversal-local ID plus category label. Each category
still needs its own Brightway scoring/traversal semantics, but repeated
metadata, topology, and physical flow quantities are transferred once.

Flow records should also be merged by occurrence plus biosphere-flow identity,
with per-category characterized scores.

Do not implement the shared bundle until the simpler eager version is measured
with real multi-category BAFU cases.

## Engine Work

### 1. Separate calculation input from result options

Update:

- `lca_core/api.py`;
- `lca_core/engine.py`;
- `lca_server.py`; and
- REST/MCP schemas.

Preserve existing YAML graph configuration as an override or `yaml` mode.
Never make the engine's numerical result depend on an undocumented frontend
YAML mutation.

### 2. Detect background work

Use the resolved `background_providers` from `_build_foreground_db`. If it is
empty, do not run `NewNodeEachVisitGraphTraversal` automatically.

If background providers exist, resolve explicit or all-nonzero categories after
LCIA totals are known.

### 3. Reuse the existing LCA

Keep traversal inside the existing LCIA loop and temporary foreground context.
Continue to use one root `bc.LCA` and one `lci(factorize=True)`.

Do not create a second top-level LCA for a graph. Preserve the existing test
that patches `bc.LCA` and expects one construction.

### 4. Add total request budgets

The existing `max_calculations` is per graph and is not exactly a node cap. A
measured 1,001 calculation traversal returned 1,003 nodes.

Add and report:

- per-category calculation limit;
- total calculations across all categories;
- per-category node limit;
- per-category flow limit;
- total serialized graph estimate or record limit; and
- elapsed graph-generation time per category.

Do not fail the whole LCA when a graph budget is exhausted. Return LCIA totals
plus a partial graph and explicit residual.

### 5. Preserve both score forms

Return both:

- direct score, which is additive across exclusive occurrences; and
- Brightway cumulative score, which is authoritative for one occurrence's
  upstream supply chain.

The extra numeric fields are negligible compared with node identity and edge
metadata. They also provide a reconciliation check for every client.

### 6. Handle large emission lists

`include_flows: true` currently serializes the Brightway flows that pass
`biosphere_cutoff`. Direct node scores still include characterized flows that
are not individually emitted.

For up to 1,500 returned flow records, return them in the original response.
Set the initial hard safety limit above this expected case, for example 5,000
flows per category.

If the safety limit is reached:

- retain the node's full direct score;
- retain the count and signed score of omitted flows;
- add an in-memory-displayable "Other emissions below record limit" row; and
- never require a server call to explain the difference.

### 7. Enable transport compression

Add and verify gzip or Brotli for REST JSON responses. The current deployment
did not return `Content-Encoding` when gzip was advertised.

Compression may be added at Traefik or application middleware, but tests must
confirm that MCP streaming routes are not buffered or broken.

## Webapp Work

### 1. Make Calculate request all intended result data

Extend `calculateLca` to send explicit result options. Capture those options
with the applied YAML so the result remains tied to the exact calculation
request.

### 2. Remove all view-triggered calculations

Delete:

- `loadedGraphs`;
- `loadingCategories`;
- `categoryErrors` related to child calculation;
- `loadCategory`;
- YAML mutation inside `ImpactAnalysisView`; and
- every `calculateLca` invocation outside the main Calculate handler.

If a category graph is partial or unavailable, show its residual/budget state.
Do not offer "Load process children" as a server action.

### 3. Build one client graph index

On result receipt, create memoized indexes:

- node by occurrence ID;
- children by consumer occurrence ID;
- parent edge by producer occurrence ID;
- flows by process occurrence ID;
- occurrences by stable activity ID; and
- graph by impact-category ID.

All tables and graphs should consume these indexes rather than independently
rebuilding maps on each render.

### 4. Render only expanded graph nodes

Keep all returned nodes in memory, but derive `visibleNodeIds` from:

- the functional-unit root;
- expanded occurrence IDs;
- contribution threshold;
- maximum visible depth; and
- an optional visible-node ceiling.

Run Dagre and React Flow only on the visible subgraph. Expanding a node updates
`visibleNodeIds` locally.

For a 1,000-node graph, the initial canvas should normally contain fewer than
50 nodes.

### 5. Virtualize large tables

Contribution and emissions tables must:

- create rows only for expanded branches;
- use windowing/virtualization when visible rows exceed an agreed threshold;
- preserve keyboard navigation and accessible row labels; and
- support client-side filtering and sorting.

An array of 1,500 emissions is acceptable in memory. Mounting 1,500 complex
rows at once is unnecessary.

### 6. Use recursive graphs for background impact views

When a selected category has a contribution graph:

- Impact Analysis graph uses occurrence nodes and edges;
- Contribution Analysis uses direct/cumulative/unexpanded values;
- Process Results aggregate occurrence direct scores by activity or selected
  subtree;
- Impact Sankey uses the same bounded occurrence graph; and
- Inventory flow children use the returned flow records.

For foreground-only models, retain the lightweight
`process_contributions + sankey` behavior.

Rename the UI view from "Sankey" to "Supply Chain" or "Flow Diagram" separately
from this data-contract change. API field renaming is not required for this
plan.

## Performance Gates

Before enabling `all_nonzero` by default, measure at least:

- Simple Mock Plastic Broom;
- BAFU Plastic Broom;
- BAFU Cotton;
- BAFU Polyester T-shirt; and
- BAFU Wool Yarn.

For each, record:

- LCIA-only time;
- added graph time per category;
- total Calculate time;
- node, edge, flow, and distinct-activity counts;
- raw and compressed response size;
- JSON parse time;
- graph-index construction time;
- initial visible-node layout time;
- expand/collapse interaction time; and
- peak browser memory.

Initial release targets:

| Metric | Target | Hard review threshold |
|---|---:|---:|
| One category graph, compressed | ≤ 500 KB | 1 MB |
| Complete Calculate response, compressed | ≤ 1 MB | 5 MB |
| One category process occurrences | ≤ 1,250 | 2,500 |
| One category flow records | ≤ 5,000 | 10,000 |
| Initial React Flow nodes | ≤ 50 | 100 |
| Expand/collapse response | ≤ 100 ms | 250 ms |
| Added graph calculation time | ≤ 10 s/category | 20 s/category |

These are product targets, not correctness cutoffs. A response that exceeds a
budget should remain numerically correct and explicitly partial.

Do not enable all-category eager traversal if it causes normal Calculate
requests to approach the deployment timeout. In that case, either:

1. use explicit high-value categories for schema 3 while implementing the
   shared bundle; or
2. optimize multi-category traversal before changing the default.

Do not restore view-triggered full recalculation as the fallback.

## Testing

### Engine correctness

- Background-free models skip recursive traversal.
- Background-linked models return the requested bounded graphs in the original
  result.
- One root `bc.LCA` is constructed.
- Direct visited scores plus graph residual reconcile to each LCIA total.
- Every node satisfies direct + children + unexpanded = cumulative.
- Repeated activities retain distinct occurrence IDs.
- Negative scores and avoided burdens retain signs.
- Zero-total categories return `zero_total`.
- All edge and flow occurrence references resolve.
- Flow truncation preserves full node direct scores and reports omitted count
  and score.
- Calculation, node, depth, flow, and total-request budgets are enforced and
  reported.
- Temporary foreground databases are deleted after success and failure.

### API and transport

- REST, MCP, and Python interfaces expose the same result options.
- Old YAML configuration remains supported.
- Schema discovery describes every new field.
- Large JSON contains only finite numbers.
- REST JSON is compressed when accepted.
- MCP streaming remains functional with compression configuration.

### Webapp

- Exactly one `POST /api/lca/run` occurs per Calculate action.
- Opening every result tab, category, process, and flow causes zero additional
  LCA requests.
- Foreground-only contribution trees remain correct.
- Background direct, cumulative, and residual values match the engine.
- A 1,000-node fixture initially renders a bounded visible subset.
- Expanding all branches uses only in-memory data.
- A 1,500-flow fixture remains responsive and accessible.
- Stale calculation results cannot populate a newer applied YAML revision.

### End-to-end

For Simple Mock Plastic Broom:

- the original response includes assembly, polypropylene, direct-only freight,
  and grid electricity;
- grid electricity occurs exactly once;
- all graph and table expansion is local; and
- climate direct scores plus residual reconcile to the total.

For the larger Mock Plastic Broom:

- repeated grid electricity occurrences remain distinct;
- activity aggregation reports the correct occurrence count; and
- no view expansion starts a calculation.

For BAFU Plastic Broom:

- cutoff and budget status are visible;
- the response remains within the agreed compressed-size budget; and
- the UI does not attempt to display all returned nodes simultaneously.

## Implementation Sequence

1. Add benchmark scripts and lock the current size/runtime baseline.
2. Add explicit result options and background detection to the engine.
3. Add eager `explicit` and `all_nonzero` modes using the existing schema.
4. Add truncation reasons, total budgets, and flow-limit accounting.
5. Enable and verify REST compression.
6. Extend the webapp API types and Calculate request.
7. Remove all result-view `calculateLca` calls and local second-result caches.
8. Add memoized contribution graph indexes.
9. Convert Impact, Contribution, Process Results, Inventory children, and Impact
   Sankey to the returned graph data.
10. Add collapsed-subgraph rendering and virtualized large tables.
11. Run the multi-case performance gate.
12. If all-category duplication fails the gate, implement the shared
    schema-version-4 bundle before making `all_nonzero` the default.
13. Update REST, MCP, and frontend documentation.
14. Deploy engine first, then the compatible webapp.

## Acceptance Criteria

The plan is complete when:

1. One Calculate action is the only LCA request.
2. Background-linked calculations return all configured bounded occurrence
   graphs in that response.
3. Every graph/table branch represented by the response expands locally.
4. Direct, cumulative, residual, cutoff, and truncation semantics are explicit.
5. A graph near 1,000 nodes and a flow list near 1,500 records transfer within
   the agreed compressed-size budget.
6. The browser stores the complete bounded graph but renders only the visible
   subset.
7. Foreground-only calculations avoid unnecessary recursive traversal.
8. Multi-category behavior passes the total runtime and payload gates, or the
   shared topology bundle is implemented before enabling it by default.
9. No result view mutates YAML or invokes `calculateLca`.
10. Engine and webapp tests enforce the one-request workflow.
