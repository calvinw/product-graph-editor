# Plan: the nine open issues assigned to elenachoi1

Issues #68-#76, all filed 27-28 August 2026, none labelled.

Status as of 30 August 2026: seven delivered and closed, two still open.

- #75, #72, #68, #70, #71, #74 shipped in 37eab7c.
- #69 shipped in 571da23, as a per-server "Run without asking" setting that is
  ticked by default rather than as a single global switch.
- #73 and #76 remain open. Both need a decision from the issue's author before
  they can be coded; see the sections below and the questions at the end.

Note: the login is `elenachoi1`, not `elena_choi`.

---

## Summary

| # | Issue | Area | Size |
|---|---|---|---|
| 75 | Remove the "scores are exact" line | ScenarioPanel | trivial |
| 72 | Graph edges too thin | yamlGraph / useGraphModel | trivial |
| 68 | Title slides over the File menu | index.css | small |
| 70 | Tool "complete" jumps to a new line | index.css | small |
| 69 | MCP tools always ask permission | mcpRegistry | small, needs a decision |
| 71 | Clear Session | FileMenu + persistence | medium |
| 76 | Sort biosphere exchanges alphabetically | Inspector + ProcessNode | medium |
| 74 | History as a File submenu | App + HistoryPanel | medium |
| 73 | Activity cards too small | index.css + Sankey | medium, needs a decision |

Suggested order: the four trivial/small fixes first as one pass, then #71, #76,
#74, and #73 individually.

---

## #75 — Remove the "scores are exact" line

`src/components/graph/ScenarioPanel.tsx:173`

```tsx
<span>Scores are exact. Inventory, contributions and Sankey need a calculation.</span>
```

Delete the span, and its wrapper if it holds nothing else.

Related but **not** in scope: `src/components/RealtimeView.tsx:154` carries a longer
variant of the same sentence ("Previewed scores are exact for background-input
changes…"). The issue names the Scenario Editor only. Ask before touching Realtime.

## #72 — Graph edges too thin

Two places set `strokeWidth: 1.5`:

- `src/lib/yamlGraph.ts:306` — `{ stroke: "#343941", strokeWidth: 1.5 }`
- `src/hooks/useGraphModel.ts:246` — `{ stroke: "#2563eb", strokeWidth: 1.5 }`

Raise both to the same value; **2.5 suggested**. Keep them equal so the highlighted
edge does not change weight when selected. `markerEnd` at `yamlGraph.ts:309` is
16×16 and may want a proportional bump.

Sankey edges are computed from flow volume (`SankeyView.tsx:314`) and are unrelated —
leave them.

## #68 — Title slides over the File menu

Root cause, `src/index.css:261`:

```css
.navbar-model-title { position: absolute; left: 0; width: 132px; ... }
```

`.desktop-navbar` (`:244`) is `position: relative` with `justify-content: center`. The
model title is taken out of flow, so the centred menu group slides underneath it as the
window narrows, and File ends up on top of the title.

Fix: put the title back in flow — a flex child with `flex: 0 1 auto`, `min-width: 0`,
`overflow: hidden`, `text-overflow: ellipsis` — and let the menus sit beside it, or keep
it absolute but reserve the space with `padding-left` on `.desktop-navbar`. **The first
is cleaner**; it drops the fixed `132px` and lets the title truncate.

Check `.brand-study-title` (`:240`, `max-width: 190px`) at the same time — it is the
other title in the header and truncates correctly today.

Verify at 1440, 1024, and around 900px where the overlap appears. Covered by
`tests/responsive/shell.responsive.spec.ts`; add an assertion that the title's right
edge is left of the File trigger's left edge.

## #70 — Tool "complete" jumps to a new line

The `<details><summary>` at `AiChatPanel.tsx:391` renders
`{segment.name}{segment.error ? " · error" : " · complete"}` as one text run, so the
markup is right and this is pure layout: `.ai-chat-tool` is `width: 92%` (`index.css:314`)
and the block reflows once the assistant's text arrives beside it.

Fix in `.ai-chat-tool summary`: `display: flex; align-items: center; gap: 6px;
white-space: nowrap;` and let the name truncate rather than wrap.

**This overlaps the AI Elements migration** (`plan/ai-elements-migration.md`). `ToolHeader`
lays the name and a status badge out in a flex row and would fix this for free. If the
migration lands first, close #70 with it. If not, the CSS fix is two lines.

## #69 — MCP tools always ask permission

`src/ai/mcpRegistry.ts:72`, `requiresToolConfirmation()`. Today an MCP tool is confirmed
unless it declares `annotations.readOnlyHint: true`, a default chosen deliberately in
`plan/mcp-remote-tools.md`.

The issue asks to always allow. **This needs your decision, because it removes a safety
gate**, and remote MCP servers are user-configurable — a server added later can expose
destructive tools that would then run unprompted.

Three options:

1. **Always allow** — what the issue literally asks. One-line change; loses the gate.
2. **Remember the choice per tool** — a "Don't ask again for this tool" checkbox on the
   confirmation dialog, persisted per server+tool. Fixes the annoyance, keeps first-use
   review. **Recommended.**
3. **Per-server toggle in settings** — "Trust this server", default off, in
   `McpServerSettings`. Coarser but very explicit.

Option 2 or 3 is a genuine feature; option 1 is a one-line change. Confirm before coding.

Note the confirmation is also what `ai-chat.responsive.spec.ts:135` exercises; whichever
option lands, that test needs updating.

## #71 — Clear Session

Session documents accumulate in `localStorage` and survive quitting the site.

Two keys hold session state:

- `product-graph-editor:workspace` — `src/lib/workspacePersistence.ts:16`
- `product-graph-editor:versions` — `src/lib/versionHistory.ts:62`

The chat panel owns three more (`chat-model`, `chat-width`, `chat-api-key`,
`AiChatPanel.tsx:57-59`). **Leave the API key alone** — clearing it would make "clear
session" silently log the user out of OpenRouter. Worth confirming whether chat *history*
should clear; I would say no, since the issue is about documents.

Work:

- Add a `clear-session` action to the reducer in `src/lib/modelWorkspace.ts` (there is no
  reset action today) that empties `sessionDocuments` and returns to the default
  template.
- Clear both storage keys.
- Add a **Clear Session** item to `FileMenu.tsx` directly under the `This session` label
  (`FileMenu.tsx:64`), inside the `sessionDocuments.length` guard so it only appears when
  there is something to clear.
- Guard it with an `AlertDialog` — it destroys unsaved work. `UnsavedChangesDialog.tsx`
  is the existing pattern.

## #76 — Sort biosphere exchanges alphabetically

Biosphere rows render in source order (effectively by volume) in two places:

- `src/components/graph/Inspector.tsx:71`
- the activity cards — `ProcessNode.tsx`, `.pg-biosphere`

The issue asks for sortable, not re-sorted, so add a control rather than changing the
default. Smallest version that satisfies it: a small toggle in the Property Editor's
biosphere section header, "Volume | Name", defaulting to Volume.

Decide whether the toggle also drives the activity cards or only the Property Editor. The
issue mentions both surfaces, so a shared piece of state is likely wanted — probably in
the graph store rather than local component state.

Sort by `item.label` with `localeCompare`.

## #74 — History as a File submenu

`HistoryPanel` is its own navbar item at `App.tsx:400`, beside `FileMenu` at `:385`.
There is a second instance for the mobile navigation at `:439`.

Move it to a `DropdownMenuSub` inside `FileMenu`, following the existing template
submenu (`FileMenu.tsx:55-60`) as the pattern.

Two complications:

- `HistoryPanel` is a panel with its own trigger, not a menu item. It either becomes
  submenu content or stays a panel opened *from* a File menu item. **The second is less
  disruptive** and keeps the diff and restore UI intact.
- Both the desktop and mobile call sites must move together.

`tests/visual/history.visual.spec.ts` has 13 tests that open history from the navbar;
all of their entry points shift. No screenshots are involved, so this is selector work.

## #73 — Activity cards too small

`.pg-node` (`src/index.css:544`) is `height: 48px`, `font-size: 19px`, pill-shaped.
`.sankey-process-node.pg-node.is-expanded` (`:486`) is `width: 300px; min-height: 94px`.

The issue says "humoungous, or much bigger", which is not yet a number, and the graph
nodes feed a dagre layout — enlarging them changes spacing, edge routing, and the default
zoom that `fitView` picks. **Needs a decision on target size**, ideally from a screenshot
at the default zoom.

Suggest starting at roughly 1.5× (height 48 → 72, font 19 → 24) and reviewing, rather
than picking a final number now. Sankey cards scale separately at `:486`.

Check the dagre `nodesep` / `ranksep` in `yamlGraph.ts` at the same time — enlarged nodes
with unchanged separation will look cramped.

This is the one item where all three responsive viewports need a real look, since bigger
cards cost the most at 375px.

---

## Verification

Per `CLAUDE.md`, run separately, expecting 115 unit / 62 responsive with 1 conditional
skip / 56 visual:

```bash
npm run build
npm run lint
npm run test:unit
npm run test:responsive
npm run test:visual
```

`npm run lint` currently fails on the untracked `ds-bundle/` directory, unrelated to any
of this; `npx eslint src tests` is clean.

Issues likely to move tests: #68 (shell responsive), #69 (ai-chat responsive), #74
(history visual), #73 (screenshot baselines across graph and Sankey — the only item here
that touches `tests/visual/__screenshots__/`).

---

## Decisions needed before coding

1. **#69** — always allow, remember per tool, or trust per server? (Recommend: remember
   per tool.)
2. **#73** — how much bigger, and confirm graph *and* Sankey.
3. **#76** — does the sort control drive the activity cards too, or only the Property
   Editor?
4. **#75** — leave the similar sentence in `RealtimeView.tsx:154` alone?
5. **#71** — clear chat history along with documents? (Recommend: no, and never the API
   key.)
