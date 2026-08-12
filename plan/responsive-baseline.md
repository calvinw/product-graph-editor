# Responsive Work Baseline

**Recorded:** August 10, 2026
**Application baseline:** `48de6be`
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
| `npm run lint` | Pass | Zero warnings allowed. |
| `npm run test:visual` | 20 passed, 5 failed | 25 tests, one Chromium worker. |
| `npm run test:responsive` | 21 passed, 0 skipped | Three viewport projects; the previously skipped phone and tablet workflow contracts now pass. |

The production build contains no `react-grab` or `React Grab` marker; the source-context helper is development-only.

The baseline was refreshed after merging `origin/main` at `48de6be`. The contribution-table keyboard-resize failure is fixed on current `main`. Two stale visual assertions were aligned with the simplified contribution UI: the removed Flow/Impact contribution mode group is no longer exercised, and the Jacket assembly direct score now matches the fixture value of `1.28`.

## Accepted baseline failures

All five failures below are temporarily accepted baseline failures. They may not change or expand during responsive work. Each must be fixed or explicitly quarantined with a follow-up reference by the final cleanup PR.

| Test | Current failure | Disposition |
| --- | --- | --- |
| `all result tables expose working column resize handles` | The first Impact table resize handle remains at `aria-valuenow="300"` instead of changing to `330` after pointer drag. | Accepted baseline; investigate during browser/test tooling work. |
| `opening the inspector keeps the selected jacket node visible` | The selected node overlaps the inspector; measured gap is about `-119px`, below the required `16px`. | Accepted baseline; investigate during graph/inspector responsive work. |
| `opening the property editor preserves the graph viewport` | The inspector remains visually present after close even though it has `inert` and `aria-hidden="true"`. | Accepted baseline; investigate during graph/inspector responsive work. |
| `dark application views` | `dark-global-settings.png` differs by about 1% of pixels. | Accepted baseline; determine whether this is an environment/font baseline or a real visual regression before updating snapshots. |
| `light application views` | `light-global-settings.png` differs by about 1% of pixels. | Accepted baseline; determine whether this is an environment/font baseline or a real visual regression before updating snapshots. |

## Regression rule

A responsive change is acceptable only when:

- build and lint still pass
- all previously passing visual tests still pass
- each accepted baseline failure remains the same or is fixed
- responsive tests introduced by the work pass
- no screenshot baseline is updated without visual review
