# Shadcn/UI Migration Plan

## Status

Revised after feasibility review on July 27, 2026.

PR 0 guardrails, PR 1a CLI foundation, and the prerequisite YAML consistency work are implemented on `shadcn-conversion`. PR 1b and later component migrations remain pending.

## Objective

Adopt shadcn/ui as the application's standard component foundation while preserving the current visual design and leaving domain-specific graph and LCA interfaces custom.

The migration should improve:

- Accessibility and keyboard behavior
- Consistency between repeated controls
- Reuse of colors, spacing, focus states, and variants
- Maintainability of dark and light themes
- Future responsive and Figma design-system work

This is a component-system migration, not a visual redesign.

## Current State

The application currently uses React 19, Vite, Tailwind CSS 4, and selected pieces of the shadcn technology stack, but it is not configured as a full shadcn project.

At the time this plan was written:

- `src/components/ui/` contains one local component: `button.tsx`.
- There is no `components.json`.
- The `@/*` import alias is not configured.
- Radix is used directly for Tooltip only.
- `App.tsx` contains most of the application UI.
- The application contains 33 raw buttons, 11 raw selects, 14 raw inputs, and 6 native tables.
- `index.css` contains 116 custom top-level class selectors and many repeated color values.
- Dark and light themes are implemented through `data-theme` and a large collection of selector overrides.
- The production build passes.
- Lint is blocked because ESLint 9 is installed without an `eslint.config.*` file.

## Dependency and Scheduling

This plan and [`yaml-source-of-truth.md`](./yaml-source-of-truth.md) both modify `src/App.tsx`.

Use this order:

1. Shadcn guardrails and configuration work that does not rewrite `src/App.tsx` may land first.
2. Complete the YAML draft/applied consistency work.
3. Begin the shadcn component substitutions in `src/App.tsx`.

Do not implement the YAML state transitions and shadcn navigation, form, or Popover migrations concurrently. The state work establishes the behavior that the later component migration must preserve.

## Guiding Principles

### Preserve the existing appearance

The current dark graph-editor aesthetic, light theme, dimensions, spacing, borders, shadows, and interaction states should remain visually consistent.

Shadcn components are editable source code. They should be configured and extended to match the application rather than introducing an unrelated stock theme.

### Migrate incrementally

Each pull request should cover one coherent group of primitives. Every migrated area should be verified before starting the next group.

### Keep domain-specific interfaces custom

Shadcn should provide generic interface primitives. It should not replace graph rendering, LCA calculations, or specialized data presentation.

### Separate migration from redesign

Responsive redesign, graph changes, and Sankey algorithm changes should not be combined with the initial component migration. Separating them makes regressions easier to identify.

## Scope

### In scope

- Shadcn CLI configuration
- `components.json`
- TypeScript and Vite import aliases
- Semantic design tokens
- Canonical Button and Tooltip components
- Tabs and toggle groups
- Selects, inputs, checkboxes, and radio groups
- Reusable number-stepper composition
- Popovers for settings panels
- Shared focus, disabled, hover, and validation behavior
- Visual and interaction regression checks

### Out of scope

- LCA calculation behavior
- YAML parsing and serialization
- React Flow replacement
- Process-node redesign
- Sankey layout replacement
- Contribution-tree calculation changes
- Broad table redesign
- Full responsive redesign
- Automatic Figma export

## Component Strategy

| Existing interface | Proposed foundation | Notes |
|---|---|---|
| Local Button | Shadcn Button | Add application-specific variants where needed |
| Direct Radix Tooltip | Shadcn Tooltip | Centralize styling and usage |
| Primary `Graph / FILE / LCA Results` navigation | Controlled Tabs | Derive the primary section from the current detailed view |
| Result-analysis navigation | Nested Tabs or ToggleGroup | Render only with a current result; preserve the LCA Results fallback |
| Sankey Flow/Impact switcher | Tabs or ToggleGroup | Choose based on final interaction semantics |
| Theme selection | ToggleGroup | Single-value selection |
| Graph mode selection | ToggleGroup or shared Button variants | Preserve disabled behavior |
| Contribution mode | RadioGroup | Keep contribution calculations unchanged |
| Impact grouping | RadioGroup | Preserve current filtering behavior |
| Native selects | Select | Migrate and verify individually |
| Text and number inputs | Input | Keep product-specific wrappers |
| Decimal-place and graph steppers | Custom NumberStepper | Compose from Button and Input |
| Global Settings panel | Popover | Replace manual backdrop and dismissal behavior |
| Graph Settings panel | Popover | Preserve position relative to toolbar |
| File upload | Native file input | Keep visually hidden native control |
| Specialized data tables | Native tables | Retain existing table structures initially |
| Recursive tree controls | Custom logic | Use shared buttons where helpful; do not rewrite hierarchy logic |

## Phase 0: Establish a Safe Baseline

### Tasks

- Create a dedicated migration branch.
- Confirm the working tree is clean before running the CLI.
- Add a valid ESLint 9 flat configuration.
- Add Playwright screenshot tooling and capture deterministic visual baselines in dark and light themes.
- Record keyboard behavior for existing controls.
- Run the production build and lint before migration.

### Visual regression tooling

Add:

- `@playwright/test`
- `playwright.config.ts`
- A `test:visual` package script
- A deterministic LCA v3 response fixture
- Route interception for the local `/lca-api` requests used by result-dependent screenshots

The screenshot suite must not depend on the live LCA service. It should start Vite through Playwright's `webServer`, load a bundled case study, intercept health, tool-discovery, and calculation responses, and create stable screenshots.

Use Playwright snapshot comparison for later migration phases. Any deliberate baseline update must be reviewed as part of the pull request.

### Required visual baselines

- Structure graph
- Scaled graph
- YAML editor
- LCA Results
- Inventory
- Impact Analysis
- Process Results
- Contribution
- Sankey Graph
- Global Settings open
- Graph Settings open
- Selected-node inspector

Recommended initial viewport: `1440 × 900`.

### Acceptance criteria

- `npm run build` passes.
- `npm run lint` executes and exits successfully.
- Existing lint findings are either fixed without behavioral refactoring or recorded as warnings with an explicit baseline count.
- Later migration pull requests do not increase the lint-warning baseline.
- `npm run test:visual` passes.
- Dark and light baseline screenshots are available for comparison.
- No application behavior changes are included in this phase.

## Phase 1: Initialize the Foundation

### Tasks

1. Add the `@/*` alias to:
   - `tsconfig.json`
   - `tsconfig.app.json`
   - `vite.config.ts`
2. Resolve the Vite alias with either:
   - `node:path` plus `@types/node`, or
   - `import.meta.dirname` if the repository's TypeScript and Node targets support it.
3. Immediately before initialization, record the resolved CLI version and recheck its supported options:

   ```bash
   npx --yes shadcn@latest --version
   npx --yes shadcn@latest init --help
   ```

4. Initialize shadcn with the Radix base and CSS variables while protecting the existing local component from automatic reinstall:

   ```bash
   npx shadcn@latest init --base radix --css-variables --no-reinstall
   ```

5. Do not rely on a `new-york` or base-color prompt. Current CLI releases use presets and may not expose those historical prompts.
6. Confirm that the resulting configuration uses:
   - Base primitives: `radix`
   - CSS variables: enabled
   - Global CSS: `src/index.css`
7. Review every file changed by the CLI before accepting it.
8. Reconcile generated changes to `src/index.css`, `src/lib/utils.ts`, and the existing `src/components/ui/button.tsx` manually.

The command above was verified against shadcn CLI `4.16.0` on July 27, 2026. Because `latest` changes over time, the implementation must still repeat the version and help checks rather than assuming these flags remain valid.

Radix is preferred because the application already uses Radix Tooltip and it minimizes the number of primitive systems in the project.

Official references:

- [Shadcn Vite installation](https://ui.shadcn.com/docs/installation/vite)
- [Shadcn CLI](https://ui.shadcn.com/docs/cli)
- [components.json](https://ui.shadcn.com/docs/components-json)
- [Tailwind CSS 4 support](https://ui.shadcn.com/docs/tailwind-v4)

### Acceptance criteria

- `components.json` exists and accurately describes the repository.
- Imports using `@/*` resolve in TypeScript and Vite.
- The project builds, lints, and passes its existing visual snapshots.
- The application still renders with its existing appearance.
- No graph or LCA behavior changes are introduced.

## Phase 2: Establish Semantic Theme Tokens

### Tasks

- Convert the current palette into CSS variables.
- Map standard shadcn tokens through `@theme inline`.
- Preserve the existing `data-theme="dark|light"` behavior or deliberately migrate it to an equivalent class-based mechanism.
- Define additional product-specific tokens for graph and LCA visuals.
- Replace hardcoded values in generic controls before touching specialized graph styles.

### Standard tokens

- `background`
- `foreground`
- `card`
- `card-foreground`
- `popover`
- `popover-foreground`
- `primary`
- `primary-foreground`
- `secondary`
- `secondary-foreground`
- `muted`
- `muted-foreground`
- `accent`
- `accent-foreground`
- `destructive`
- `border`
- `input`
- `ring`
- `radius`

### Product-specific tokens

Potential additions include:

- Canvas background and grid
- Floating-panel background
- Control background and strong border
- Graph edge and label colors
- Foreground/background process colors
- Extraction and emission colors
- Positive, negative, warning, and partial-coverage colors
- Table header and row-hover colors

### Acceptance criteria

- Dark and light themes remain visually equivalent to their baselines.
- Shared controls no longer require theme-specific selector duplication for basic colors.
- Product-specific colors remain explicit and readable.
- Theme switching continues to update `color-scheme`.

## Phase 3: Canonical Button and Tooltip

### Tasks

- Install or regenerate Button and Tooltip through the CLI.
- Replace the direct Radix Tooltip import with the local shadcn wrapper.
- Define only the Button variants that are reused across the application.
- Migrate generic icon and action buttons.
- Keep domain-specific disclosure logic unchanged.

Potential Button variants:

- `default`
- `secondary`
- `outline`
- `ghost`
- `destructive`
- `toolbar`
- `tab`
- `stepper`
- `tree`

Avoid creating a variant for a style used only once.

### Acceptance criteria

- Button focus, disabled, pressed, hover, and active states are consistent.
- Tooltips work with keyboard focus and pointer input.
- Toolbar and inspector controls retain their current dimensions.
- Visual regression checks pass.

## Phase 4: Tabs, Toggle Groups, and Radio Groups

### Tasks

- Model the current two-level navigation explicitly:
  - An outer controlled Tabs root for `Graph`, `FILE`, and `LCA Results`.
  - An inner result-analysis Tabs root or single-value ToggleGroup for Inventory, Impact Analysis, Process Results, Contribution, and Sankey.
- Derive the outer value so every result-analysis view still belongs to the `LCA Results` section.
- Render the inner navigation only when the revised YAML/result state reports a current result.
- Preserve the generic LCA Results panel for idle, running, error, and success states.
- Preserve the existing fallthrough behavior when a result-dependent view is requested without a current result.
- Preserve conditional rendering and the React Flow lifecycle; do not let Tabs mounting behavior silently reset graph state.
- Replace the Sankey Flow/Impact selector with Tabs or a single-value ToggleGroup.
- Replace theme selection with a ToggleGroup.
- Evaluate the graph Structure/Scaled selector for the same shared pattern.
- Replace Impact and Contribution native radio controls with RadioGroup.

### Accessibility requirements

- Tabs expose tab-list, tab, and selected-state semantics.
- Arrow keys move between tab triggers.
- Radio and toggle groups have accessible labels.
- Focus remains visible in both themes.
- View changes do not unexpectedly move focus.

### Acceptance criteria

- All view-switching behavior is unchanged.
- The outer `LCA Results` trigger remains selected while an inner analysis view is active.
- Result-analysis controls appear and disappear according to the current applied-YAML result state.
- Missing-result fallthrough always renders the LCA Results panel rather than a blank Tabs content region.
- Graph and Sankey state remains stable across view changes.
- Keyboard navigation works for every migrated control.
- Visual regression checks pass.

## Phase 5: Selects and Form Controls

### Tasks

- Add Select, Input, Checkbox, Label, and related form primitives as needed.
- Migrate native selects one functional area at a time:
  1. Case-study selector
  2. Graph settings
  3. Sankey settings
  4. Contribution filters
  5. Process-results filters
- Migrate search and numeric inputs.
- Replace the decimal display checkbox.
- Create a reusable `NumberStepper` for repeated minus/input/plus controls.
- Retain the native file input.

### Radix Select migration rules

- Radix Select passes the selected value directly to `onValueChange`; update all 11 handlers rather than expecting `event.target.value`.
- Radix Select item values cannot be an empty string.
- Represent the conditional `custom` case-study value as a disabled item or explicit non-empty sentinel.
- Preserve the current guard that prevents `custom` from being treated as a bundled case-study ID.
- Migrate and test Selects inside settings panels again after those panels become Popovers.

### Select-specific checks

- Long option labels remain readable.
- Portaled menus layer above React Flow and floating panels.
- Menus remain within the viewport.
- Selection works with mouse, keyboard, and type-ahead.
- Light and dark menu styling matches the application.
- Empty and sentinel values never trigger a Radix runtime error.

### Acceptance criteria

- All migrated controls preserve their values and change handlers.
- Number clamping and validation behavior is unchanged.
- Populated menus do not render behind graph canvases.
- Visual and keyboard regression checks pass.

## Phase 6: Settings Popovers

### Tasks

- Replace the manual Global Settings backdrop and panel with Popover.
- Replace the manual Graph Settings backdrop and panel with Popover.
- Preserve current trigger placement and panel dimensions.
- Verify click-outside, Escape, focus return, and nested-control behavior.
- Consider whether the Sankey settings picker should use the same shared panel composition.

### Nested Select handling

The Graph Settings panel contains Select menus that will portal outside the Popover content. Without explicit handling, selecting or interacting with a portaled menu can be interpreted as an outside interaction and close the Popover.

During implementation:

- Test the actual installed Radix/shadcn combination rather than assuming default nesting works.
- Configure Popover `modal` behavior and/or `onInteractOutside` handling so Select portals are treated as part of the active interaction.
- Do not prevent legitimate outside-click dismissal.
- Verify focus returns correctly after both Select and Popover close.

### Acceptance criteria

- Settings dismiss on Escape and outside interaction.
- Focus returns to the trigger when a panel closes.
- Clicking and typing inside a panel does not close it unexpectedly.
- Panel positioning is stable at supported desktop sizes.
- No manual full-screen backdrop is required unless it serves an intentional product behavior.

## Phase 7: Optional Table and Disclosure Cleanup

This phase should only proceed where it produces a measurable improvement.

### Keep initially

- Native semantic `<table>` elements
- Recursive contribution-row calculations
- Impact-tree calculations
- Specialized column sizing
- Native `<details>` where it already provides appropriate behavior

### Consider later

- Shared table shells for repeated header and border styling
- Collapsible for disclosures that need controlled state or animation
- Shared tree-toggle buttons
- Reusable empty, loading, and error states

Shadcn Table is a styling abstraction, not a data-grid engine. Migrating specialized LCA tables merely to replace their element names is not a goal.

## Phase 8: Responsive Work

Responsive work should begin only after the component foundation is stable.

Potential later work:

- Scrollable or compact view tabs
- Sheet or Drawer for settings on narrow screens
- Responsive graph toolbar placement
- Larger touch targets
- Tablet table overflow behavior
- Mobile contribution-row detail disclosures
- Container queries for analysis panels

Responsive changes require their own visual baselines and acceptance criteria.

## Files Expected to Change

Foundation:

- `components.json`
- `package.json`
- `package-lock.json`
- `playwright.config.ts`
- `tests/visual/`
- `tests/fixtures/`
- `tsconfig.json`
- `tsconfig.app.json`
- `vite.config.ts`
- `src/index.css`
- `src/lib/utils.ts`
- `eslint.config.js` or `eslint.config.mjs`

Components:

- `src/components/ui/button.tsx`
- `src/components/ui/tooltip.tsx`
- `src/components/ui/tabs.tsx`
- `src/components/ui/toggle-group.tsx`
- `src/components/ui/radio-group.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/checkbox.tsx`
- `src/components/ui/popover.tsx`
- Additional components only when required

Application integration:

- `src/App.tsx`
- `src/components/ProcessNode.tsx`, only if shared button behavior is useful
- `src/lib/displaySettings.tsx`, if theme activation changes

## Verification Strategy

Every migration pull request should run:

```bash
npm run build
npm run lint
npm run test:visual
git diff --check
```

Interactive verification should include:

- Mouse and keyboard control operation
- Visible focus states
- Disabled-state behavior
- Escape and outside-click dismissal
- Dark and light themes
- Graph panning and zooming
- Graph layout and node selection
- YAML loading and preview
- LCA calculation
- Contribution-row expansion
- Sankey settings
- Settings persistence during the session

## Phase-to-PR Mapping

| Work | Pull request |
|---|---|
| Phase 0 guardrails | PR 0 |
| Phase 1 CLI foundation | PR 1a |
| Phase 2 semantic tokens | PR 1b |
| Phase 3 Button and Tooltip | PR 1c |
| Phase 4 selection controls | PR 2 |
| Phase 5 forms | PR 3 |
| Phase 6 overlays | PR 4 |
| Phase 7 optional cleanup | PR 5, only if justified |
| Phase 8 responsive work | Separate follow-up project |

## Pull Request Sequence

### PR 0: Guardrails

- ESLint flat configuration and warning-baseline decision
- Playwright visual-test setup
- Deterministic LCA response fixture
- Dark and light baseline snapshots, including LCA Results
- No application behavior or visual changes

### PR 1a: CLI Foundation

- Import aliases
- Verified shadcn CLI initialization
- `components.json`
- Generated-file reconciliation
- No semantic-token conversion
- No component substitution
- No intentional visual changes

### YAML consistency work

- Complete [`yaml-source-of-truth.md`](./yaml-source-of-truth.md) before continuing into `src/App.tsx` component migration.

### PR 1b: Semantic Tokens

- Dark and light semantic tokens
- Product-specific graph and LCA tokens
- Pixel-equivalent output against Playwright snapshots
- No component substitution

### PR 1c: Button and Tooltip

- Canonical Button
- Shadcn Tooltip wrapper
- Reusable variants only
- No navigation or form migration

### PR 2: Selection Controls

- Two-level primary and analysis navigation
- Sankey Tabs or ToggleGroup
- Theme ToggleGroup
- Impact and Contribution RadioGroups

### PR 3: Forms

- Select
- Input
- Checkbox
- Reusable NumberStepper

### PR 4: Overlays

- Global Settings Popover
- Graph Settings Popover
- Shared floating-panel composition where appropriate

### PR 5: Optional Cleanup

- Repeated table shells
- Disclosure components
- Shared empty/error states
- Only changes with clear maintenance or accessibility value

### Separate follow-up project

- Responsive shell
- Sheets and drawers
- Narrow-screen table behavior
- Touch interaction improvements

## First Implementation Slice

The recommended first implementation is PR 0 followed by PR 1a.

Together they establish:

- A working lint command with an explicit legacy-warning policy
- Automated, deterministic visual baselines
- A clean shadcn CLI configuration
- Stable import aliases
- A reviewed `components.json`

They should not convert theme tokens, replace Button or Tooltip, or migrate Tabs, Selects, settings panels, graph controls, or data tables.

After PR 1a, complete the YAML consistency work before PR 1b and subsequent component migration. This keeps state-transition changes separate from visual and component changes and makes every later pull request reviewable and reversible.
