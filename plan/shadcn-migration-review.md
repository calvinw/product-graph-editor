# Review: Shadcn/UI Migration Plan

Review of [`shadcn-migration.md`](./shadcn-migration.md) for internal consistency and feasibility.

**Verdict: doable.** Roughly 3–5 focused days for one developer. The phasing is sound, the scope boundaries are drawn in the right places, and nothing in it is architecturally blocked. Six items below should be resolved before Phase 0 starts.

## Accuracy check

Every factual claim in the plan's "Current State" section was verified against the repository. All of them hold.

| Claim | Verified |
|---|---|
| 33 raw buttons, 11 selects, 14 inputs, 6 native tables | 33 / 11 / 14 / 6 |
| `src/components/ui/` contains only `button.tsx` | Confirmed; used 6 times, all `variant="ghost"` with custom classNames |
| No `components.json` | Confirmed |
| No `@/*` alias | Confirmed; absent from `tsconfig.json`, `tsconfig.app.json`, `vite.config.ts` |
| Radix used directly for Tooltip only | Confirmed; `src/App.tsx:8` is the only `@radix-ui` import |
| `index.css` has 116 custom top-level class selectors | Confirmed; exactly 116 distinct |
| Dark/light via `data-theme` plus many overrides | Confirmed; `src/lib/displaySettings.tsx:29-32` sets `dataset.theme` and `colorScheme` |
| Production build passes | Confirmed (`npm run build`) |
| Lint blocked by missing ESLint 9 flat config | Confirmed (`npm run lint` errors on missing `eslint.config.*`) |

The plan's judgment calls are also good. Keeping React Flow, LCA calculations, and native semantic tables out of scope is correct, and Phase 7's framing — "Shadcn Table is a styling abstraction, not a data-grid engine" — is the right instinct.

## Findings

### 1. Conflicts with `yaml-source-of-truth.md` over `src/App.tsx`

`plan/yaml-source-of-truth.md` states: *"This work should be scheduled while other contributors are not changing the UI because the main integration point is currently `src/App.tsx`."*

All application UI lives in that single 1466-line file, including every analysis view (`InventoryView`, `ImpactAnalysisView`, `ProcessResultsView`, `ContributionView`, `SankeyView`). PRs 2, 3, and 4 of the migration all rewrite it.

Two plans want exclusive ownership of one file. Pick an explicit order and record it in both documents.

### 2. PR 1 is the largest PR, not the smallest

PR 1 bundles ESLint configuration, import aliases, shadcn initialization, semantic tokens, Button, and Tooltip. Phase 2's token work alone means replacing roughly 120 `data-theme` override rules while preserving pixel-identical output — the largest hidden cost in the plan, folded in with four other concerns.

This contradicts the plan's own "each pull request should cover one coherent group of primitives" principle and its "First Implementation Slice" framing.

Suggested split:

- **PR 1a** — ESLint config, aliases, `shadcn init`, reconcile generated files. Provably zero visual change.
- **PR 1b** — Semantic dark/light tokens.

### 3. "Visual regression checks pass" has no tooling behind it

This appears as an acceptance criterion in five phases. The repository has no test tooling at all — no vitest, no Playwright, no test script in `package.json`. Phase 0 says to "capture visual baselines" without saying how.

Either state plainly that comparison is manual, or add Playwright screenshot capture in Phase 0. Eleven views across two themes is 22 shots and perhaps two hours of setup, and it makes every later phase's criteria actually checkable.

### 4. The main view switcher is not a single tablist

`src/App.tsx:1281-1289` is two nested groups: `Graph | FILE | LCA Results`, followed by a conditional sub-row of five analysis views that only appears once results exist. There are also fallthrough guards — `view === "process" && lcaResult` and `view === "sankey" && lcaResult` — that render a generic panel when results are missing.

The Component Strategy table treats this as one "Main view switcher → Tabs." It needs either two Tabs roots or Tabs plus an inner ToggleGroup, and the content mapping must preserve the fallthrough panel. This is the plan's one genuinely under-specified item.

### 5. Radix Select will hit two concrete gotchas

- **Empty and sentinel values.** Radix Select rejects empty-string item values. The case-study select at `src/App.tsx:1350` renders a conditional `"custom"` option guarded by `event.target.value !== "custom"`; under Radix this wants a disabled item, not a change-handler guard.
- **Portal nesting inside Popover.** The graph-settings selects at `src/App.tsx:1322-1323` will sit inside a Popover after Phase 6. A portaled Select menu triggers the Popover's `onInteractOutside` and closes it. Phase 6 lists "nested-control behavior" as a check but does not name the fix — it should specify the `onInteractOutside` / `modal` handling.

Separately, all 11 selects currently read `event.target.value`; Radix passes the value directly to `onValueChange`, so every handler signature changes. Mechanical, but it is 11 sites.

### 6. Verify the Phase 1 CLI invocation before relying on it

Phase 1 specifies `npx shadcn@latest init --base radix` and a "Style: `new-york`" prompt. The documented flag has historically been `--base-color`, and style selection was removed from the CLI in its 2025 refactor. Run `npx shadcn@latest init --help` and confirm against the installed version rather than the snippet.

This is also the riskiest single command in the plan: `init` will touch `src/index.css` (which already has its own `@theme` block), `src/lib/utils.ts`, and `src/components/ui/button.tsx`. The plan's instruction to "review every file changed by the CLI" is correct — run it on a clean branch and diff before accepting anything.

## Minor points

- **Baseline list omits a view.** Eight views exist; the Phase 0 baseline list covers the graph modes and five analysis views but not the `results` (LCA Results) view at `src/App.tsx:1283`.
- **Phase-to-PR mapping is implicit.** Phases run 0–8, PRs run 1–5 plus a follow-up. The mapping is inferable but unstated; one line would fix it.
- **`@types/node`.** Phase 1 adds it "if required." `import.meta.dirname` (Node 20.11+) avoids the dependency entirely if preferred.

## Expect, do not fix

Phase 0's acceptance criterion says lint "executes successfully" rather than "passes" — that wording is deliberate and wise. A first flat config applied to 1466 lines of `App.tsx` will surface a meaningful number of hooks-dependency and unused-variable findings. Decide up front whether PR 1 fixes them or lands with a warning budget.
