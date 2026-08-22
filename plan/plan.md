# Fix plan: 9 new issues (2026-08-21)

## Context

9 new issues were filed after the previous 20-issue pass shipped. Most are direct
follow-on feedback on that work (the chat panel redesign and the graph-toolbar
drag/select features). One (#66) is an open-ended design idea, not a scoped bug —
it's called out separately below rather than guessed at.

---

## Chat panel (5 issues)

1. **#60 Focus doesn't return to the prompt box after sending** — The composer
   `<textarea>` has `disabled={status === "streaming"}`
   (`AiChatPanel.tsx`); browsers blur a field the instant it's disabled, and
   nothing re-focuses it once streaming ends. Fix: in `send()`'s `finally`
   block, after `setStatus("idle")`, refocus `promptRef.current` on the next
   frame (same rAF pattern already used for the open-panel focus effect).

2. **#61 Composer sits flush against the bottom edge** — `.ai-chat-composer`
   (`index.css`) has `margin: 0 14px` — horizontal margin only, no bottom
   margin, and it's the second-to-last row of the sidebar's grid. Fix: add
   bottom margin (`margin: 0 14px 14px`).

3. **#51 Chat icons look oversized** — Confirmed pre-existing: the header
   icon buttons (`New conversation`/`Settings`/`Close` in `AiChatPanel.tsx`)
   render lucide's default 24px icon inside a 36px (`size-9`) button, which
   reads much larger than the reference app's compact look
   (`FIT Retail Index Chat`, ~16-18px icons snug against small text). Fix:
   pass explicit `size={16}` to `MessageSquarePlus`/`Settings2`/`X` and to
   the composer's `Square`/`ArrowUp` send icon.

4. **#62 "Assistant" pillbox + robot icon should go** — Replace the topbar
   `.ai-chat-trigger` pill button (Bot icon + "Assistant" label) with a
   slim tab flush against the right edge of the viewport (no icon, or a
   minimal chevron), visible only while the panel is closed, that opens the
   chat panel on click. This directly matches the issue's own suggested
   design ("just a small indicator... right against the right edge").

5. **#65 Show the active model outside Settings; don't simplify names** —
   Two changes: (a) add a small model-name readout to the chat panel header
   (`ai-chat-header`), next to the icon buttons, always visible whenever the
   assistant is open — no longer buried in the settings dialog; (b) change
   the `MODELS` labels in `AiChatPanel.tsx` from friendly names ("GPT-5.6
   Luna") to the raw OpenRouter ids ("openai/gpt-5.6-luna") in both the
   settings dropdown and the new header readout, per the issue's explicit
   list.

---

## Graph canvas (3 issues)

6. **#63 Resizing the browser window doesn't refit the graph/Sankey** —
   Confirmed: there's a `ResizeObserver` on the chat-panel's own width
   (`App.tsx`) that re-fits the graph, but nothing watches the actual
   browser `window` resize event, and `SankeyView.tsx` has no resize
   handling at all. Fix: add a `window "resize"` listener (rAF-debounced,
   matching the existing pattern) in both `GraphEditor` (App.tsx, reusing
   `fitView`) and `SankeyView.tsx` (reusing `fitSankey`).

7. **#64 Toolbar jumps to a different spot after a window resize, once
   dragged** — Root cause: `useDraggablePosition` stores an absolute
   `{left, top}` captured from `getBoundingClientRect()` (viewport-relative
   coordinates) but applies it via inline style while the toolbar's CSS is
   `position: absolute` relative to `.canvas-wrap` (a `position: relative`
   ancestor) — not the viewport. Those two coordinate spaces only coincide
   when `.canvas-wrap`'s top-left happens to sit at the viewport's origin;
   any layout reflow (a window resize changing the topbar/canvas offsets)
   breaks that assumption, so the same stored numbers now point somewhere
   else. Fix: once a custom position is set, render the toolbar with
   `position: fixed` instead of `absolute` (only in the dragged state — the
   default CSS-driven position is untouched), so the coordinate space always
   matches `getBoundingClientRect()`/pointer `clientX/clientY` exactly,
   independent of any ancestor's box.

8. **#67 "Select" conflates rectangle-select-to-drag with zoom-to-fit** —
   The current Select mode's `onSelectionEnd` handler
   (`GraphCanvas.tsx`/`SankeyView.tsx`, added for the previous #58) always
   zooms to the just-selected nodes' bounds, which fights the separate,
   legitimate use case this issue asks for: select several nodes, then drag
   them together as a group (a plain React Flow capability once nodes are
   marked `.selected`, needs no extra code). Fix: drop the automatic
   `onSelectionEnd` zoom entirely — Select mode becomes pure rectangle
   multi-select (+ built-in group drag); the existing "Fit graph" toolbar
   button remains the explicit, separate zoom-to-fit action the issue asks
   for.

---

## Needs a decision before any change — not implemented in this pass

9. **#66 "Maybe always show the property editor on the graph view"** — This
   is an open design question, not a scoped fix: the reporter is thinking
   out loud about removing the on-canvas activity cards' detail content in
   favor of always-visible Inspector, moving the Structure/Scaled toggle
   into it, and adding per-node display options — several undecided,
   interacting changes to core graph UI. Implementing a guess here risks
   making the graph view actively worse. Flagged for a follow-up
   conversation rather than guessed at.

---

## Verification

Each fix above is either behavioral (focus, resize, drag coordinates,
selection) or purely visual (icon sizes, header readout, trigger tab).
Verification plan: `npm run build`, `npm run lint`; manually drive the
chat panel (send a message and confirm focus returns, check composer
spacing, confirm icon sizes, confirm the new edge tab opens the panel and
the model name shows) and the graph/Sankey (drag the toolbar, resize the
window, confirm no jump; toggle Select mode, drag-select nodes, drag them
as a group, confirm no auto-zoom; use "Fit graph" separately) at the three
required breakpoints. Then `npm run test:responsive` and `npm run
test:visual`, reviewing any screenshot diffs before accepting them.
