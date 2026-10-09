# Plan: responsive version 2 (phone and tablet)

8 October 2026. Branch `responsive-version-2`. Covers issue #80.

This plan starts fresh from how the app looks today. It does not build on the
earlier responsive plans in `plan/`.

## Sizes

The plan uses the three sizes from `playwright.responsive.config.ts`.

| Size | Test viewport | Width range | Layout |
| --- | --- | --- | --- |
| Phone | 375 × 812 | 620px and below | New phone layout |
| Tablet | 768 × 1024 | 621–900px | New tablet layout |
| Desktop | 1440 × 900 | 901px and up | **Unchanged.** This is the reference. |

These are the CSS breakpoints the app already uses (`max-width: 620px`,
`max-width: 900px`), so no new breakpoints are needed.

## How it looks today

I checked every main screen at all three sizes in a browser: welcome, graph, a
selected activity, graph settings, chat, Edit, Results, Impact analysis, Sankey,
Sankey settings and the File menu. No page scrolls sideways at any size, and
desktop looks right. Phone and tablet have the problems below.

### Both phone and tablet

1. **Two header bars.** A top bar (logo, settings, Log out, avatar) sits above a
   second card with the model name, File and a row of 8 view tabs: Edit, Graph,
   Results, Inventory, Impact Analysis, Process Results, Contribution, Sankey Graph.
   Desktop has one bar with File, Edit, Graph and a Results menu. Together the two
   bars take about 150px.
2. **The Chat tab covers the content.** The sideways "Chat" tab on the right edge
   sits on top of the view tabs and the page below them.
3. **Activity details cover the tools.** Selecting an activity opens a "Node
   details" panel over the left of the screen. It covers the graph toolbar and,
   on phone, the whole screen and the view tabs.
4. **The Sankey summary card covers the graph.** The "Impact category" card in the
   bottom-left sits on top of the bottom Sankey nodes.
5. **Two menus can be open at once.** With Sankey settings open, opening the File
   menu leaves the settings panel open underneath.

### Tablet only

6. **The view tabs are cramped.** All 8 tabs share one row, so "Impact Analysis",
   "Process Results" and "Sankey Graph" wrap onto two lines.
7. **Opening chat breaks the header (the #80 screenshot).** Chat takes half the
   screen as a side-by-side panel. The tab row is squeezed into the other half and
   the labels draw on top of each other ("InventoryCo…", "File" over "Impact
   Analysis").

### Phone only

8. **Some views are hidden.** The tab row scrolls sideways and the last tabs are
   cut off at the edge ("P…"), with no hint that there is more.
9. **Graph settings can't be reached with an activity selected.** The details
   panel covers the screen. In the browser test, the Graph settings button could
   not be clicked until the panel was closed.
10. **The graph is too small to read.** The Jacket graph runs left to right, so
    fitting it to a 375px-wide screen makes the activity cards unreadable.
11. **Analysis views start under the header.** On Impact analysis, the title is
    hidden behind the header card. "Sub-group by" wraps onto three lines, and the
    "Don't show <" box is cut off at the right edge.
12. **The Structure/Scaled switch is large** for a phone and sits at the bottom
    where the thumb rests.

Chat on phone already works: it opens full screen with its own close button.

## Target design

### Tablet (621–900px): the desktop layout, made narrower

Tablet should look and work like desktop, so there is one design to learn and
less code to maintain.

- **One header bar, the same as desktop:** logo, model name (shortened with "…"
  when long), File, Edit, Graph, a **Results ▾ menu** for the 6 result views,
  settings, and the avatar. Log out moves into the avatar menu. This removes the
  second bar and the 8-tab row (fixes 1, 6, 7).
- **Chat opens over the page from the right**, at most 420px wide. It no longer
  splits the screen, so the header and the view underneath keep their size
  (fixes 7). Close it from its own button.
- **The Property Editor docks on the left like desktop**, about 280px wide,
  closable to a folder tab. The graph and its toolbar use the space to its right,
  so nothing is covered (fixes 3).
- **The Chat and Properties tabs sit in the page margin**, as on desktop, not on
  top of the content (fixes 2).
- **The Sankey summary card collapses** to a small chip showing the category and
  total. Tapping it opens the full card (fixes 4).

### Phone (620px and below): built for one hand

- **Top bar:** logo, model name, File, settings and avatar, in one slim row.
- **Bottom tab bar** with four tabs: **Edit, Graph, Results, Chat.** Results opens
  a list of the 6 result views (the same list as the desktop Results menu).
  Every view is one or two taps away and nothing is cut off (fixes 1, 8). Chat stays full screen.
- **Activity details open as a bottom sheet.** It starts at half height and can be
  dragged up to full height. The graph and toolbar above it stay usable, and
  tapping another card switches the sheet to that activity (fixes 3, 9).
- **Graph settings and Sankey settings also open as bottom sheets.**
- **The graph runs top to bottom on phone.** Use the vertical orientation by
  default on phone so the cards are readable after fit-to-screen. This is not
  saved as the model's setting (fixes 10).
- **Toolbar:** keep the horizontal bar but drop zoom in and zoom out, since
  pinching does that. Move the Structure/Scaled switch into the toolbar as one
  toggle button (fixes 12).
- **Analysis views:** start below the top bar. Stack the controls (Sub-group by,
  Don't show) on their own rows. Tables keep sideways scrolling inside their box,
  with the first column fixed so row names stay visible (fixes 11).
- **Sankey summary card:** collapsed chip, as on tablet (fixes 4).

### All sizes

- Opening a menu or panel closes any other open one (fixes 5).
- Desktop must not change. The desktop visual tests are the check for that.

## Stages

Each stage is checked in a browser at 375, 768 and 1440px, then committed.

1. **Header.** Tablet gets the single desktop-style bar with the Results menu.
   Phone gets the slim top bar and the bottom tab bar. Log out moves into the
   avatar menu. The Chat and Properties tabs move into the margin.
2. **Chat.** Opens over the page on tablet instead of splitting it. Phone is
   unchanged.
3. **Property Editor.** Docked and closable on tablet; bottom sheet on phone.
4. **Graph on phone.** Vertical by default, slimmer toolbar with the
   Structure/Scaled toggle, graph settings as a bottom sheet.
5. **Results and analysis views.** Content starts below the header, controls
   stack on phone, first table column fixed.
6. **Sankey.** Collapsible summary chip and, on phone, settings as a bottom sheet.
7. **One menu at a time,** then clean up unused CSS from the old narrow layout.

## Tests

Run with `npm run test:responsive` (phone, tablet and desktop) and
`npm run test:visual` (desktop).

New checks at phone and tablet:

- Every view can be opened by tapping, and its control is fully on screen.
- The header never overlaps the view below it, with chat open or closed.
- Selecting an activity leaves the graph toolbar and Graph settings clickable.
- Every popover, menu and sheet stays inside the screen.
- The Sankey summary does not cover any Sankey node while collapsed.
- Only one menu or panel is open at a time.

Existing tests that check the 8-tab row or the side-by-side chat at tablet size
need rewriting. Any screenshot that changes is looked at before its baseline is
updated, and desktop screenshots should not change at all.

## Questions to settle before starting

1. **Phone navigation:** bottom tab bar (this plan) or a menu button in the top
   bar? The tab bar is quicker to use; the menu leaves more room for the graph.
2. **Tablet Property Editor:** docked like desktop (this plan) or an overlay that
   slides in? Docked never covers the graph but leaves about 490px for it at
   768px wide.
3. **Phone graph direction:** is switching to top-to-bottom on phone acceptable,
   or should it keep the model's own direction?

## Not in this plan

- Any change to the desktop layout.
- Landscape phones. They fall into the tablet layout by width; check them once
  the tablet layout is done.
- Touch gestures beyond what React Flow already does (pinch zoom, drag to pan).
