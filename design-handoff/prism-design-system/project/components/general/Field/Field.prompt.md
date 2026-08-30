Field from product-graph-editor. Use via `window.PrismDS.Field` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface FieldProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
  orientation?: "horizontal" | "vertical" | "responsive";
}
```

## Related

`FieldContent`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldLabel`, `FieldLegend`, `FieldSeparator`, `FieldSet`, `FieldTitle`
