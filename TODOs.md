# Responsive UI Work Handoff

**Status:** Responsive implementation is complete and ready for review against `main`. Continue future responsive work from the current default branch after merge.

## Read first

Use these documents in order:

1. `AGENTS.md` — concise repository working contract
2. `.agents/skills/product-graph-editor-ui-development/SKILL.md` — UI architecture and verification rules
3. `plan/responsive-audit.md` — known responsive problems and priorities
4. `plan/responsive-baseline.md` — accepted failures and regression rules
5. `plan/responsive-ui-plan.md` — detailed implementation strategy
6. `README.md` — general project setup and responsive overview

Claude Code users should also read `CLAUDE.md`.

## Supported viewport matrix

The responsive Playwright suite intentionally focuses on three representative sizes:

- 375 × 812 — phone
- 768 × 1024 — tablet portrait
- 1440 × 900 — desktop

Do not add tablet-landscape or large-desktop projects unless the testing contract is deliberately reconsidered and all related documentation is updated.

## Current baseline

- Build: passes, with Vite's existing large-chunk advisory
- Lint: passes
- Unit: 54 passed
- Responsive: 53 passed, 1 skipped
- Visual: 31 passed, 0 failures

All three suites exit zero. The three accepted visual failures previously recorded in `plan/responsive-baseline.md` and tracked by GitHub issues #37, #38, and #39 are all fixed and closed, so there is no accepted-failure allowance any more — a failing visual test is a regression. The one responsive skip is deliberate and viewport-conditional: the assistant split-pane test does not apply at phone width, where the chat uses the full contained width.

## Working rules

- Work on one responsive surface at a time.
- Preserve the established desktop behavior and information density.
- Keep every major view and action reachable at all three supported sizes.
- Prioritize graph and Sankey canvas space at narrow widths.
- Use contained overlays for narrow inspectors and dense settings where appropriate.
- Keep semantic result tables and contain their horizontal scrolling.
- Prevent page-level horizontal overflow.
- Preserve keyboard interaction, focus behavior, and usable touch targets.
- Keep dialogs and popovers inside the viewport.
- Exercise the affected workflow in a browser; do not verify only the initial render.
- Remove an intentional responsive skip only after its complete workflow passes.
- Never update screenshot baselines without visually reviewing the expected, actual, and diff images.

## Verification

Run each command separately so the known visual failures do not prevent the responsive suite from running:

```bash
npm run build
npm run lint
npm run test:unit
npm run test:responsive
npm run test:visual
```

Compare visual failures with `plan/responsive-baseline.md`. Every previously passing visual test must remain green.

## Copyable handoff prompt

> Continue responsive UI work from `main`. First read `AGENTS.md`, `.agents/skills/product-graph-editor-ui-development/SKILL.md`, `plan/responsive-audit.md`, `plan/responsive-baseline.md`, `plan/responsive-ui-plan.md`, and `TODOs.md`. Use only the three supported viewport projects: 375×812, 768×1024, and 1440×900. Work one surface at a time, preserve desktop behavior, and run build, lint, responsive, and visual verification. Do not update screenshots without visual review or introduce failures beyond the recorded baseline.
