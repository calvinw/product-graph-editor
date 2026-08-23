## Theming: attribute-based, dark by default

There is no `ThemeProvider` — theming is pure CSS. `:root` carries the
**dark** palette by default. To render on light, wrap the subtree in an
element with `data-theme="light"`; to force dark inside a light ancestor,
use `data-theme="dark"`. Nothing else is required — no context, no import
besides `styles.css`.

```jsx
<div data-theme="light" className="bg-background text-foreground rounded-lg p-6">
  {/* components here render on the light palette */}
</div>
```

Every build should set `data-theme` explicitly on its root container rather
than relying on the default — an app embedded inside another page may
inherit an ancestor's `data-theme` otherwise.

## Styling idiom: Tailwind utility classes over shared tokens

Components are unstyled without their classes — no CSS-in-JS, no inline
style props. Style by adding Tailwind utility classes that resolve to this
system's semantic tokens (defined once per theme in `:root`/`[data-theme]`,
consumed via Tailwind's `@theme inline` mapping):

| Role | Classes |
|---|---|
| Page/app surface | `bg-background` / `text-foreground` |
| Raised surface (dialog, card) | `bg-card` / `text-card-foreground` |
| Overlay surface (popover, dropdown) | `bg-popover` / `text-popover-foreground` |
| Primary action | `bg-primary` / `text-primary-foreground` |
| Secondary action | `bg-secondary` / `text-secondary-foreground` |
| Muted/quiet text or fill | `bg-muted` / `text-muted-foreground` |
| Hover/selected fill | `bg-accent` / `text-accent-foreground` |
| Destructive action | `bg-destructive` |
| Borders, inputs, focus rings | `border-border`, `bg-input`, `ring-ring` |
| Corner radius | `rounded-sm` / `rounded-md` / `rounded-lg` / `rounded-xl` (scaled off one `--radius`) |

Don't invent new token names or reach for raw hex/`rgb()` — every visible
surface in this system is one of the roles above. These are the *only*
tokens the shipped components themselves consume (verified against the
compiled bundle CSS); don't assume a broader app-chrome palette applies to
these components.

## Where the truth lives

Read `styles.css` (and its `@import` closure — `_ds_bundle.css`,
`fonts/fonts.css`) before styling anything outside the token table above.
Read each component's `<Name>.prompt.md` for its exact prop API and
composition examples before using it — the API is generated from the
package's real shipped TypeScript types, not guessed.

## Composing a real screen

Adapt real compositions rather than writing bare single-component demos —
this is how the design system's own previews are built:

```jsx
import { Button } from "product-graph-editor"
import { Play, Plus, Trash2 } from "lucide-react"

function Toolbar() {
  return (
    <div data-theme="light" className="bg-background text-foreground rounded-lg p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button><Play /> Run LCA</Button>
        <Button variant="outline"><Plus /> Add process</Button>
        <Button variant="destructive"><Trash2 /> Remove</Button>
      </div>
    </div>
  )
}
```

Most exported components are Radix compound sub-parts (e.g. `DialogTrigger`,
`DialogContent`, `SelectItem`) meant to be composed together, not used
standalone — check the parent's `.prompt.md` for the full composition shape
before building with a sub-part in isolation.
