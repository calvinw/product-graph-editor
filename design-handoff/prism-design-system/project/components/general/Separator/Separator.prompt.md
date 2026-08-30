Separator from product-graph-editor. Use via `window.PrismDS.Separator` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface SeparatorProps {
  /** Either `vertical` or `horizontal`. Defaults to `horizontal`. */
  orientation?: "horizontal" | "vertical";
  /** Whether or not the component is purely decorative. When true, accessibility-related attributes are updated so that that  */
  decorative?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}
```
