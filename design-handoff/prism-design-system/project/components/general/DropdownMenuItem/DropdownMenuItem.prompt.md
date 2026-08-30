DropdownMenuItem from product-graph-editor. Use via `window.PrismDS.DropdownMenuItem` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface DropdownMenuItemProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  disabled?: boolean;
  className?: string;
  id?: string;
  asChild?: boolean;
  textValue?: string;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  inset?: boolean;
  variant?: "default" | "destructive";
}
```
