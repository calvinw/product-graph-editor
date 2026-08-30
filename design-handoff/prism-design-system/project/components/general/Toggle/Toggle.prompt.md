Toggle from product-graph-editor. Use via `window.PrismDS.Toggle` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface ToggleProps {
  /** The controlled state of the toggle. */
  pressed?: boolean;
  /** The state of the toggle when initially rendered. Use `defaultPressed` if you do not need to control the state of the tog */
  defaultPressed?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  variant?: "default" | "outline";
  size?: "default" | "sm" | "lg";
}
```

## Related

`ToggleGroup`, `ToggleGroupItem`
