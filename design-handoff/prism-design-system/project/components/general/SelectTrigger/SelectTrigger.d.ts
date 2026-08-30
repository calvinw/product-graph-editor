import * as React from 'react';

/**
 * SelectTrigger — from product-graph-editor@0.1.0.
 */
export interface SelectTriggerProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  size?: "default" | "sm";
}

export declare const SelectTrigger: React.ComponentType<SelectTriggerProps>;
