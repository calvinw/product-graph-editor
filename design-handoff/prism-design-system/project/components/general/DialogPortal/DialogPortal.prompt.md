DialogPortal from product-graph-editor. Use via `window.PrismDS.DialogPortal` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface DialogPortalProps {
  children?: React.ReactNode;
  /** Specify a container element to portal the content into. */
  container?: Element | DocumentFragment;
  /** Used to force mounting when more control is needed. Useful when controlling animation with React animation libraries. */
  forceMount?: true;
}
```
