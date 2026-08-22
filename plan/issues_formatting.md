# How to write issues that get fixed correctly the first time

This is written for filing issues that an AI coding agent will pick up. It is
based on what actually worked and what caused long round-trips while fixing
the ~30 issues in this repo during August 2026 — the examples are all real
issues from this repo.

The single most useful habit, if you adopt only one: **include a screenshot of
the current state and a sentence describing the target state.** Nearly every
long back-and-forth traced back to the agent not being able to see what you
were seeing.

---

## Highest value

### 1. A screenshot of what's wrong — plus what "right" looks like

[#51](https://github.com/calvinw/product-graph-editor/issues/51) (oversized
chat icons) was the easiest issue of the whole batch, because it had both: a
screenshot of the bad icons *and* a reference screenshot of the intended look.
There was no ambiguity about when it was done.

Contrast: "spread the nodes more" took five rounds of tuning, because there was
no visible target and the agent could not see the screen.

### 2. Name the exact model, template, or view

Most graph issues did not say which file to open. "Cotton Fiber (bafu-linked)"
and "Tote Bag" — mentioned only later, in chat — were what finally made the bug
reproducible.

Without it the agent is guessing between several templates, and a bug that only
appears on a multi-background-node graph is simply invisible on the default one.

### 3. Repro steps as a numbered sequence

[#64](https://github.com/calvinw/product-graph-editor/issues/64) ("resize the
window, *then* try to grab the toolbar") was fixed correctly on the first
attempt, because the ordering was explicit — and that ordering **was** the bug.
[#60](https://github.com/calvinw/product-graph-editor/issues/60) ("I type a
prompt / I send it / I can't keep typing") is equally good.

These are the best-written issues in the repo. Copy their style.

### 4. A checkable acceptance criterion

[#37](https://github.com/calvinw/product-graph-editor/issues/37) specified a
`16px` gap and named the test that measures it. Zero ambiguity about "done".

Informal versions work just as well:

> Done when: every edge label is fully readable at the default zoom without panning.

---

## Prevents the agent from over-correcting

### 5. Say what should NOT change

[#67](https://github.com/calvinw/product-graph-editor/issues/67) said selecting
and zooming were conflated, so the agent removed the zoom behavior entirely —
overshooting, because zoom-to-rectangle was still wanted, just on a separate
gesture. It had to be restored in a follow-up commit.

"Keep X, just move it off Y" would have landed it the first time.

### 6. One issue = one bug

[#66](https://github.com/calvinw/product-graph-editor/issues/66) bundles four
interacting ideas (always-show the inspector, strip detail off the activity
cards, move the Structure/Scaled toggle into the inspector, add per-node
display options). That is precisely why it is still open — there is no single
change that can be made confidently.

### 7. Separate "do this" from "thinking out loud"

[#66](https://github.com/calvinw/product-graph-editor/issues/66) is written
entirely in "maybe" / "I think possibly". Genuine brainstorming is valuable —
just label it. A `discussion` label, or a line saying "not ready to build yet",
tells the agent to leave it alone rather than guess at an implementation.

---

## Minor, but they help

- **Describe behavior, not implementation.** Locating the code is the agent's
  job, and the root cause is often not the expected one. The toolbar-jump bug
  turned out to be a coordinate-space mismatch, not a saving bug.
- **For reference apps, a screenshot beats a URL.** Fetching the referenced
  chat app for [#50](https://github.com/calvinw/product-graph-editor/issues/50)
  returned an empty SPA shell; the screenshot of it was what actually worked.
- **Include window size / zoom level** for anything layout- or
  responsive-related.
- **Say if it is a regression** ("this worked last week") — that points
  straight at recent commits.

---

## Template

```
What I did:
  1. Open Tote Bag (bafu-linked)
  2. Switch to Graph view
  3. Resize the browser window narrower

What happened:
  [screenshot] The graph stays left-aligned and the right half is cut off.

What I expected:
  The graph re-centers and fits the viewport, the way it does on first load.

Done when:
  No part of the graph sits outside the viewport after resizing.

Don't change:
  If I have manually zoomed in, keep my zoom level.
```

---

## Quick checklist

- [ ] Screenshot of the current (broken) state
- [ ] Screenshot or description of the intended state
- [ ] Which model / template / view reproduces it
- [ ] Numbered steps, in order
- [ ] A concrete "done when"
- [ ] Anything nearby that must **not** change
- [ ] One bug per issue
- [ ] Labeled as discussion if it is still an idea, not a request
