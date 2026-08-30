import * as React from 'react';

/**
 * DropdownMenuLabel — from product-graph-editor@0.1.0.
 */
export interface DropdownMenuLabelProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  inset?: boolean;
}

export declare const DropdownMenuLabel: React.ComponentType<DropdownMenuLabelProps>;
