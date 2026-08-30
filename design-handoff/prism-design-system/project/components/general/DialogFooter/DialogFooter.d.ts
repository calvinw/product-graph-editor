import * as React from 'react';

/**
 * DialogFooter — from product-graph-editor@0.1.0.
 */
export interface DialogFooterProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  showCloseButton?: boolean;
}

export declare const DialogFooter: React.ComponentType<DialogFooterProps>;
