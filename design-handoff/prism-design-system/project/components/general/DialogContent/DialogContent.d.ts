import * as React from 'react';

/**
 * DialogContent — from product-graph-editor@0.1.0.
 */
export interface DialogContentProps {
  /** Used to force mounting when more control is needed. Useful when controlling animation with React animation libraries. */
  forceMount?: true;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** When `true`, a `'pointerdown'` event outside of the layered element will wait for the interaction's click event before d */
  deferPointerDownOutside?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  showCloseButton?: boolean;
}

export declare const DialogContent: React.ComponentType<DialogContentProps>;
