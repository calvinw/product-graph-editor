# Product Graph Editor Agent Guide

## Responsive UI work

Use the repository skill at `.agents/skills/product-graph-editor-ui-development/SKILL.md` for UI and responsive changes. Before editing a responsive surface, read:

- `plan/agent-ui-responsive-plan.md`
- `plan/responsive-audit.md`
- `plan/responsive-baseline.md`

Preserve React, Vite, Tailwind CSS 4, shadcn/ui, Radix, and XYFlow. Inspect `src/components/ui/` before adding primitives, preserve graph and LCA behavior, retain semantic result tables, and avoid unrelated refactors.

Verify responsive behavior at the three supported sizes: 375 × 812, 768 × 1024, and 1440 × 900. Exercise the affected workflow in a browser rather than checking only the initial render. Confirm that:

- every major view and action remains reachable
- the document has no page-level horizontal overflow
- graph and Sankey canvases retain useful space
- narrow inspectors and dense settings use an appropriate Sheet, Drawer, or other contained overlay
- tables retain semantic markup and scroll within their own containers
- dialogs and popovers stay inside the viewport
- keyboard interaction, focus behavior, and touch targets remain usable

Run the verification suites separately:

```bash
npm run build
npm run lint
npm run test:responsive
npm run test:visual
```

The recorded baseline is:

- responsive: 16 passed, 5 intentionally skipped
- visual: 20 passed, 5 accepted failures

The visual suite currently exits nonzero because of those accepted failures. Compare them with `plan/responsive-baseline.md`; no previously passing visual test may fail, and no accepted failure may change or expand. Remove a responsive skip only when its workflow passes. Never update screenshots without inspecting the actual, expected, and diff images.
