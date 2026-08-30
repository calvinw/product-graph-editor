MessageScrollerButton from product-graph-editor. Use via `window.PrismDS.MessageScrollerButton` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface MessageScrollerButtonProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  render?: React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | ((props: Record<string, unknown>, state: { active: boolean; direction: "start" | "end"; }) => React.ReactElement | null);
  behavior?: "auto" | "instant" | "smooth";
  direction?: "start" | "end";
}
```
