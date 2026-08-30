Button from product-graph-editor. Use via `window.PrismDS.Button` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface ButtonProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  variant?: "link" | "default" | "secondary" | "ghost" | "outline" | "destructive";
  size?: "default" | "sm" | "icon";
  asChild?: boolean;
}
```
