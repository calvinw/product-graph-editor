MessageScrollerItem from product-graph-editor. Use via `window.PrismDS.MessageScrollerItem` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface MessageScrollerItemProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  messageId?: string;
  scrollAnchor?: boolean;
}
```
