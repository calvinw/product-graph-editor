import * as React from 'react';

/**
 * Checkbox — from product-graph-editor@0.1.0.
 * @replaces input[type=checkbox]
 */
export interface CheckboxProps {
  checked?: boolean | "indeterminate";
  defaultChecked?: boolean | "indeterminate";
  required?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}

export declare const Checkbox: React.ComponentType<CheckboxProps>;
