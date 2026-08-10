---
name: product-graph-editor
description: Develop, refactor, audit, and test the Product Graph Editor React UI. Use for changes to the application shell, React Flow graph and Sankey views, YAML editor, LCA result and contribution tables, shadcn components, responsive layouts, accessibility, themes, or Playwright browser coverage in this repository.
---

# Product Graph Editor UI Development

## Preserve the Architecture

- Keep React, Vite, Tailwind CSS 4, shadcn/ui, Radix, and XYFlow.
- Inspect `src/components/ui/` before adding a primitive.
- Use the shadcn CLI for deterministic component operations.
- Use shadcn MCP only when available; fall back to `shadcn search`, `view`, and `docs`.
- Preserve graph and LCA behavior, semantic data tables, theme variables, and existing desktop behavior.
- Do not add another component library or perform unrelated refactors.

## Work Incrementally

1. Reproduce or inspect the current behavior.
2. Read the affected component, styles, and tests.
3. Change the smallest coherent surface.
4. Extract from `src/App.tsx` only when extraction directly supports the current change.
5. Add behavioral Playwright coverage.
6. Run the relevant verification commands.

## Apply Responsive Rules

Verify at least:

- 375 × 812
- 768 × 1024
- 1024 × 768
- 1440 × 900
- 1920 × 1080 as a spot check

At narrow widths:

- prioritize graph and Sankey viewport space
- move persistent side inspectors or dense settings into a Sheet or Drawer
- keep every major view reachable
- use contained horizontal scrolling for tables; do not convert LCA tables to cards by default
- keep dialogs and popovers within the viewport
- preserve usable touch targets and keyboard interaction
- prevent page-level horizontal overflow

## Use Browser Evidence

Use standard Playwright tests as the portable source of truth. Chrome DevTools MCP, shadcn MCP, React Grab, and Playwright CLI are optional accelerators.

Before changing a responsive surface, consult:

- `plan/agent-ui-responsive-plan.md`
- `plan/responsive-baseline.md`
- `plan/responsive-audit.md` when it exists

Do not update screenshots without visual review. Do not count missing browser binaries or libraries as application failures.

## Verify

Run:

```bash
npm run build
npm run lint
npm run test:visual
npm run test:responsive
```

Compare known visual failures with `plan/responsive-baseline.md`. Require every previously passing visual test and every responsive test to pass.
