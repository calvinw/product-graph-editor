SelectTrigger from product-graph-editor. Use via `window.PrismDS.SelectTrigger` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface SelectTriggerProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  size?: "default" | "sm";
}
```
