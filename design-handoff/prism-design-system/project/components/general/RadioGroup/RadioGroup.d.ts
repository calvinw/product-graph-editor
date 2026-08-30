import * as React from 'react';

/**
 * RadioGroup — from product-graph-editor@0.1.0.
 */
export interface RadioGroupProps {
  name?: string;
  form?: string;
  required?: boolean;
  disabled?: boolean;
  dir?: "ltr" | "rtl";
  orientation?: "horizontal" | "vertical";
  loop?: boolean;
  defaultValue?: string;
  value?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}

export declare const RadioGroup: React.ComponentType<RadioGroupProps>;
