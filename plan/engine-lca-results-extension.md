# Engine Plan: Extend LCA Results for Contribution and Sankey Views

## Task for the Engine LLM

Extend the LCA engine's `run_lca` operation and REST response so the product graph frontend can render:

1. A process contribution tree for every returned LCIA impact category.
2. A scaled Sankey graph of product, resource, and emission flows.

Implement this in the engine repository. Inspect the existing engine structure, product-graph schema, calculation code, tests, and deployment conventions before editing; do not assume filenames or deployment commands from this document.

The change must be backward-compatible with current clients of:

```http
POST /api/lca/run
Content-Type: application/json
```

## Existing Contract

The request currently contains a YAML document encoded as a JSON string:

```json
{
  "product_graph": "name: Example\nfunctional_unit:\n  amount: 1.0\n..."
}
```

The live operation currently returns these fields:

```ts
type CurrentLcaResult = {
  name: string
  method: string
  functional_unit: string
  lci: Record<string, {
    amount: number
    unit: string
    type: string
  }>
  lcia: Record<string, {
    score: number
    unit: string
  }>
  scaling_vector: Record<string, number>
  svg_scaled: string
  svg_structure: string
}
```

Preserve every existing field and its existing meaning. Add new fields; do not rename or remove old fields.

## Required New Response Fields

Add a result schema version plus `process_contributions` and `sankey`:

```ts
type ExtendedLcaResult = CurrentLcaResult & {
  result_schema_version: 2
  process_contributions: {
    categories: ProcessContributionCategory[]
  }
  sankey: {
    nodes: SankeyNode[]
    links: SankeyLink[]
    available_units: string[]
  }
}
```

Use JSON arrays where display order is useful and objects where lookup by an existing unique key is the primary operation.

## Process Contribution Contract

Return one contribution record for each entry already present in `lcia`:

```ts
type ProcessContributionCategory = {
  // Stable identifier for programmatic selection.
  id: string

  // Must match the corresponding key currently returned in lcia.
  label: string

  // Must match lcia[label].unit.
  unit: string

  // Must match lcia[label].score within documented numerical tolerance.
  total_score: number

  processes: ProcessContribution[]

  // Contribution not represented by the returned process rows.
  // This should normally be zero, but it makes omissions explicit.
  residual_score: number
}

type ProcessContribution = {
  // Same process identity used by sankey nodes and links.
  process_id: string

  // Exact process name from the product graph or exact activity name for a
  // separately identified background process.
  process_name: string

  // Exclusive characterized impact assigned to this process column.
  direct_score: number

  // direct_score / total_score * 100. Null when total_score is effectively zero.
  percentage: number | null
}
```

### Required contribution semantics

- `direct_score` must be exclusive to one process. Direct process scores plus `residual_score` must reproduce `total_score` within floating-point tolerance.
- Preserve negative values. Credits and avoided burdens must not be clamped to zero.
- Percentages may therefore be negative or greater than 100. Do not clamp percentages.
- If `abs(total_score)` is below the engine's numerical tolerance, return `percentage: null` rather than dividing by an unstable value.
- Do not return only the largest contributors unless all omitted scores are included in `residual_score`.
- Prefer returning all product-graph foreground processes, including processes with a zero score, so the frontend can maintain a stable contribution tree across categories.
- Sort processes in deterministic product-graph order. Do not sort them differently for every impact category; the frontend can perform ranking.
- Do not label an exclusive direct score as cumulative or upstream impact.

### Direct versus cumulative impact

This first version must return direct, non-overlapping process contributions. Do not add a `cumulative_score` unless the engine can define and test its behavior for a directed acyclic graph with shared upstream suppliers.

Naively summing a process and all reachable upstream processes double-counts a shared supplier when the graph branches and rejoins. The frontend can build the visual hierarchy from the process graph while using exclusive direct scores for percentages and totals.

### Brightway calculation guidance

Use the characterized inventory matrix for the active impact category. Brightway documents this matrix as biosphere flows in rows and processes in columns. Summing each process column yields the direct characterized impact assigned to that process.

The exact mapping APIs vary by Brightway version. Inspect the installed Brightway 2.5 version and the engine's existing mappings instead of copying an outdated attribute name. Map every returned column to a stable process identity.

Brightway's `ContributionAnalysis.annotated_top_processes` can be used as a reference for semantics, but do not use a top-N/cutoff API if it would silently omit contributions needed for reconciliation.

For each category, verify the invariant:

```text
sum(process.direct_score) + residual_score ~= lcia[category].score
```

The tolerance should use both an absolute and relative component to work for categories with scores near zero and categories with large scores.

### Foreground and background processes

Inspect how the engine constructs its Brightway foreground database and whether a product graph can reference background activities.

- If all characterized inventory columns map to named YAML processes, return one row per YAML process and a near-zero residual.
- If background activity columns are included and the UI should expose them, return them with stable IDs that cannot collide with foreground IDs and document their scope.
- If background columns are intentionally aggregated or hidden, include their combined score in `residual_score`; never silently discard them.

If useful, add an optional field without changing the required contract:

```ts
scope?: "foreground" | "background"
```

## Process Identity

Contributions and Sankey data must use the same process identifiers.

Preferred identity order:

1. Use an explicit stable process ID if the product-graph schema already defines one.
2. Otherwise, validate that process names are unique and use a deterministic ID derived without depending on array index.

Do not use an array index alone as persistent identity. Include the exact process name separately for display and debugging.

If the current YAML schema permits duplicate process names, either add validation that rejects duplicates or define an unambiguous identity scheme before implementing these response fields.

## Sankey Contract

Return a scaled, renderer-neutral graph. Do not make the frontend parse the returned SVG to recover nodes or values.

```ts
type SankeyNode = {
  id: string
  label: string
  kind: "process" | "resource" | "emission" | "final_product"

  // Present for process nodes.
  process_name?: string

  // Present for resource, emission, and final-product nodes when applicable.
  flow_name?: string
}

type SankeyLink = {
  id: string
  source: string
  target: string
  kind: "technosphere" | "extraction" | "emission" | "final_product"
  flow_name: string
  amount: number
  unit: string
}
```

### Sankey link semantics

Return quantities already scaled to the functional unit:

- A technosphere link goes from the supplying process to the consuming process.
- Its amount is the consumer's input amount multiplied by the consumer's solved scaling factor, expressed in the product flow's unit.
- An extraction link goes from a resource node to the consuming process.
- Its amount is the direct extraction amount multiplied by that process's solved scaling factor.
- An emission link goes from the emitting process to an emission node.
- Its amount is the direct emission amount multiplied by that process's solved scaling factor.
- A final-product link goes from the reference process to a final-product node and represents the functional-unit output.

All link amounts should use the same solved scaling state as `scaling_vector`. Do not recalculate a second independent scaling solution for the Sankey payload.

### Units and Sankey rendering

Sankey width comparisons are meaningful only among compatible units. Return the original unit on every link and include:

```ts
available_units: string[]
```

The frontend will filter or group links by unit. Do not convert counts such as `unit` into mass, and do not combine incompatible quantities into a single unitless width.

If the engine already has a unit normalization system, return normalized amounts only when the normalized unit is also returned and the conversion is tested.

### Sankey completeness

- Include deterministic IDs for every node and link.
- Every link's `source` and `target` must reference a returned node.
- Include zero-value links only if they are needed to preserve graph structure; otherwise omit them consistently.
- Reject or explicitly handle non-finite values. JSON output must never contain `NaN` or infinity.
- Preserve the direction and exact flow name from the product graph.
- Do not infer process topology from names.

## Example Response Fragment

This is illustrative; values must come from the calculation:

```json
{
  "result_schema_version": 2,
  "process_contributions": {
    "categories": [
      {
        "id": "traci-v2-1-gwp100",
        "label": "climate change | global warming potential (GWP100)",
        "unit": "kg CO2-Eq",
        "total_score": 4.878600277830665,
        "residual_score": 0,
        "processes": [
          {
            "process_id": "process:p0-raw-material-extraction",
            "process_name": "P0 — Raw material extraction",
            "direct_score": 1.8216,
            "percentage": 37.337
          }
        ]
      }
    ]
  },
  "sankey": {
    "available_units": ["kg", "unit"],
    "nodes": [
      {
        "id": "process:p0-raw-material-extraction",
        "label": "P0 — Raw material extraction",
        "kind": "process",
        "process_name": "P0 — Raw material extraction"
      },
      {
        "id": "process:p1-spinning",
        "label": "P1 — Spinning",
        "kind": "process",
        "process_name": "P1 — Spinning"
      }
    ],
    "links": [
      {
        "id": "technosphere:raw-fiber:p0:p1",
        "source": "process:p0-raw-material-extraction",
        "target": "process:p1-spinning",
        "kind": "technosphere",
        "flow_name": "Raw fiber material",
        "amount": 0.792,
        "unit": "kg"
      }
    ]
  }
}
```

Do not treat the rounded illustrative values or IDs above as test fixtures. Generate them from the engine and compare with an explicit tolerance.

## API and Schema Work

Update all engine surfaces that describe or expose `run_lca`:

- Internal typed result models
- `POST /api/lca/run`
- The MCP-equivalent `run_lca` tool, if it shares the result model
- `GET /api/tools` output schema
- REST/API documentation and examples
- Any generated OpenAPI schema

The current live `GET /api/tools` output schema is only a generic object with additional properties. Replace or extend it with an accurate nested schema for the full result when supported by the engine's schema system.

Keep request compatibility. The existing request containing only `product_graph` must continue to work and should receive the extended response.

## Implementation Sequence

### Phase 1: Inspect and map

- Locate the YAML parser, graph model, Brightway database construction, `run_lca` calculation, REST route, MCP tool registration, and response serialization.
- Determine how YAML processes map to Brightway activity/column IDs.
- Confirm process-name uniqueness rules.
- Identify the loop or method-switch step that produces each current `lcia` entry.
- Confirm whether foreground and background activity columns can both appear.

### Phase 2: Add typed response models

- Add versioned response models for contribution categories, process contributions, Sankey nodes, and Sankey links.
- Preserve current response fields.
- Ensure serialization rejects non-finite floats.
- Update live tool/OpenAPI schemas.

### Phase 3: Calculate process contributions

- For every LCIA category, obtain the characterized inventory matrix.
- Sum by process column to produce exclusive direct scores.
- Map columns to stable process IDs and exact names.
- Calculate percentages with near-zero-total handling.
- Calculate an explicit residual.
- Check reconciliation against the existing total score.
- Preserve signed values.

### Phase 4: Build the scaled Sankey payload

- Reuse the solved scaling vector.
- Create deterministic process, resource, emission, and final-product nodes.
- Create scaled technosphere, extraction, emission, and final-product links.
- Attach exact amounts, units, flow names, kinds, and endpoints.
- Produce deterministic ordering for repeatable responses and snapshot tests.

### Phase 5: Wire and document

- Include the new fields in the REST response and MCP tool result.
- Update `GET /api/tools` and OpenAPI output.
- Update the API guide with complete examples and semantic definitions.
- Document negative contributions, residuals, percentage rules, and unit grouping.

## Automated Tests

### Contract tests

- Existing response fields remain present and unchanged in meaning.
- `result_schema_version` equals `2`.
- Every existing `lcia` category has exactly one contribution category.
- Contribution labels, units, and totals match the corresponding `lcia` entries.
- Every Sankey link endpoint exists in `sankey.nodes`.
- Every numeric output is finite.
- `GET /api/tools` and OpenAPI describe the new fields.

### Contribution invariants

For every case study and LCIA category:

```text
sum(direct_score) + residual_score ~= total_score
total_score ~= lcia[label].score
```

Also test:

- A category with a zero or near-zero total returns `percentage: null`.
- Negative contributions are preserved.
- A case with offsetting positive and negative contributions is not clamped.
- Zero-score foreground processes remain addressable.
- Ordering and IDs are deterministic across identical runs.
- Background or unmapped contributions are either returned explicitly or included in residual.

### Sankey invariants

- Jacket technosphere links reproduce the quantities implied by YAML inputs and `scaling_vector`.
- Direct emissions and extractions are multiplied by their process scaling factor exactly once.
- The reference process has a final-product link matching the functional unit.
- Link units match product or elementary-flow definitions.
- Incompatible units remain distinguishable through `unit` and `available_units`.
- Duplicate flow names on different links do not cause ID collisions.
- Branching and shared-supplier graphs produce the correct separate links.
- Invalid/non-finite quantities fail with a clear validation error.

### Regression tests

- Existing health, methods, database, case-study, SVG, REST, and MCP tests pass.
- Existing clients that ignore unknown response fields still parse the response.
- Existing case-study totals, scaling vectors, and SVG output do not change unexpectedly.
- Runtime and response-size changes are measured for the largest bundled case study.

## Acceptance Criteria

- One `POST /api/lca/run` response contains everything needed for the frontend's LCA Results, Inventory, process Contribution, and material/environmental Sankey views.
- Each process has an exclusive impact score for each LCIA category.
- Process scores reconcile with category totals within documented tolerance.
- Negative and offsetting contributions are represented truthfully.
- The Sankey payload uses the same scaling solution as the LCA result.
- Sankey links contain renderer-neutral node identities, direction, scaled amount, and unit.
- Process IDs are consistent between contributions and Sankey data.
- Existing response fields and request clients remain compatible.
- REST discovery/OpenAPI documentation reflects the actual response.
- Automated tests cover numerical reconciliation, graph integrity, edge cases, and regressions.

## Non-Goals

- Do not redesign the frontend.
- Do not add authentication, user projects, or database persistence.
- Do not remove the existing SVG response fields.
- Do not make the server return frontend-specific pixel positions, colors, or component props.
- Do not pre-render the contribution tree or Sankey as HTML.
- Do not silently truncate contributions without reporting the omitted residual.

## Authoritative Brightway References

- Brightway's LCA calculation guide documents `characterized_inventory` as a matrix with biosphere flows in rows and processes in columns: https://docs.brightway.dev/en/latest/content/cheatsheet/lca.html
- Brightway's contribution analyzer documents direct process contribution methods and their characterized impact semantics: https://docs.brightway.dev/en/latest/content/api/bw2analyzer/contribution/index.html
- Brightway's LCA API documents matrix export and index mappings: https://docs.brightway.dev/en/latest/content/api/bw2calc/lca/index.html
