# design-sync notes — product-graph-editor

## Known render warns (triaged, expected on every sync)

- **Checkbox — `[RENDER_BLANK]` (PNG 4870B, <5KB threshold), `bad: true`, `fallbackCard: false`.**
  This is the real component rendering with crash-prevention props, not the
  floor card — a bare unchecked checkbox is genuinely a 16×16px control with
  no label, so its screenshot is legitimately tiny. Confirmed by eye
  (`_screenshots/general__Checkbox.png`): a correctly styled, bordered
  checkbox square on transparent background. Not a defect. If this needs a
  richer preview later, author `.design-sync/previews/Checkbox.tsx` composing
  it with a `<Label>` (see `[RENDER_BLANK]`/`[RENDER_THIN]` fix guidance) —
  until then this warn is expected on every re-sync.

## Project history

- The design-system project this repo originally synced to
  (`e9640fe9-0ce7-4f96-a3f4-21b43dcb8f5e`) was deleted/lost before this
  sync — `get_project` returned 404. Created a fresh project **"Prism
  Design System"** (`2de7427d-fac8-44b9-9b61-507fe54b1d0c`) and re-pinned
  `.design-sync/config.json` to it. If a `.design-sync/config.json` from an
  even older clone still points at the original id, it's stale — this repo's
  copy is now the source of truth.
- Local `.ds-sync/`, `ds-bundle/`, and `dist-lib/` did not exist at the start
  of this sync despite `.design-sync/config.json` and `.design-sync/previews/`
  already being fully fleshed out (config has `componentSrcMap`, `overrides`,
  `guidelinesGlob` already tuned; `previews/Button.tsx`, `Dialog.tsx`,
  `Field.tsx` already authored and graded `good` in a prior session). That
  prior session apparently did the exploration and preview authoring but
  never completed an upload before the project vanished. This sync reused
  that config and those previews as-is — no changes needed to either.
- `node_modules` was stale on this clone: `@tailwindcss/cli` (needed by
  `npm run build:lib:css`) was in `package.json` but not actually installed.
  Fixed with `npm ci`. Re-syncs on a fresh clone should already be fine as
  long as `npm ci`/`npm install` ran first (standard repo setup).

## Preview scope for this sync

- Authored (from a prior session, carried forward): **Button, Dialog,
  Field** — all cells graded `good`.
- Everything else (77 more exported components, mostly Radix/shadcn
  compound sub-parts — e.g. `DialogTrigger`, `SelectContent`,
  `TooltipProvider`) ships on the **floor card** by explicit user choice
  ("floor cards for the rest, for now") — not a coverage gap, previews can
  be authored incrementally on any future re-sync.

## Re-sync risks

- `componentSrcMap` excludes `cn`, `buttonVariants`, `toggleVariants` as
  non-component exports (`null`). If the shadcn source adds new
  `*Variants`/utility exports alongside a component, they'll show up as
  spurious floor-card entries until added here.
- The design system exports **80 PascalCase symbols** from only **16**
  `src/components/ui/*.tsx` files — every Radix/shadcn compound sub-part
  (Root, Trigger, Content, Header, Footer, etc.) is a separate top-level
  export and a separate card. This is expected and correct for this repo's
  API shape, not an over-discovery bug — don't "fix" it by pruning sub-parts
  from `componentSrcMap`.
- Token vocabulary: only the **core shadcn semantic tokens** (`background`,
  `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`,
  `destructive`, `border`, `input`, `ring`, `radius`) are actually referenced
  by the 16 shipped components' CSS. The much larger app-specific token set
  in `src/design-system-tokens.css` (`--control-*`, `--panel-*`,
  `--floating-*`, `--canvas-*`, `--analysis-*`, `--table-*`, `--tab-*`,
  `--graph-*`, `--search-*`, `--segmented-*`, `--positive`/`--negative`/
  `--warning`, `--emission`/`--extraction`) belongs to the app's own layout
  chrome, not to these components — confirmed by grepping `_ds_bundle.css`
  for `var(--control-` etc. (zero hits). If future component additions to
  `src/components/ui/` start consuming those app tokens, the conventions
  header's family table will need updating to include them.
- Theming is **CSS-attribute-based, no JS provider**: `:root` (and
  `[data-theme="dark"]`) carry the dark palette by default; a subtree
  switches to light via `<div data-theme="light">`. There is no
  `ThemeProvider` export — a design agent that looks for one and doesn't
  find it should not invent one.
