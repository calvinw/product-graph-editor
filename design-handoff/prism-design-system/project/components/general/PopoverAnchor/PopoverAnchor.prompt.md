PopoverAnchor from product-graph-editor. Use via `window.PrismDS.PopoverAnchor` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface PopoverAnchorProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  virtualRef?: React.RefObject<Measurable>;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}
```
