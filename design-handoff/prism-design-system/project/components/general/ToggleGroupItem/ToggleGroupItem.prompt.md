ToggleGroupItem from product-graph-editor. Use via `window.PrismDS.ToggleGroupItem` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface ToggleGroupItemProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  /** A string value for the toggle group item. All items within a toggle group should use a unique value. */
  value: string;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}
```
