# Product Graph Editor

A full-window React application for exploring product life-cycle graphs and LCA results. The interface uses shadcn/ui components and XYFlow for interactive graph rendering.

## Run locally

```bash
./start_server.sh
```

The launcher installs dependencies when needed and forwards optional arguments to Vite. For example, `./start_server.sh --host 0.0.0.0` exposes the server on your local network.

Open the local URL printed by Vite. Use the graph toolbar to arrange, fit, search, and zoom the graph. Select any node to inspect its details.

## Build

```bash
npm run build
```

## Responsive development

Responsive work must preserve the established desktop experience while keeping every major workflow reachable on phones and tablets. Test changes at these viewports:

- 375 × 812 — phone
- 768 × 1024 — tablet portrait
- 1440 × 900 — desktop

At narrow widths, prioritize graph and Sankey canvas space, keep settings and inspectors reachable through compact overlays, contain table scrolling inside the table region, and prevent page-level horizontal overflow. Preserve keyboard behavior, useful touch targets, semantic result tables, and dialogs/popovers that remain inside the viewport.

Before changing a responsive surface, read `plan/responsive-ui-plan.md`, `plan/responsive-audit.md`, and `plan/responsive-baseline.md`. Verify changes with:

```bash
npm run build
npm run lint
npm run test:unit
npm run test:responsive
npm run test:visual
```

The current recorded baseline is 100 unit tests passed, 53 responsive tests passed with 1 deliberate viewport-conditional skip, plus 50 visual tests passed with no failures. All three suites exit zero. There is no accepted-failure allowance any more, so a failing visual test is a regression. Do not update screenshot baselines without visually reviewing the differences.

## GitHub Pages

Pushes to `main` automatically build and publish the app through the **Deploy to GitHub Pages** workflow. The workflow can also be run manually from the repository's Actions tab.
