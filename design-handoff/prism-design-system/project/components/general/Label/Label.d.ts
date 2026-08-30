import * as React from 'react';

/**
 * Label — from product-graph-editor@0.1.0.
 */
export interface LabelProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}

export declare const Label: React.ComponentType<LabelProps>;
