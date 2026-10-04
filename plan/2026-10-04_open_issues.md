# Plan: all open issues — 4 October 2026

There are 8 open issues, all filed by calvinw. The raw issue export, with comments, is
in `plan/issues_2026-10-04/issues.json`. This plan was written against `main` at
`bfdd3f4`.

The order is: quick wins first, then bugs, then the design work. #79 and #80 have the
same cause and are fixed together. So are #66 and #73.

**Revised 4 Oct after review:** Teams is hidden rather than finished (#78). #76 is
deferred. For #66: cards no longer expand, and the Property Editor stays hidden until an
activity card is clicked. The editor must be resizable.

| Order | Issue | Title | Size | Needs a decision? |
|---|---|---|---|---|
| 1 | #82 | Remove the Realtime pane | S | No |
| 2 | #78 | Teams — hide the feature, keep the code | S | No |
| 3 | #81 | Graph moves between Structure and Scaled | S–M | No |
| 4 | #79 + #80 | Navbar squashed when narrow / tablet / phone | M | No |
| — | #76 | Sort biosphere exchanges by name | S | **Deferred**, leave open |
| 5 | #66 + #73 | Remove expandable cards; editor opens on click, resizable; bigger cards | L | Card size only |

---

## 1. #82 — Remove the Realtime pane

The Realtime *pane* is `src/components/RealtimeView.tsx`. The scenario math in
`src/lib/realtimeScore.ts` is **not** pane-only: `graph/ScenarioPanel.tsx` and
`productGraphStore.ts` (`ScenarioOverrides`) also use it, and graph-native scenario
editing depends on it. Keep that file.

Remove:
- `src/components/RealtimeView.tsx`
- `src/App.tsx`: the import (l.30), `"realtime"` in `AnalysisView` (l.68), the Results
  dropdown entry (l.448), the toggle item (l.503), and the `view === "realtime"` branch (l.583)
- `src/state/productGraphStore.ts:21`: `"realtime"` from `ProductGraphView`. Map any
  persisted `"realtime"` view to `"graph"` on load, so old sessions don't open a blank pane.
- `src/ai/viewTools.ts:122`: the `realtime` view entry, so the AI chat can't switch to it
- `src/index.css:840-871`: the `.realtime-*` rules. First check that `ScenarioPanel`
  doesn't reuse any of them.
- Any tests or screenshot baselines that open the Realtime view

Then run `npm run build`, `npm run lint` and `npm run test:unit`.

## 2. #78 — Hide Teams; keep the code for later

**Decision (4 Oct):** remove Teams from the UI, but leave the implementation in place
so it can be finished later.

The only way into Teams today is the "Team room" field in the Global settings popover
(`src/App.tsx:698-702`), which opens `<TeamRoomDialog>` (rendered at `src/App.tsx:622`).

Plan:
- Add a feature flag, `TEAMS_ENABLED = false`, in a small `src/lib/features.ts`. Gate both
  the Settings field and the `<TeamRoomDialog>` render on it. Then turning Teams back on
  is a one-line change, and it doesn't depend on deleted JSX.
- Leave these untouched: `src/components/TeamRoomDialog.tsx`, `src/lib/teamRooms.ts`,
  the `.team-room-*` CSS, the `teamRoomOpen` state, and the Supabase migrations. Add a
  one-line comment above the flag that points to this plan.
- Check that no tests exercise the Teams UI. None were found in `tests/` when this was
  written.
- Keep #78 open, relabel it "later", and comment with a link to this section.

**Notes for when Teams comes back** (found while reading the code):
- The migration `supabase/migrations/20260914180000_add_team_room_owner_controls.sql`
  **was never applied** to the Supabase project. `rpc/delete_team_room` returns
  `PGRST202 Could not find the function`. Apply it before anything else.
- `list_team_rooms` doesn't return `invite_code`, so the owner loses the code once the
  dialog closes. Codes also expire after 24h with no way to regenerate one.
- Missing pieces: leaving a room, renaming a room, deleting shared files, refreshing
  member counts, and resetting `confirmDelete` when switching rooms.

## 3. #81 — Graph moves when switching Structure → Scaled — DONE 4 Oct

**Confirmed cause and fix:** `showGraphMode` rebuilt nodes without `measured`, so
`useNodesInitialized` flipped false → true and the measured-layout effect re-ran dagre
over the dragged positions. The fix carries `measured` over from the previous node. The
regression test "dragged activities keep their positions when switching between Structure
and Scaled Graph" failed before the fix (the card reset to its layout spot) and passes
after it.

Original analysis:

`showGraphMode` in `src/hooks/useGraphModel.ts:~703` already tries to keep positions
(`position: previous?.position ?? node.position`). The most likely cause is the
`useNodesInitialized` effect at l.89-97. `showGraphMode` passes brand-new node objects
that have no `measured` size, so React Flow reports "not initialized" and then
"initialized" again. That transition re-runs `layoutNodes` over every node and wipes
out the user's drag.

Fix:
- Only auto-relayout when **new node ids** appear, not when existing nodes are
  re-measured. One way: track the set of ids already laid out in a ref, and relayout
  only if the set grows. Another: carry `measured` over from the previous node in
  `showGraphMode`.
- Scaled cards also show amounts, so they may be a different size. Keeping the same
  top-left corner is acceptable. If the user still sees overlap, run
  `resolveNodeOverlaps` (already in `lib/layout`) instead of a full relayout.
- Check the reverse direction (Scaled → Structure) and the background-expansion path
  (l.639/664) the same way.

Test: add a unit test, or a Playwright step in the existing visual suite: drag a node,
toggle the mode, and check that its position hasn't changed.

## 4. #79 + #80 — Navbar squashed when the window is narrow, tablet, phone

I couldn't open the screenshots, because GitHub user-attachment URLs need a
browser session. This is from reading `src/index.css`.

There are two layouts, split at **900px**:
- **≥901px:** a single floating pill `.topbar`. It holds the brand, the model title
  (`.navbar-model-title`, `width: max-content; max-width: none`, which **never truncates**),
  File / Edit / Graph / Results, the status, Settings, Log out, and the user name + email.
  Nothing wraps or collapses, so between ~901px and ~1300px the items overlap. That's #79.
- **≤900px:** the portal navbar is hidden, and `.canvas-head .view-tabs` shows instead: the
  title, File, *and two toggle groups with 9 buttons* (Edit, Graph, Results, Inventory,
  Impact Analysis, Process Results, Contribution, Sankey Graph, Realtime). At tablet and
  phone widths these wrap into a stack under the topbar. That's #80.

Fix:
- Use one navigation model at every width. Below 900px, use the same File / Edit /
  Graph / Results ▾ dropdown that desktop uses, instead of the 9-button toggle row. That
  removes most of the width problem. (#82 removes one more button.)
- Let the model title truncate (`min-width: 0; overflow: hidden; text-overflow: ellipsis`)
  and give it a sensible `max-width`. Show the full title in a tooltip.
- Collapse the right side progressively. Hide the user name and email below ~1280px
  (avatar only). Fold Log out into an avatar menu. Show Settings as an icon only
  below ~1100px.
- On phones (≤620px): a single row with brand, a ☰ button that opens a sheet with
  File and the views, and the avatar.
- Read `plan/responsive-ui-plan.md`, `responsive-audit.md` and `responsive-baseline.md`
  first, and follow the `product-graph-editor-ui-development` skill (per CLAUDE.md).
- Verify at the CLAUDE.md viewports (375×812, 768×1024, 1440×900). Also check 1024 and
  1280 wide, because #79 lives between 901 and ~1300px. Use `npm run test:responsive`
  and `npm run test:visual`. Review the diffs before updating any baseline.

## Deferred — #76 Sort biosphere exchanges by name

**Decision (4 Oct):** leave this for now and keep the issue open. Once #66 removes card
expansion, biosphere rows appear only in the Property Editor (`Inspector.tsx:56`/`:71`).
The card list at `ProcessNode.tsx:106` goes away. So the sort only needs to live in the
editor. The smallest version is a "Volume | Name" toggle that sorts with `localeCompare`.

## 5. #66 + #73 — Remove expandable cards; Property Editor opens on click and is resizable

**Decision (4 Oct, revised):**
- The Property Editor stays **hidden by default**. A single click on an activity card
  opens it. Clicking the empty canvas closes it.
- Cards **no longer expand**. All detail lives in the Property Editor, so the card and
  the editor no longer repeat each other.
- The Property Editor **must be resizable**.

### What exists today
- The single-click-to-open behavior already exists: `inspectorOpen = selected !== null`
  (`App.tsx:111`), set by `onNodeClick` in `GraphCanvas.tsx:86-98`. Keep it, including
  the Cmd/Ctrl/Shift multi-select exception. Clicking the pane already closes it
  (`onPaneClick={clearNodeSelection}`).
- Expansion today comes from double-clicking (`GraphCanvas.tsx:99` → `toggleExpanded`),
  the "Expand all" / "Collapse all" toolbar buttons (`App.tsx:555-556` →
  `setAllExpanded`), and the `data.expanded` branch in `ProcessNode.tsx:69-73+`.

### Remove card expansion
- `GraphCanvas.tsx`: remove `onNodeDoubleClick` and the `toggleExpanded` prop.
- `App.tsx`: remove the Expand all / Collapse all toolbar group (l.554-557) and stop
  passing `toggleExpanded`/`setAllExpanded`.
- `ProcessNode.tsx`: remove the `expanded` rendering branch, the `expanded` field, and
  the per-input handles that only exist for expanded cards. Every card renders the
  compact form.
- `useGraphModel.ts`: remove `toggleExpanded` (l.609), `setAllExpanded` (l.643), and the
  `expanded` carry-over in `showGraphMode` (l.734, 745-746, 752). Check whether
  `targetExpandedInputRows`, `populateExpandedConnections` and `inputHandleIdFor` have
  any other callers before deleting them. Edges should always target the card's
  single input handle.
- **Background hydration:** today, expanding a background card calls
  `hydrateBackgroundNode`. The single click already calls it too (`GraphCanvas.tsx:97`),
  so nothing is lost. Confirm the Property Editor shows the hydrated inputs and outputs.
- **Keep Sankey as it is:** `SankeyView.tsx:31` uses the `.pg-node.is-expanded` *class*
  for its cards' styling. That isn't the expand feature, so keep those CSS rules (or
  rename the class to `.sankey-card`).
- Remove any AI-chat tools, tests or screenshot baselines that expand cards.
- The issue mentioned moving the Structure/Scaled switch into the editor. That isn't
  needed now the editor is hidden by default, so it stays in the toolbar.

### Make the Property Editor resizable
There's a pattern to reuse. `AiChatPanel.tsx:231-260` already has a resize handle that
works with both the pointer and the keyboard (`.ai-chat-resize-handle`). The editor's
width is already one CSS variable, `--rail-width` (286px default). It sizes both
`.inspector` (`index.css:671`) and the canvas inset `.graph-viewport.has-inspector`
(`index.css:428`), so the graph shrinks to match.
- Put a drag handle on the editor's left edge. Dragging it updates `--rail-width`,
  limited to about 260px minimum and about 50% of the viewport maximum.
- Arrow keys resize in 16px steps, Home/End jump to min/max, and double-click resets to
  the default. Use `role="separator"` with `aria-valuenow`.
- Store the width in `productGraphStore` and keep it in `localStorage` (wrapped in
  try/catch), so the editor reopens at the user's width.
- Turn off the `.inspector` `transform`/`top` transitions while dragging (a body class,
  as `is-resizing-ai-chat` does).
- If the AI chat panel is also open, cap the width so the canvas keeps at least ~320px.
- On phones (≤620px) the editor opens as a bottom sheet, resizable from its top edge.
  This ties into #79/#80.

### Bigger cards (#73)
Without expansion, the compact card is all the canvas shows, so it should be readable
at the default zoom.
- Start at about 1.5×: `.pg-node` height 48→72px, font 19→24px, and
  `NODE_WIDTH/NODE_HEIGHT` in `src/lib/layout.ts` (190×36) scaled to match. Increase dagre
  `nodesep`/`ranksep` the same amount. Raise `fitView`'s `maxZoom` (0.85 now).
- Sankey cards are sized separately; review them in the same pass.

### Tests
- Single click opens the editor and a pane click closes it. Cmd/Ctrl/Shift-click
  doesn't open it.
- Double-click does nothing, and the expand/collapse buttons are gone.
- Dragging and keyboard resizing respect the min/max limits, the width survives a
  reload, and the canvas inset follows the width.
- Background cards still hydrate on click.
- This branch moves the graph screenshot baselines. Review every diff before updating.

## Browser tests: sign-in switch and existing failures (4 Oct)

Before today the Playwright suites hadn't been able to run since Google sign-in was
added (14 Sep): every test stopped at the sign-in screen. The fix is a dev-server-only
`VITE_AUTH_DISABLED` switch in `AuthGate.tsx`. Only `playwright.base.config.ts` sets it.
`vite build` removes it, and `scripts/check-no-auth-bypass.mjs` (run by `npm run build`)
fails the build if it ever leaks into production.

The 26 `dark-*`/`light-*` application-view baselines were refreshed and reviewed by eye
against the old images. The differences are the signed-in top bar, plus app changes made
since 31 Aug (the History and Assistant buttons moved, Sankey label widths).

The four failing tests below also failed on untouched `main`. **All are now fixed (4 Oct):**
- `app.visual.spec.ts` "session files can be deleted": startup opens "Copy of Jacket", and
  picking Jacket again adds "Copy of Jacket (2)". The test now deletes both (with exact
  names) before checking that the session section is gone.
- `app.visual.spec.ts` "scenario impact categories": the Jacket result has no background
  links, so its edges were never draggable. The test now opens the broom template with a new
  fixture, `tests/fixtures/broom-lca-result.ts`. That fixture is a real `run_lca_base`
  response captured from lca.mathplosion.com, and it includes `background_link_intensities`.
- `shell.responsive.spec.ts` [phone, tablet]: the model title is a rename button at ≤900px.
  The test now looks for `button "Current model: …"`.
- `draggable-panels.responsive.spec.ts` "toolbar drag handle stays reachable" (flaky, about
  1 run in 3): it measured before the async `resize` event had re-clamped the toolbar. It
  now retries with `toPass`. It passed 30/30 with `--repeat-each=10`.

Current counts: unit 117 passed; visual 59 passed (58 plus the #81 test); responsive 69 passed + 3 skipped by
design. CLAUDE.md is updated to match.

## Suggested sequence

1. #82 (remove Realtime) and #78 (hide Teams behind a flag), the same day
2. #81
3. #79 + #80
4. #66 + #73 on its own branch: remove expansion, then the resizable editor, then card size
5. Look at #76 again afterwards

Each step: `npm run build && npm run lint && npm run test:unit`, then
`npm run test:visual` / `test:responsive` where the UI changed, and close the issue
with a reference to the commit.

## Decisions

Settled 4 Oct: hide Teams and keep the code; defer #76; cards no longer expand; the
Property Editor is hidden until a card is clicked, and it is resizable.

Still open:
1. **#73:** card size. The default proposal is 1.5×, reviewed from a screenshot.
