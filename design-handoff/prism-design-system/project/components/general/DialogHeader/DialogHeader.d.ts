import * as React from 'react';

/**
 * DialogHeader — from product-graph-editor@0.1.0.
 */
export interface DialogHeaderProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const DialogHeader: React.ComponentType<DialogHeaderProps>;
