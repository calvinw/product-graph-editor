SelectItem from product-graph-editor. Use via `window.PrismDS.SelectItem` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface SelectItemProps {
  value: string;
  disabled?: boolean;
  textValue?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}
```
