import * as React from 'react';

/**
 * DropdownMenuRadioItem — from product-graph-editor@0.1.0.
 */
export interface DropdownMenuRadioItemProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  disabled?: boolean;
  value: string;
  className?: string;
  id?: string;
  asChild?: boolean;
  textValue?: string;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  inset?: boolean;
}

export declare const DropdownMenuRadioItem: React.ComponentType<DropdownMenuRadioItemProps>;
