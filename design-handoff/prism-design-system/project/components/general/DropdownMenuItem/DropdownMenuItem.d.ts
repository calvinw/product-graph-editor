import * as React from 'react';

/**
 * DropdownMenuItem — from product-graph-editor@0.1.0.
 */
export interface DropdownMenuItemProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  disabled?: boolean;
  className?: string;
  id?: string;
  asChild?: boolean;
  textValue?: string;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  inset?: boolean;
  variant?: "default" | "destructive";
}

export declare const DropdownMenuItem: React.ComponentType<DropdownMenuItemProps>;
