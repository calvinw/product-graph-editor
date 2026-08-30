# Plan: the two open issues assigned to elenachoi1

Status as of 30 August 2026. Of the nine issues filed 27-28 August, seven are
delivered and closed: #75, #72, #68, #70, #71 and #74 in 37eab7c, and #69 in
571da23. The two below are open because each needs a decision that is the
issue author's to make.

Note: the login is `elenachoi1`, not `elena_choi`.

---

## #73 — Activity cards too small

`.pg-node` (`src/index.css`) is `height: 48px`, `font-size: 19px`, pill-shaped.
`.sankey-process-node.pg-node.is-expanded` is `width: 300px; min-height: 94px`.

The issue says "humoungous, or much bigger", which is not yet a number, and the graph
nodes feed a dagre layout — enlarging them changes spacing, edge routing, and the default
zoom that `fitView` picks. **Needs a decision on target size**, ideally from a screenshot
at the default zoom.

Suggest starting at roughly 1.5× (height 48 → 72, font 19 → 24) and reviewing, rather
than picking a final number now. Sankey cards scale separately.

Check the dagre `nodesep` / `ranksep` in `yamlGraph.ts` at the same time — enlarged nodes
with unchanged separation will look cramped.

This is the one item where all three responsive viewports need a real look, since bigger
cards cost the most at 375px. It is also the only remaining issue that would move
screenshot baselines, across both graph and Sankey.

## #76 — Sort biosphere exchanges alphabetically

Biosphere rows render in source order (effectively by volume) in two places:

- `src/components/graph/Inspector.tsx`
- the activity cards — `ProcessNode.tsx`, `.pg-biosphere`

The issue asks for sortable, not re-sorted, so add a control rather than changing the
default. Smallest version that satisfies it: a small toggle in the Property Editor's
biosphere section header, "Volume | Name", defaulting to Volume.

Decide whether the toggle also drives the activity cards or only the Property Editor. The
issue mentions both surfaces, so a shared piece of state is likely wanted — probably in
the graph store rather than local component state.

Sort by `item.label` with `localeCompare`.

---

## Decisions needed before coding

1. **#73** — how much bigger, and confirm graph *and* Sankey.
2. **#76** — does the sort control drive the activity cards too, or only the Property
   Editor?

---

## Verification

Per `CLAUDE.md`, run separately, expecting 117 unit / 65 responsive with 3 conditional
skips / 56 visual:

```bash
npm run build
npm run lint
npm run test:unit
npm run test:responsive
npm run test:visual
```

`tests/responsive/draggable-panels.responsive.spec.ts` "the toolbar drag handle stays
reachable after the viewport shrinks" is flaky. It failed intermittently on all three
viewports during this work and passes on its own every time; it never opens the chat
panel and only exercises the graph toolbar's reposition-on-resize. Worth wrapping in
`expect.toPass()` rather than treating a single failure as a regression.
