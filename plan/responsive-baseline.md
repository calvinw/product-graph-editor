# Responsive Work Baseline

**Recorded:** August 16, 2026
**Application baseline:** `d9d13e6`
**Plan branch:** `agent-ui-responsive`
**Viewport used by existing visual suite:** 1440 × 900
**Theme coverage:** dark and light

This ledger separates failures that existed before responsive implementation from regressions introduced by the responsive work. Update it whenever a baseline failure is fixed or deliberately quarantined.

## Environment preparation

The Codespace initially had an incomplete npm optional-dependency install and no usable Playwright browser runtime. The baseline became reproducible after:

```bash
npm install
npx playwright install chromium
npx playwright install-deps chromium
```

For a fresh environment, prefer the equivalent combined Playwright setup:

```bash
npx playwright install --with-deps chromium
```

Infrastructure failures such as a missing browser executable or shared library are not application-test failures and must be repaired before updating this ledger.

## Command results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run build` | Pass | Vite reports the existing large-chunk advisory. |
| `npm run lint` | Pass | Repository-skill implementation scripts use their own tooling contracts and are excluded from the product application lint gate. |
| `npm run test:visual` | 29 passed, 3 failed | 32 tests, one Chromium worker. The remaining failures match the accepted interaction failures below. |
| `npm run test:responsive` | 24 passed, 0 skipped | Three viewport projects; shell, model menus, editor actions, graph settings and selection, analysis workflows, global settings, and Sankey pass at phone, tablet, and desktop sizes. |

The production build contains no `react-grab` or `React Grab` marker; the source-context helper is development-only.

The baseline was refreshed after merging `origin/main` at `48de6be`. The contribution-table keyboard-resize failure is fixed on current `main`. Two stale visual assertions were aligned with the simplified contribution UI: the removed Flow/Impact contribution mode group is no longer exercised, and the Jacket assembly direct score now matches the fixture value of `1.28`.

## Accepted baseline failures

All three failures below are temporarily accepted baseline failures. They may not change or expand during responsive work. Each must be fixed or explicitly quarantined with a follow-up reference by the final cleanup PR.

| Test | Current failure | Disposition |
| --- | --- | --- |
| `all result tables expose working column resize handles` | The first Impact table resize handle remains at `aria-valuenow="300"` instead of changing to `330` after pointer drag. | Accepted baseline; tracked by [#39](https://github.com/calvinw/product-graph-editor/issues/39). |
| `opening the inspector keeps the selected jacket node visible` | The selected node overlaps the inspector; measured gap is about `-119px`, below the required `16px`. | Accepted baseline; tracked by [#37](https://github.com/calvinw/product-graph-editor/issues/37). |
| `opening the property editor preserves the graph viewport` | The inspector remains visually present after close even though it has `inert` and `aria-hidden="true"`. | Accepted baseline; tracked by [#38](https://github.com/calvinw/product-graph-editor/issues/38). |

The dark and light application snapshots were visually reviewed and refreshed for the model-workspace navigation and editor changes. Both themed application-view tests now pass; the scaled-graph captures explicitly fit the canvas before recording to avoid transient viewport snapshots.

## Regression rule

A responsive change is acceptable only when:

- build and lint still pass
- all previously passing visual tests still pass
- each accepted baseline failure remains the same or is fixed
- responsive tests introduced by the work pass
- no screenshot baseline is updated without visual review
