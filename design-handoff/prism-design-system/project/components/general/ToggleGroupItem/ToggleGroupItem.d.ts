import * as React from 'react';

/**
 * ToggleGroupItem — from product-graph-editor@0.1.0.
 */
export interface ToggleGroupItemProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  /** A string value for the toggle group item. All items within a toggle group should use a unique value. */
  value: string;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}

export declare const ToggleGroupItem: React.ComponentType<ToggleGroupItemProps>;
