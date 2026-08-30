import * as React from 'react';

/**
 * DropdownMenuCheckboxItem — from product-graph-editor@0.1.0.
 */
export interface DropdownMenuCheckboxItemProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  disabled?: boolean;
  className?: string;
  id?: string;
  asChild?: boolean;
  checked?: boolean | "indeterminate";
  textValue?: string;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  inset?: boolean;
}

export declare const DropdownMenuCheckboxItem: React.ComponentType<DropdownMenuCheckboxItemProps>;
