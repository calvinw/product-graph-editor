FieldError from product-graph-editor. Use via `window.PrismDS.FieldError` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface FieldErrorProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
  errors?: { message?: string; }[];
}
```
