# Implementation Comments: Shadcn/UI Migration

Review of the migration as implemented on `shadcn-conversion`, against [`shadcn-migration.md`](./shadcn-migration.md) and [`shadcn-migration-review.md`](./shadcn-migration-review.md).

**Verdict: it went well.** Phases 0–6 are complete, the plan was followed rather than improvised on, and every point raised in the plan review was addressed in the code. Seven issues were found; one was a genuine accessibility regression, the rest were cleanups.

**Update — all seven are now fixed** on the working tree, plus the pixel-identical half of the token cleanup. Each issue below carries its resolution. Verification after the fixes: `npm run build` passes, `npm run lint` passes at `--max-warnings 0`, and all 9 Playwright tests pass with **zero screenshot drift** across 26 baselines (24 existing plus 2 new).

## What was verified

| Check | Result |
|---|---|
| `npm run build` | Passes |
| `npm run lint` | Passed — 0 errors, 2 warnings under a `--max-warnings 3` budget (now 0 warnings at `--max-warnings 0`) |
| `npm run test:visual` | 9/9 pass, including 24 screenshot comparisons across both themes (now 26) |
| Raw element counts | buttons 33 → 14, selects 11 → 0, inputs 14 → 2, tables 6 → 6 (intentionally kept) |
| Baseline ordering | Baselines committed in `0873bc0`, *before* `a73a26c chore: initialize shadcn foundation` |

The visual suite required a config override to run — see issue 3.

## Review findings: all six addressed

1. **App.tsx contention with `yaml-source-of-truth.md`** — resolved by doing both: `1932a20 fix: separate YAML drafts from applied graphs` landed first on this branch, and that plan's status is now "Implemented on `shadcn-conversion`."
2. **PR 1 too large** — split as suggested. `a73a26c` (foundation) and `372d3e2` (tokens) are separate commits.
3. **No visual-regression tooling** — Playwright added with 24 baselines at 1440×900, `maxDiffPixelRatio: 0.001`, animations disabled, plus a mocked LCA API fixture.
4. **View switcher is not one tablist** — implemented as two `Tabs` roots (`App.tsx:1554`, `App.tsx:1561`) with `primaryView` / `analysisView` derived at `App.tsx:1534-1535`. Correct structure. See issue 1 for the one thing this left open.
5. **Radix Select gotchas** — both handled. The case-study sentinel is now a disabled item (`App.tsx:1651`) instead of a change-handler guard, and the Popover/Select portal conflict is fixed with a targeted `onInteractOutside` guard on `[data-slot="select-content"]` (`App.tsx:1612-1615`).
6. **Verify the CLI invocation** — the plan's guessed `--base radix` / `new-york` did not survive contact; `components.json` records `"style": "radix-nova"`. Worth correcting in the plan document so it does not mislead later.

Migration discipline was also good: the only commits on this branch outside `origin/main` are the eight migration commits plus the YAML fix. The feature work (Plastic Broom, background expansion, inventory trees) came in through the merge at `0359fa8`, not authored here. Only three baselines drifted during the whole migration (`61dc999`), and the two inventory baselines that changed at the merge are attributable to the merged feature.

## Issues

### 1. Tabs render no tabpanels, leaving dangling `aria-controls`

Both `Tabs` roots render only `TabsList` / `TabsTrigger`; view content stays in the existing conditional chain at `App.tsx:1662`. Radix still emits `aria-controls` on every trigger pointing at content ids that are never rendered. Measured against the running dev server:

```
Graph        aria-controls="radix-_r_1_-content-graph"    target exists: false
FILE         aria-controls="radix-_r_1_-content-yaml"     target exists: false
LCA Results  aria-controls="radix-_r_1_-content-results"  target exists: false
role="tabpanel" elements in document: 0
```

A screen reader announces "tab, 1 of 3" and then has nothing to navigate to; axe flags dangling `aria-controls` under `aria-valid-attr-value`. This is narrowly worse than the pre-migration plain buttons, which made no ARIA promises at all. It is also invisible to the current test suite, which asserts arrow-key navigation and `role="tab"` presence but never follows `aria-controls`.

Two ways out: wrap each view in `TabsContent` inside a single root, or switch view selection to `ToggleGroup type="single"` as the theme selector already does.

**Fixed — ToggleGroup.** `TabsContent` turned out not to be viable: the triggers live in `.canvas-head` while the content is its sibling, and the analysis switcher is a second root whose list would have to sit inside the primary root's `results` content. No nesting satisfies both. All three switchers (primary, analysis, and the Sankey Flow/Impact picker, which had the same defect) are now `ToggleGroup type="single"`, matching the theme selector already in the codebase. `src/components/ui/tabs.tsx` is deleted, which also disposes of issue 6.

Re-measured against the running app: **0 dangling `aria-controls`, 0 `role="tab"` elements**, and the switchers now expose `radiogroup` / `radio` with `aria-checked`.

One behavior change worth knowing: Radix Tabs activated on arrow-key focus, so arrowing across the switcher used to rebuild the graph or Sankey on every keypress. ToggleGroup moves focus and commits on Space or Enter. The arrow-key test was updated to match. Mouse behavior is unchanged.

### 2. Phase 2 detokenization is roughly half done

The token layer is well built — `@theme inline` mapping, both themes defined at `index.css:31` and `index.css:116`, and a good set of product-specific tokens. But the legacy per-theme override block was not retired along with it:

| Metric | `origin/main` | Branch |
|---|---|---|
| `data-theme` occurrences in `index.css` | 120 | 111 |
| Hex literals outside the token blocks | 468 | 229 |
| `var(--…)` usages | — | 70 |

Halving the hardcoded values is real progress, and most of what remains is tables and Sankey visuals that Phase 7 explicitly defers. The part that does not fit that story is **migrated primitives still being restyled by hardcoded light-theme overrides**: `index.css:360` targets `[data-slot="select-trigger"]`, `index.css:361-362` restyle `.sankey-picker-tabs` including `button[data-state="active"]`, and `index.css:384` restyles `.contribution-select`. Phase 2's acceptance criterion — "shared controls no longer require theme-specific selector duplication for basic colors" — is not met for those controls.

Related and carried over from `main`, so not a regression but squarely in Phase 2's stated scope: Sankey edge colors are still hardcoded in JS at `App.tsx:909-912` and graph edge colors at `App.tsx:1293-1295`, and unlike the canvas background at `App.tsx:1593` they do not respond to the theme at all.

**Partly fixed.** The Sankey chart picker — the migrated-primitive part of this issue — is now tokenized: the segmented control, its labels, and its select/number-input surfaces use `--segmented-background`, `--control-active-*`, `--control-muted`, `--control-border`, `--control-foreground`, and `--control-background`. Those tokens already existed with values identical to the literals they replaced in **both** themes, so four light-theme override rules were deleted outright with no visual change. `data-theme` occurrences: 111 → 108.

Deliberately left alone, because the token values differ from the current literals and changing them would be an unverified visual change: the inactive picker label color, the `:hover` / `:focus` border and text colors in that panel (light theme currently borrows dark-theme hover colors — a real bug, but its own fix), the number-stepper button text color, and everything in the table and tree styles that Phase 7 defers.

### 3. The visual suite cannot run while a dev server is up

`playwright.config.ts` pins `baseURL` to port 5173 with `reuseExistingServer: false`. With a dev server already running — the normal state while working — the suite aborts:

```
Error: http://127.0.0.1:5173 is already used, make sure that nothing is running
on the port/url or set reuseExistingServer:true in config.webServer.
```

I confirmed the 9 tests pass by re-running them against a copy of the config on port 5178. The failure mode is loud rather than silent, which is the safe direction, but a guardrail developers must stop and free a port for is one they will skip.

**Fixed.** The suite now owns port 5178 with `--strictPort`, verified by running it green while a dev server held 5173.

### 4. Popover triggers and close buttons are inconsistent

Graph settings uses `<Button variant="ghost" size="icon">` as its trigger (`App.tsx:1601`); global settings uses a raw `<button className="global-settings-trigger">` (`App.tsx:1732`). Both popover close buttons are raw `<button>` with no variant (`App.tsx:1617`, `App.tsx:1735`). These are the "consistency between repeated controls" cases the migration exists to fix, and they are three small edits.

**Fixed.** All three are `Button` now — `variant="ghost"` for the trigger, `variant="ghost" size="icon"` for the close buttons. Appearance is unchanged because the existing unlayered `index.css` rules still win over Tailwind's layered utilities, which the screenshots confirm.

The 14 remaining raw buttons are otherwise all tree-toggles and `ProcessNode` disclosures, correctly left alone per Phase 7.

### 5. `NumberStepper` hardcodes a domain CSS class

`NumberStepper.tsx:50` wraps itself in `className="sankey-stepper"` while being used for graph settings and decimal places as well. The generic component should take a `className` or use a neutral name; right now the Sankey styles are load-bearing for unrelated panels.

**Fixed.** The component takes an optional `className` defaulting to `number-stepper`, and the CSS classes were renamed (`.sankey-stepper` → `.number-stepper`, `.sankey-number` → `.number-stepper-value`).

### 6. Dead abstraction in `tabs.tsx`

`tabsListVariants` (`tabs.tsx:22-33`) declares `default` and `line` variants whose class strings are both empty, and the `variant` prop is never passed at either call site. Either give it real styles or drop it.

**Fixed.** Resolved by issue 1 — the whole file is gone.

### 7. Lint budget has almost no headroom

`--max-warnings 3` with 2 existing warnings leaves room for exactly one new warning to slip in unnoticed. Both current warnings are known and benign (`App.tsx:919` deliberately lists source inputs instead of the derived Sankey arrays; `displaySettings.tsx:47` is the standard context-export refresh warning). Prefer `--max-warnings 0` with two inline `eslint-disable-next-line` comments carrying a one-line reason, so the ratchet is at zero and each exception is documented where it lives.

**Fixed.** `--max-warnings 0`, with both exceptions disabled inline and each carrying its reason at the site.

## Bundle cost

Measured against `origin/main` at the same commit content, so features are held constant:

| Asset | `origin/main` | Branch | Change |
|---|---|---|---|
| JS | 870.37 kB (268.80 kB gz) | 941.88 kB (290.68 kB gz) | +8.2% (+21.9 kB gz) |
| CSS | 78.27 kB (13.73 kB gz) | 98.97 kB (17.64 kB gz) | +26% (+3.9 kB gz) |

About 26 kB gzipped for the full set of Radix primitives. Reasonable, and worth stating plainly rather than discovering later. The CSS growth will partly reverse if the legacy overrides in issue 2 are retired.

One judgment call to note: the `shadcn` CLI package sits in `dependencies` rather than `devDependencies`, because `index.css:3` does `@import "shadcn/tailwind.css"`. That is defensible — a `--omit=dev` install would otherwise fail the build — but it is worth a comment in `package.json` so nobody "fixes" it later.

## Coverage gap found while fixing this

The Sankey chart picker was the one panel with no baseline — `chartPickerOpen` starts `false`, so no screenshot ever opened it, which is exactly the panel issue 2's token work touched. Rather than trust the token substitutions, they were checked by screenshotting the open picker in both themes against a worktree of the pre-fix commit: **byte-identical PNGs**. Two baselines (`dark-sankey-chart-settings.png`, `light-sankey-chart-settings.png`) now cover it permanently, bringing the suite to 26.

## What remains

- The unverified-by-baseline half of issue 2: hover and focus colors in the Sankey picker, the number-stepper button text color, and the inactive picker label. Each needs a small visual decision, not a mechanical swap.
- Phases 7 (tables) and 8 (responsive), correctly untouched.

Nothing here is committed — the changes sit in the working tree of `shadcn-conversion` for review.
