# Product Graph Editor — Agent Tooling and Responsive Design Implementation Plan

**Repository:** `calvinw/product-graph-editor`  
**Intended implementation agent:** GPT-5.6 running inside the project Codespace  
**Baseline branch:** `main` at `3d11438` (verified against `origin/main` on August 8, 2026)  
**Recommended implementation branch:** create `agent-ui-responsive` from the current `main`  
**Purpose:** Add agent-oriented React/shadcn development tooling and then use it to improve responsive behavior without destabilizing the existing desktop application.

---

## 1. Goals

This project has two related goals:

1. Improve the development environment for coding agents working on the React + Tailwind + shadcn application.
2. Use that improved environment to make the Product Graph Editor work well on desktop, tablet, and phone layouts.

The target development loop is:

```text
GPT-5.6 / Claude / other coding agent
        |
        +-- shadcn Skill
        |      understands shadcn conventions
        |
        +-- shadcn MCP
        |      searches/discovers components and registries
        |
        +-- shadcn CLI
        |      deterministic component/project operations
        |
        +-- React Grab
        |      maps rendered UI elements back to React source
        |
        +-- Chrome DevTools
        |      inspects DOM, CSS, console, network, viewport behavior
        |
        +-- Playwright
               exercises workflows and verifies desktop/tablet/mobile
```

The shadcn CLI remains the deterministic project tool. The MCP server is an agent-facing discovery layer rather than a replacement for the CLI.

---

# 2. Current `main` Baseline

This plan was refreshed against local `main` and `origin/main` at `3d11438` on August 8, 2026. Before implementation, fast-forward `main`, create the implementation branch from it, and verify that newer changes have not invalidated this snapshot.

Verified baseline:

- React 19
- Vite
- Tailwind CSS 4
- shadcn 4
- Radix-based shadcn components
- React Flow / XYFlow
- `components.json`
- `src/components/ui/`
- existing Playwright visual tests
- existing `.skillshare/` infrastructure
- existing Codespace bootstrap scripts
- existing `configs/mcp-servers.conf`
- existing dark/light semantic CSS variables

Run:

```bash
git status
npm install
npm run build
npm run lint
npm run test:visual
```

At the time of this refresh, `npm run build` and `npm run lint` pass. The visual suite reports 18 passing and 7 failing tests in existing table-resizing, contribution-detail, inspector, and screenshot assertions. Record and resolve or explicitly quarantine that baseline before responsive changes so new failures can be attributed correctly.

Do not begin responsive refactoring until the current baseline is understood.

---

# 3. Development Strategy

Do **not** attempt one large responsive rewrite.

Work in this order:

1. Agent tooling
2. Responsive test harness
3. Application shell/navigation
4. Main graph experience
5. YAML editor
6. Analysis/result views
7. Sankey view
8. Cleanup and documentation

Each phase should remain independently reviewable.

Preserve the existing desktop appearance wherever practical.

---

# 4. Phase 1 — shadcn Skill

## Objective

Give coding agents current shadcn-specific instructions so they stop guessing component APIs or recreating primitives that shadcn already provides.

## Action

Install the official shadcn skill using the current supported mechanism.

Expected command:

```bash
npx skills add shadcn/ui
```

Before relying on the command, confirm the currently installed CLI syntax.

Verify shadcn can correctly understand the repository:

```bash
npx shadcn@latest info
```

## Important distinction

The repository already uses `.skillshare/` for project-specific skills.

Use the two systems for different purposes:

```text
Official shadcn Skill
    -> generic knowledge of shadcn

.skillshare/skills/product-graph-editor/
    -> knowledge and rules specific to this application
```

Do not copy the entire official shadcn skill into the local project skill.

---

# 5. Phase 2 — Product Graph Editor Project Skill

Create:

```text
.skillshare/
└── skills/
    └── product-graph-editor/
        └── SKILL.md
```

The skill should tell agents how this particular UI should be developed.

Recommended content:

```markdown
---
name: product-graph-editor
description: UI development and responsive-design rules for the Product Graph Editor.
---

# Product Graph Editor UI Development

## Stack

- React
- Vite
- Tailwind CSS
- shadcn/ui
- Radix
- React Flow / XYFlow

## Component rules

1. Inspect existing `src/components/ui` components before adding anything.
2. Prefer an existing shadcn component over a custom primitive.
3. Use the shadcn CLI for deterministic component operations.
4. Use shadcn MCP when discovering or comparing components.
5. Do not replace React Flow.
6. Preserve existing graph/LCA behavior.
7. Preserve semantic HTML for LCA result tables.
8. Prefer existing design tokens and CSS variables over hard-coded colors.
9. Do not introduce another component library.
10. Avoid large unrelated refactors while making responsive changes.

## Responsive targets

Verify at least:

- 375 × 812 — phone
- 768 × 1024 — tablet portrait
- 1024 × 768 — tablet landscape / small laptop
- 1440 × 900 — desktop
- 1920 × 1080 — large desktop

## Responsive philosophy

Do not merely shrink the desktop interface.

At narrow widths:

- side inspectors should become Sheet/Drawer interfaces
- navigation may wrap, scroll, or collapse
- dense settings may move into menus or drawers
- graph canvases should retain maximum available space
- tables may scroll horizontally inside their own containers
- dialogs and popovers must remain inside the viewport
- touch targets must remain usable

## Verification

Before declaring responsive UI work complete:

1. Run build.
2. Run lint.
3. Run Playwright tests.
4. Exercise the affected workflow at all supported viewport sizes.
5. Check browser console errors.
6. Check page-level horizontal overflow.
7. Verify keyboard interaction.
8. Verify light and dark themes where relevant.
```

Then sync the skill using the repository's existing Skillshare workflow:

```bash
sync-skills.sh
```

---

# 6. Phase 3 — shadcn MCP

## Objective

Allow the coding agent to search/discover shadcn components and registries using MCP.

The MCP should complement the CLI.

Use MCP for questions such as:

```text
What shadcn component should replace the desktop inspector on phones?

Search for a suitable responsive Drawer or Sheet.

Find an existing primitive for these toolbar overflow actions.
```

Use the CLI for operations such as:

```bash
npx shadcn@latest info
npx shadcn@latest docs sheet
npx shadcn@latest add sheet
```

## Configuration

The shadcn MCP server is a local command/stdio MCP.

Expected command:

```bash
npx shadcn@latest mcp
```

Configure it for the agents actually used in the Codespace.

For Codex, the conceptual configuration is:

```toml
[mcp_servers.shadcn]
command = "npx"
args = ["shadcn@latest", "mcp"]
```

For Claude-style MCP configuration:

```json
{
  "mcpServers": {
    "shadcn": {
      "command": "npx",
      "args": ["shadcn@latest", "mcp"]
    }
  }
}
```

## Existing MCP installer

The current repository MCP configuration is primarily URL/HTTP/SSE oriented.

Do not force a local stdio MCP into that format unless the shared `ai-agentic-tools` installer explicitly supports it.

A later improvement to the common tooling could add a second local-command MCP configuration format.

That improvement should be treated as separate infrastructure work unless it is trivial.

---

# 7. Phase 4 — React Grab

## Objective

Allow a human to point to a rendered UI element and give the coding agent precise source context.

Install React Grab using its current supported setup.

Expected starting command:

```bash
npx grab@latest init
```

Verify exactly what files the installer changes before accepting them.

Requirements:

- development-only behavior
- no production runtime dependency unless required
- production build must not expose React Grab functionality
- `npm run build` must still pass

Typical workflow:

```text
1. Run the application.
2. Select a rendered element using React Grab.
3. Ask the agent:
   "Make this responsive below 768px."
4. Agent receives source/component context.
```

React Grab is especially useful while substantial UI still lives in or flows through large components such as `App.tsx`.

---

# 8. Phase 5 — Chrome DevTools for Agents

## Objective

Allow the coding agent to inspect the real running application instead of reasoning solely from source code.

Capabilities should include:

- DOM inspection
- computed CSS
- responsive viewport emulation
- console errors
- network requests
- screenshots
- layout/overflow diagnosis
- performance inspection where useful

Configure the Chrome DevTools MCP/agent tooling for the coding agent used in the Codespace.

For Codex, verify the current syntax and configure the Chrome DevTools MCP as a local command.

Do not assume that the shared `configs/mcp-servers.conf` supports local command MCPs until its installer has been checked.

---

# 9. Phase 6 — Playwright Agent Tooling

## Important

The repository already has Playwright tests.

Do **not** reinstall or replace Playwright unnecessarily.

Keep the existing visual-regression suite.

Add agent-oriented Playwright support so GPT-5.6 can interactively explore the running application and turn discoveries into tests.

Where supported, install Playwright CLI agent skills.

Verify the current supported command before committing it.

The purpose is to let the agent do:

```text
open app
resize viewport
click Graph
open settings
select a node
open inspector
switch to Results
navigate to Impact Analysis
verify controls
check overflow
```

instead of merely inspecting screenshots.

---

# 10. Phase 7 — Responsive Playwright Harness

The current desktop visual tests should remain useful.

Do not immediately multiply every visual screenshot test across every viewport.

Instead add a focused responsive suite.

Suggested layout:

```text
tests/
├── visual/
│   └── existing visual regression tests
│
└── responsive/
    ├── shell.responsive.spec.ts
    ├── graph.responsive.spec.ts
    ├── editor.responsive.spec.ts
    ├── analysis.responsive.spec.ts
    └── sankey.responsive.spec.ts
```

Use representative viewports:

```text
phone:              375 × 812
tablet portrait:    768 × 1024
tablet landscape:  1024 × 768
desktop:           1440 × 900
large desktop:     1920 × 1080
```

## Initial responsive assertions

Create tests for:

```text
- no page-level horizontal overflow
- navigation remains reachable
- product selector remains usable
- graph canvas remains visible
- graph toolbar controls remain reachable
- selected-node details remain accessible
- YAML editor actions remain reachable
- Calculate remains reachable
- dialogs stay within viewport
- popovers stay within viewport
- result tables scroll inside their own containers
- keyboard navigation continues working
```

Prefer behavioral assertions over an explosion of pixel snapshots.

---

# 11. Responsive UI Audit — Before Refactoring

Before changing responsive behavior, use Chrome DevTools and Playwright to audit:

```text
375 × 812
768 × 1024
1024 × 768
1440 × 900
1920 × 1080
```

Document problems before fixing them.

Check specifically for:

- horizontal overflow
- navigation collisions
- clipped product selector
- inaccessible buttons
- overlapping floating controls
- off-screen popovers
- inspector consuming too much graph width
- tiny graph canvas
- excessive fixed pixel widths
- fixed desktop insets
- table overflow
- toolbar overflow
- touch-target sizing
- modal overflow
- editor footer/header collisions

Do not change code during the first audit pass.

Produce a prioritized findings list.

---

# 12. Responsive Phase A — Application Shell

The desktop shell should remain substantially intact.

At smaller widths:

## Header

Hide or reduce secondary information before shrinking primary controls.

Possible order:

```text
large desktop:
brand + graph title + settings

tablet:
brand + shortened graph title + settings

phone:
brand + compact title + overflow/settings
```

## Product selector and navigation

Do not force all controls onto one row.

Recommended narrow layout:

```text
┌────────────────────────────┐
│ Header                     │
├────────────────────────────┤
│ LCA File [selector      ▾] │
├────────────────────────────┤
│ Graph Editor Results ... → │
├────────────────────────────┤
│                            │
│ CONTENT                    │
│                            │
└────────────────────────────┘
```

Navigation may use:

- horizontal scrolling
- responsive wrapping
- selective overflow menu

Do not hide major application views without an alternate accessible route.

---

# 13. Responsive Phase B — Main Graph

The graph is the core application experience and receives highest priority.

## Desktop

Keep the current right-side inspector approach if it works well.

## Tablet/phone

Do not reserve a fixed ~300px right column for the selected-node inspector.

Use a responsive pattern such as:

```text
node selected
     |
     +-- desktop -> side inspector
     |
     +-- tablet -> shadcn Sheet
     |
     +-- phone  -> shadcn Drawer or Sheet
```

The graph canvas should use nearly the full available width on a phone.

Use shadcn MCP to compare `Sheet` and `Drawer`, then use the CLI to add the selected component if it is not already in `src/components/ui`.

---

# 14. Responsive Phase C — Graph Toolbar

Current graph operations may include controls such as:

- settings
- selection
- expand all
- collapse all
- auto layout
- fit graph
- zoom in
- zoom out
- graph display mode

Do not display every operation permanently on small phones.

Recommended pattern:

```text
Desktop:
[Settings] [Select] [Expand] [Collapse] [Layout] [Fit] [+] [-]

Phone:
[Settings] [Fit] [+] [-] [...]
```

The overflow menu can contain:

```text
Auto layout
Expand all
Collapse all
Scaled graph
Structure graph
other low-frequency commands
```

Use shadcn `DropdownMenu` if appropriate.

---

# 15. Responsive Phase D — Graph Search

Desktop floating search may keep its current compact width.

At phone widths prefer:

```text
left: 12px
right: 12px
width: auto
```

or a search button that expands into an overlay.

Ensure search does not collide with graph toolbar controls.

---

# 16. Responsive Phase E — YAML Editor

Desktop can retain the current pane layout.

At narrow widths:

```text
┌──────────────────────────┐
│ Product graph YAML       │
│ description              │
│                          │
│ [Paste] [Upload]         │
├──────────────────────────┤
│                          │
│ YAML editor              │
│                          │
├──────────────────────────┤
│ status/error             │
│                          │
│ [Calculate            ]  │
└──────────────────────────┘
```

Changes to consider:

- reduced outer inset
- wrapping header controls
- stacked footer
- full-width Calculate button on phone
- smaller editor padding
- preserved monospace editing experience
- sufficient vertical editor area

---

# 17. Responsive Phase F — Analysis Views

Views may include:

- Inventory
- Impact Analysis
- Process Results
- Contribution
- standard Results

Do not blindly convert data tables into cards.

LCA tables are naturally tabular and should generally remain tables.

Preferred behavior:

```text
outer view: no page-level horizontal overflow

table container:
overflow-x: auto
```

Consider:

- sticky table headers
- sticky first column where genuinely useful
- smaller responsive padding
- settings moved into Sheet/Drawer on phone
- wrapping or stacking analysis controls

Desktop control bars can stay horizontal.

Phone controls may become:

```text
[Analysis settings]

      ↓

Sheet / Drawer

Mode
Category
Threshold
Display options
```

---

# 18. Responsive Phase G — Sankey View

Treat Sankey similarly to the main graph.

Prioritize the graph viewport.

On phone:

```text
┌──────────────────────────┐
│                          │
│ Sankey / React Flow      │
│                          │
│                          │
│ [Settings] [Fit] [...]   │
└──────────────────────────┘
```

Move dense picker/settings UI into a responsive Sheet/Drawer where appropriate.

Selection details should not permanently reduce the graph width on narrow screens.

---

# 19. Tailwind Migration Policy

Do **not** make "rewrite all CSS as Tailwind" part of this project.

The application already has significant custom styling and semantic theme variables.

Instead:

- retain existing CSS where it is working
- use Tailwind for new responsive layouts where convenient
- migrate styles only when touching the relevant component
- preserve semantic CSS variables
- avoid large visual churn

Example:

```tsx
<div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
```

is useful.

Converting hundreds of unrelated existing CSS declarations is not.

---

# 20. Component Extraction Strategy

Responsive work will be easier if large visual regions are gradually extracted from `App.tsx`.

Do not start with a giant rewrite.

Extract only when a component is being actively worked on.

A reasonable target structure is:

```text
src/
├── components/
│   ├── app/
│   │   ├── AppHeader.tsx
│   │   ├── AppNavigation.tsx
│   │   └── ProductGraphSelector.tsx
│   │
│   ├── graph/
│   │   ├── GraphCanvas.tsx
│   │   ├── GraphToolbar.tsx
│   │   ├── GraphSearch.tsx
│   │   ├── GraphInspector.tsx
│   │   └── GraphSettings.tsx
│   │
│   ├── analysis/
│   │   ├── InventoryView.tsx
│   │   ├── ImpactAnalysisView.tsx
│   │   ├── ProcessResultsView.tsx
│   │   ├── ContributionView.tsx
│   │   └── SankeyView.tsx
│   │
│   └── ui/
│       └── shadcn components
```

Benefits:

- easier responsive styling
- smaller agent context
- better React Grab source targeting
- reduced conflict inside `App.tsx`
- easier testing

Do not change business logic merely to achieve this structure.

---

# 21. shadcn Working Rules for the Agent

When making UI changes:

1. Inspect `src/components/ui` first.
2. Use `npx shadcn@latest info` when repository configuration is uncertain.
3. Use shadcn MCP for discovery.
4. Use the shadcn CLI for actual deterministic component operations.
5. Read component docs before using unfamiliar APIs.
6. Preview CLI changes where supported.
7. Inspect all generated file changes.
8. Do not overwrite customized components blindly.
9. Prefer existing project conventions to stock examples.
10. Do not add an additional UI framework.

---

# 22. Browser Tooling Working Rules

When investigating a responsive issue:

```text
1. Reproduce it in the actual browser.
2. Use Chrome DevTools to inspect layout/computed CSS.
3. Use React Grab if identifying the source component is ambiguous.
4. Fix the smallest appropriate surface.
5. Exercise the workflow with Playwright.
6. Re-test the supported viewport set.
```

Do not infer a responsive fix solely from static source if the browser can demonstrate the actual layout.

---

# 23. Responsive Definition of Done

A responsive change is not complete until relevant items below pass.

```text
□ 375 × 812 tested
□ 768 × 1024 tested
□ 1024 × 768 tested
□ 1440 × 900 tested
□ 1920 × 1080 spot checked

□ no page-level horizontal overflow
□ controls remain reachable
□ no accidental text clipping
□ dialogs remain in viewport
□ popovers remain in viewport
□ graph remains usable
□ selected-node details remain accessible
□ tables scroll within their own container
□ touch controls are reasonable
□ keyboard navigation still works
□ dark theme checked
□ light theme checked where affected
□ browser console has no new errors
□ npm run build passes
□ npm run lint passes
□ existing Playwright tests pass
□ new responsive tests pass
```

---

# 24. Suggested Pull Request Sequence

## PR 1 — Agent Foundations

Scope:

- official shadcn Skill
- project-specific Product Graph Editor skill
- shadcn MCP configuration
- React Grab setup
- documentation

No responsive UI changes.

---

## PR 2 — Browser and Test Tooling

Scope:

- Chrome DevTools agent integration
- Playwright agent skills/CLI
- responsive Playwright projects/helpers
- initial responsive smoke tests

No major UI redesign.

---

## PR 3 — Responsive Shell

Scope:

- header
- product selector
- primary/result navigation
- application spacing

Preserve desktop layout.

---

## PR 4 — Responsive Graph

Scope:

- graph viewport
- graph search
- toolbar
- inspector
- responsive Sheet/Drawer
- graph settings
- phone/tablet interaction

This is the highest-priority UI PR.

---

## PR 5 — Responsive YAML Editor

Scope:

- editor header
- paste/upload actions
- textarea sizing
- editor footer
- status/error area
- Calculate action

---

## PR 6 — Responsive Analysis Views

Scope:

- Results
- Inventory
- Impact
- Process Results
- Contribution

Preserve semantic tables.

---

## PR 7 — Responsive Sankey + Cleanup

Scope:

- Sankey controls
- Sankey settings
- selection details
- final responsive cleanup
- documentation updates

---

# 25. First Task for GPT-5.6 in the Codespace

Give the coding agent this instruction before allowing it to modify the responsive UI:

```text
Read plan/agent-ui-responsive-plan.md and inspect the current repository.

First verify the current stack, existing shadcn setup, existing Skillshare setup,
MCP installer, Playwright configuration, and current UI structure.

Do not modify responsive UI yet.

Implement only the agent-tooling foundation described in Phases 1–6 where it
can be done safely and without changing production application behavior.

For every external tool, verify its currently supported installation/configuration
syntax rather than blindly following commands in the plan.

Do not replace the existing Playwright suite.

Do not replace the existing shadcn setup.

Do not introduce another component library.

After the tooling foundation is working, use Chrome DevTools and Playwright to
perform the responsive audit described in Phase 11.

Produce the responsive audit as a markdown document before changing application
layout.

Stop after the audit and report:
- tooling installed/configured
- files changed
- commands run
- test results
- responsive problems found
- proposed order of UI changes
```

This deliberately separates **tool installation/audit** from **UI modification**.

---

# 26. Second Task for GPT-5.6

After reviewing the audit:

```text
Implement the responsive work from plan/agent-ui-responsive-plan.md one surface
at a time.

Start with the application shell and main graph.

Preserve desktop behavior and appearance where practical.

For tablet/phone layouts, prioritize the graph viewport. Do not keep a fixed
desktop side inspector if it materially reduces graph space; use an appropriate
shadcn Sheet or Drawer instead.

Use shadcn MCP for component discovery and the shadcn CLI for deterministic
component operations.

Use Chrome DevTools to diagnose layout issues and Playwright to verify each
affected workflow.

Do not perform unrelated refactors.

After each surface:
- run build
- run lint
- run relevant Playwright tests
- verify responsive target viewports
- summarize the changes before proceeding
```

---

# 27. Key Architectural Decisions

The following decisions should remain stable unless the implementation reveals a strong technical reason to change them.

### CLI vs MCP

Use both.

```text
shadcn Skill -> teaches conventions
shadcn MCP   -> component/registry discovery
shadcn CLI   -> deterministic project operations
```

MCP is not a replacement for the CLI.

### Graphs

Keep React Flow / XYFlow.

Do not replace the graph engine as part of responsive work.

### Tables

Keep real tables for LCA data.

Use contained horizontal scrolling instead of automatically replacing them with cards.

### Desktop

Do not redesign desktop merely for the sake of redesign.

Responsive work should mostly add alternate behavior at narrower breakpoints.

### CSS

Do not perform a wholesale CSS-to-Tailwind rewrite.

### Testing

Use the browser and Playwright as part of implementation, not merely as a final verification step.

---

# 28. Final Target

The desired end state is:

```text
                Product Graph Editor
                         |
            React + Tailwind + shadcn
                         |
       +-----------------+-----------------+
       |                 |                 |
 shadcn Skill       shadcn MCP        shadcn CLI
       |                 |                 |
       +-----------------+-----------------+
                         |
                   Coding Agent
                         |
       +-----------------+-----------------+
       |                 |                 |
   React Grab      Chrome DevTools      Playwright
       |                 |                 |
       +-----------------+-----------------+
                         |
             Responsive implementation
                         |
        +----------------+----------------+
        |                |                |
      Phone            Tablet          Desktop
     375px             768px+          1440px+
```

The result should be an application that is easier for coding agents to understand, easier for them to verify, and substantially more usable across device sizes without sacrificing the existing desktop experience.
