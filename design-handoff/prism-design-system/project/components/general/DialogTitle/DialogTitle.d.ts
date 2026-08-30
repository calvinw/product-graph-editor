import * as React from 'react';

/**
 * DialogTitle — from product-graph-editor@0.1.0.
 */
export interface DialogTitleProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}

export declare const DialogTitle: React.ComponentType<DialogTitleProps>;
