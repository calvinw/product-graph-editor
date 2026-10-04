# Plan: layout rearchitecture (chat left, docked Property Editor, graph never covered)

4 October 2026. Branch `issues-66-73-cards-editor`. Requested by calvinw.

## Goal

At desktop widths (above 900px):

- The navbar has its own row. Nothing sits underneath it.
- The AI chat is on the **left**, under the navbar. It can be opened, closed and resized.
- The **Property Editor is always shown**, docked on the right of the Graph view. It can be
  collapsed to a narrow strip and resized.
- The **Structure / Scaled switch moves into the Property Editor**.
- The graph canvas gets exactly the space between the chat and the editor. It never
  extends under the navbar, the chat or the editor, and fit-to-screen fits that space.

```
┌──────────────────────────── navbar (own row) ───────────────────────────┐
├──────────────┬────────────────────────────────────────┬─────────────────┤
│ Chat         │ Graph canvas                           │ [Structure|Scaled]
│ (left;       │ - only this area                       │ [Details|Scen.] │
│ open/close;  │ - graph toolbar floats inside it       │  tabs only in a │
│ resizable    │ - fit-to-screen uses exactly this area │  scenario edit  │
│ from its     │                                        │  (resizable     │
│ right edge)  │                                        │  from left edge;│
│              │                                        │  collapsible)   │
└──────────────┴────────────────────────────────────────┴─────────────────┘
```

## Decisions (agreed 4 Oct)

1. With nothing selected, the editor shows "Select an activity to see its details" and a
   short model summary: model name, number of activities and connections, and
   calculation status (calculating / results current / not calculated). The
   Structure/Scaled switch sits at the top of the editor whether or not anything is
   selected.
2. The editor is collapsible. Collapsed, it becomes a narrow strip (~44px) holding an expand
   button and the Structure/Scaled switch as two icon buttons, so the switch is always
   reachable. The collapsed state is remembered (localStorage, try/catch).
3. Chat keeps its 410px default width and stays resizable (240px minimum; the canvas
   keeps at least ~320px).

Defaults I'll use unless told otherwise:

- Clicking a card while the editor is collapsed **does not** expand it. Collapsing is
  a deliberate request for space. The card is still selected, and the strip shows a dot
  meaning "details available".
- **Scenario edits use tabs (agreed 4 Oct):**
  - While a scenario edit is active, the editor shows two tabs, **Details | Scenario**.
    No tabs appear otherwise.
  - When a scenario starts, the editor switches to **Scenario**: the impact scores,
    category switches, and Reset / Save to File (today's ScenarioPanel content).
  - The Scenario tab shows the number of changed inputs ("Scenario · 2").
  - Clicking a card switches to **Details**; switching back is one click.
  - Reset or Save ends the scenario; the tabs go and Details returns.
  - The Structure/Scaled switch stays above the tabs.
  - If the editor is collapsed when a scenario starts, it **expands**. That is the one
    exception to "clicking doesn't expand", because otherwise a live scenario would
    have no visible Reset or Save.
  - This replaces this morning's "close the editor when a scenario starts".
- The editor appears on the **Graph** view only. The Edit, Results and Sankey views use
  the full width between the chat and the window edge.
- **900px and below is unchanged** (tablet and phone, #80, deferred). There, the editor
  keeps today's open-on-click overlay and chat stays full-screen on phones.

## What changes

### App shell (`AppContent` in `src/App.tsx`, `src/index.css`)
- Today: `.app-shell` is a flex row of [main pane | chat pane on the right]. At ≥901px
  `.topbar` is `position: absolute` and floats over the workspace. Every view works
  around it with hard-coded offsets (`inset: 108px 28px 28px`, `.graph-toolbar { top: 168px }`,
  `.inspector { top: calc(104px + …) }`, `.scenario-panel` 104px, …).
- New: `.app-shell` is a grid with rows `[navbar] [body]`, and the body has columns
  `[chat] [workspace]`. The navbar keeps its pill styling inside its own row (margin
  included in the row height), so it looks the same but no longer overlaps anything.
- Remove the ≥901px offset workarounds; views lay out within their grid cell
  (`inset: 18px` or similar).

### Chat (`src/components/AiChatPanel.tsx`)
- `.ai-chat-pane` moves to the first column of the body (left, under the navbar).
- The resize handle moves to the chat's **right** edge, with its drag direction inverted.
  Keyboard resizing works the same way (Left narrows, Right widens) with the arrows
  inverted to match.
- The open tab (`.ai-chat-edge-tab`) moves from the right edge to the left edge.
- Existing behaviour stays: stored width, open/close, and full-screen at ≤620px.

### Graph pane: canvas + docked rail (`GraphCanvas`, `Inspector`, `ScenarioPanel`, `App.tsx`)
- In the Graph view, the workspace becomes a grid with columns `[canvas] [rail]`. The rail
  width is `--rail-width` (the existing resize handle and stored width), or ~44px when
  collapsed.
- The rail is one column: the Structure/Scaled switch, then (during a scenario) the
  Details | Scenario tabs, then the active tab's content. The scenario content moves from
  the separate docked `ScenarioPanel` into a tab. Its stacked layout,
  `--scenario-panel-height` and its own resize handle go away.
- **Property Editor:**
  - Always rendered on the Graph view. Remove the open/close slide animation, the
    Close button, `is-open`, `inert`/`aria-hidden` toggling, and `lastSelectedRef`.
  - Remove the floating/drag code added earlier today: the `is-floating` style, the
    header grip, the `property-editor-position` storage, and the floating-allowed media
    hook. `useDraggablePosition` keeps its `anchor` option (harmless) or reverts to
    left-only; decide in review.
  - Add a collapse/expand button in the editor header and the collapsed strip described
    above.
- **Structure/Scaled switch:** move it from `.graph-mode-toolbar` (bottom-left of the
  canvas) to the top of the rail. Keep the same accessible names ("Structure Graph",
  "Scaled Graph") and `aria-pressed`, so tests and the AI tool (`viewTools.ts`, which
  calls `showGraphMode` and not the button) keep working.
- **Canvas:** React Flow fills only its cell. Remove `.graph-viewport.has-inspector`
  and the `inspectorOpen` prop, which existed to inset the canvas for the rail.
- **Remove the "slide the graph to uncover the clicked card" effect** in `App.tsx`. The
  editor can no longer cover the graph.
- **Remove the "close the editor when a scenario starts" effect** (commit 5c90778).
  Scenario edits switch to the Scenario tab instead.
- Fit-to-screen: the existing ResizeObserver refit when the chat opens or closes stays.
  Also refit when the rail collapses or expands. Resizing the rail itself should not
  refit (it would fight the drag); React Flow keeps the current transform.

### Other views
- Edit (YAML), Results and the analysis tables, and Sankey: drop the ≥901px `108px`
  offsets and use the workspace cell. The Sankey toolbar and chart picker offsets get the
  same treatment.

## Stages (each checked in a browser at 1024, 1280 and 1440px, then committed)

1. **Shell grid + navbar row.** Navbar in its own row; views lose the 108px workaround.
   Check: nothing under the navbar in any view; screenshots reviewed.
2. **Chat on the left.** Move the pane, the edge tab and the resize handle direction.
   Check: open/close/resize, the canvas refits, ≤620px full-screen unchanged.
3. **Docked rail + always-on editor.** Canvas and rail grid, editor always rendered,
   empty-state summary, resize, collapse with remembered state. Remove the
   floating/drag/close code and the uncover effect.
4. **Structure/Scaled switch into the rail**, including the collapsed-strip icons.
   Remove `.graph-mode-toolbar`.
5. **Scenario tab.** Details | Scenario tabs during a scenario, auto-switch and
   auto-expand on start, count badge, card click switches to Details, tabs gone after
   Reset or Save; the "close editor on scenario" effect removed.
6. **Clean-up and docs.** Remove dead CSS, update CLAUDE.md counts, and update this plan
   and `2026-10-04_open_issues.md` (#66 is fully superseded by this layout).

## Tests to rewrite or add

About 57 references across `app.visual.spec.ts` (34), `ai-chat.responsive.spec.ts` (12),
`assistantEdit.visual.spec.ts` (4), `multiSelect.visual.spec.ts` (4) and
`workflows.responsive.spec.ts` (3). The main ones:
- **Removed:** "Property Editor can be moved…", "opening the Property Editor over the
  clicked card slides the graph…", "closing the property editor does not move the
  viewport…", "starting a scenario edit closes the Property Editor", "opening the inspector
  keeps the selected node visible". These describe behaviour that no longer exists.
- **Rewritten:** "activity cards do not expand; a click opens…" (now: a click shows the
  details in the docked editor); the Property Editor resize test (the canvas width
  follows the rail); multi-select tests that use "Close property editor" or expect the
  editor to be closed; chat resize tests (handle on the right edge, direction inverted).
- **New:**
  - the editor is visible with nothing selected and shows the summary;
  - collapse/expand, with the state remembered after a reload and the switch usable
    while collapsed;
  - the Structure/Scaled switch works from the rail;
  - scenario tabs: a scenario start switches to Scenario (expanding a collapsed editor),
    the badge counts edits, a card click switches to Details, and Reset or Save removes
    the tabs. The existing scenario tests (category switches, Save to File) move to the
    tab;
  - **no overlap**: at 1024/1280/1440px, with chat open and closed and the rail
    collapsed and expanded, the React Flow pane rectangle does not intersect the navbar,
    chat or rail, and fit-to-screen keeps every node inside the pane.
- Every desktop reference screenshot changes. Each old/new pair is reviewed before
  baselines are updated.

## Risks and notes

- **This reverses work from earlier today** (floating movable editor, uncover slide,
  close-on-scenario). That's intended; the code goes rather than being left unused.
- Wide screens are fine, but at 901–1100px a 410px chat plus a 286px rail leaves ~200–400px
  of canvas. The chat and rail maximums keep at least ~320px of canvas, and the rail can
  be collapsed. This needs checking at 1024px with chat open.
- The #79 navbar fix (truncation, compact items) carries over unchanged. Only the bar's
  positioning changes.
- The #73 spacing / fit-margin work is in `git stash` and is unaffected. It is worth
  revisiting after this, because the canvas size and so the default zoom will change.

## Out of scope

- Layouts at 900px and below (#80).
- Card size and spacing (#73, stashed).
- Any change to what the Property Editor shows for a selected activity, apart from
  adding the switch and the empty state.
