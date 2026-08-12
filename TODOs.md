# Responsive UI Work Handoff

Continue responsive UI development on the `agent-ui-responsive` branch. Do not merge into `main` until the responsive work is reviewed and ready.

## Read first

Use these documents in order:

1. `AGENTS.md` — concise repository working contract
2. `.agents/skills/product-graph-editor-ui-development/SKILL.md` — UI architecture and verification rules
3. `plan/responsive-audit.md` — known responsive problems and priorities
4. `plan/responsive-baseline.md` — accepted failures and regression rules
5. `plan/agent-ui-responsive-plan.md` — detailed implementation strategy
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
- Responsive: 21 passed, 0 skipped
- Visual: 20 passed, 5 accepted failures

The visual suite currently exits nonzero because of the five failures recorded in `plan/responsive-baseline.md`. Responsive work must not introduce a new failure or change or expand an accepted failure. The original five responsive workflow skips have been removed after the shell, settings, editor, graph settings, and Sankey settings workflows passed at all supported viewports.

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
npm run test:responsive
npm run test:visual
```

Compare visual failures with `plan/responsive-baseline.md`. Every previously passing visual test must remain green.

## Copyable handoff prompt

> Continue responsive UI work on branch `agent-ui-responsive`. First read `AGENTS.md`, `.agents/skills/product-graph-editor-ui-development/SKILL.md`, `plan/responsive-audit.md`, `plan/responsive-baseline.md`, `plan/agent-ui-responsive-plan.md`, and `TODOs.md`. Use only the three supported viewport projects: 375×812, 768×1024, and 1440×900. Work one surface at a time, preserve desktop behavior, and run build, lint, responsive, and visual verification. Do not update screenshots without visual review or introduce failures beyond the recorded baseline.
