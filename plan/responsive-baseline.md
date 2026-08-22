# Responsive Work Baseline

**Recorded:** August 22, 2026
**Application baseline:** `0612d95`
**Branch:** `undo`
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
| `npm run test:unit` | 93 passed | Vitest, added August 22, 2026. Pure functions only (`tests/unit`); no DOM, no browser. |
| `npm run test:visual` | 47 passed, 0 failed | 47 tests, one Chromium worker. Exits zero. |
| `npm run test:responsive` | 53 passed, 1 skipped | 54 tests across three viewport projects. Exits zero. The skip is deliberate and viewport-conditional (see below). |

The production build contains no `react-grab` or `React Grab` marker; the source-context helper is development-only.

Re-measured on August 22, 2026 at `0612d95`, before starting the undo work. The
previously recorded numbers (24 responsive, 29 visual with 3 accepted failures)
had drifted badly out of date: the suites have grown, and all three accepted
failures were fixed in the August 20–21 issue passes. The visual suite also no
longer exits nonzero, so any tooling or habit that assumed a nonzero exit should
be updated.

## Accepted baseline failures: none

There are no accepted failures any more. All three that this ledger previously
carried have been fixed and their issues closed, so **a failing visual test is
now simply a regression** rather than something to compare against an allowance.

| Test | Former failure | Resolution |
| --- | --- | --- |
| `all result tables expose working column resize handles` | The first Impact table resize handle stayed at `aria-valuenow="300"` instead of changing to `330` after pointer drag. | Fixed; [#39](https://github.com/calvinw/product-graph-editor/issues/39) closed. |
| `opening the inspector keeps the selected jacket node visible` | The selected node overlapped the inspector; measured gap about `-119px` against a required `16px`. | Fixed; [#37](https://github.com/calvinw/product-graph-editor/issues/37) closed. Opening the inspector now re-fits the viewport, but only when the selected node is actually too close to the panel. |
| `opening the property editor preserves the graph viewport` | The inspector stayed visually present after close despite `inert` and `aria-hidden="true"`. | Fixed; [#38](https://github.com/calvinw/product-graph-editor/issues/38) closed. The test was renamed to `closing the property editor does not move the graph viewport again`, since opening it may now deliberately re-fit. |

## The one skipped responsive test

`assistant split pane resizes the workspace` skips itself at viewport widths of
620px or less, because the chat occupies the full contained width at phone size
and there is no split pane to resize. This is a deliberate contract, not a gap:
the test runs and passes at tablet and desktop.

The dark and light application snapshots were visually reviewed and refreshed for the model-workspace navigation and editor changes. Both themed application-view tests now pass; the scaled-graph captures explicitly fit the canvas before recording to avoid transient viewport snapshots.

## Regression rule

A responsive change is acceptable only when:

- build and lint still pass
- all visual tests still pass — there is no accepted-failure allowance
- responsive tests introduced by the work pass, and the only skip stays the
  deliberate viewport-conditional one described above
- no screenshot baseline is updated without visual review
