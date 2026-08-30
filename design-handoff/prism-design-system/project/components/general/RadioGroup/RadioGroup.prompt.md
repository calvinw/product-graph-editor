RadioGroup from product-graph-editor. Use via `window.PrismDS.RadioGroup` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface RadioGroupProps {
  name?: string;
  form?: string;
  required?: boolean;
  disabled?: boolean;
  dir?: "ltr" | "rtl";
  orientation?: "horizontal" | "vertical";
  loop?: boolean;
  defaultValue?: string;
  value?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}
```

## Related

`RadioGroupItem`
