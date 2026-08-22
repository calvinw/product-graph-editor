# Product Graph Editor Agent Guide

## Responsive UI work

Use the repository skill at `.agents/skills/product-graph-editor-ui-development/SKILL.md` for UI and responsive changes. Before editing a responsive surface, read:

- `plan/responsive-ui-plan.md`
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
npm run test:unit
npm run test:responsive
npm run test:visual
```

The recorded baseline is:

- unit: 54 passed
- responsive: 53 passed, 1 skipped
- visual: 31 passed, 0 failures

All three suites exit zero. The single responsive skip is deliberate and
viewport-conditional: the assistant split-pane test does not apply at phone
width, where the chat uses the full contained width.

The three formerly accepted visual failures (issues #37, #38, #39) are all
fixed and closed, so there is no longer an accepted-failure allowance: a
failing visual test is now simply a regression. Never update screenshots
without inspecting the actual, expected, and diff images.
