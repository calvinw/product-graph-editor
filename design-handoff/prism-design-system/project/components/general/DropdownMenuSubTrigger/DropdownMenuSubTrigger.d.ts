import * as React from 'react';

/**
 * DropdownMenuSubTrigger — from product-graph-editor@0.1.0.
 */
export interface DropdownMenuSubTriggerProps {
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
}

export declare const DropdownMenuSubTrigger: React.ComponentType<DropdownMenuSubTriggerProps>;
