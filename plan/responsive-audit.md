# Responsive UI Audit

**Recorded:** August 9, 2026
**Branch:** `agent-ui-responsive`
**Scope:** evidence and tooling only; no responsive UI changes are included in this audit

## Evidence

The repository-owned Playwright harness exercises five named projects:

| Project | Viewport |
| --- | --- |
| phone | 375 × 812 |
| tablet portrait | 768 × 1024 |
| tablet landscape | 1024 × 768 |
| desktop | 1440 × 900 |
| large desktop | 1920 × 1080 |

The initial shell smoke test passes at all five sizes: the app loads, the graph renders, and the document does not acquire page-level horizontal overflow. Workflow checks cover graph controls, the node inspector, YAML editing, analysis tables, global settings, and Sankey settings. Known responsive gaps are represented as narrowly scoped `fixme` contracts so the tooling baseline stays green until their implementation lands.

## Prioritized findings

### P0 — Phone navigation is not operable

At 375 px, the primary and result view switchers extend beyond the viewport. Playwright can resolve the `Editor` control but cannot click it because it is outside the viewport. The same layout makes result views such as Sankey unreachable by ordinary pointer interaction.

Start here because this blocks every non-graph workflow on a phone. Reflow or progressively disclose the two switcher groups while preserving their radio semantics and keyboard behavior.

### P0 — Global settings disappear below desktop width

The only global settings trigger is hidden by `.top-actions button:first-child { display: none; }` at widths up to 900 px. This removes theme and number-format settings entirely on phone and tablet portrait.

Keep the settings action available at every viewport, even if its label is reduced to an icon or moved into a compact navigation surface.

### P1 — Graph settings overflow the phone viewport

At 375 px, the graph settings popover reaches approximately x=402, about 27 px beyond the right edge. Its fixed 330 px width, placement beside the left toolbar, and side offset leave insufficient room.

Use a collision-safe small-screen presentation such as a Sheet or Drawer, or constrain and reposition the popover. The graph toolbar and inspector should remain independently usable.

### P1 — The phone inspector leaves too little graph space

The narrow media rule keeps a 270 px inspector while `.graph-viewport.has-inspector` reserves 322 px. On a 375 px screen, that reduces the graph viewport to roughly 53 px before accounting for other controls. The existing desktop visual suite also records a selected-node/inspector overlap failure.

Present node details as an overlay Sheet or Drawer on narrow screens instead of permanently shrinking the graph viewport. Preserve selected-node visibility and the current viewport transform.

### P1 — YAML editing needs a deliberate narrow layout

Once the phone navigation blocker is removed, the editor still uses fixed absolute insets and a single-row header/footer. The title, explanatory copy, Paste action, Upload control, status, and Calculate action compete for a narrow row.

Stack or wrap the header and footer controls, retain a useful textarea height, and keep file upload and Calculate keyboard accessible.

### P1 — Sankey settings need phone-safe placement

The chart picker has a fixed width of 360 px and starts 72 px from the left, so its nominal right edge is 432 px on a 375 px viewport. Tablet portrait and larger workflow checks pass.

Use the same narrow-screen overlay pattern chosen for graph settings and preserve chart-type, process-limit, and category controls.

### P2 — Dense result tables are contained, but require touch review

Inventory, impact, process-result, and contribution table wrappers stay within the document viewport at all five sizes and already provide local overflow containers. Keep the semantic table layout rather than converting the data to cards.

During implementation, verify sticky headers, scroll affordance, column resize handles, and touch/pointer behavior. The baseline visual suite already records unrelated failures in some resize and contribution interactions.

### P2 — Desktop behavior must remain the compatibility baseline

The 1024, 1440, and 1920 workflow contracts pass for the audited surfaces. Responsive changes should be expressed through narrow breakpoints and shared overlay primitives without changing the established desktop information density.

## Recommended implementation order

1. Reflow the application header and view navigation so every view and global settings remain reachable.
2. Introduce a shared narrow-screen Sheet/Drawer pattern for graph settings, the node inspector, and Sankey settings.
3. Reflow the YAML editor header and footer.
4. Tune the graph and Sankey canvases around compact controls.
5. Validate table scrolling and resize interactions on touch-sized viewports.
6. Remove each `fixme` only when its contract passes at the affected viewport.

## Exit criteria for responsive implementation

- `npm run build` and `npm run lint` pass.
- `npm run test:responsive` passes with no responsive `fixme` entries remaining.
- The 20 previously passing visual tests continue to pass.
- The five failures in `plan/responsive-baseline.md` do not expand and are fixed or explicitly tracked.
- No screenshot baseline is updated without human visual review.
