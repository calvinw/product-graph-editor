import * as React from 'react';

/**
 * Select — from product-graph-editor@0.1.0.
 * @replaces select
 */
export interface SelectProps {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  dir?: "ltr" | "rtl";
  name?: string;
  autoComplete?: string;
  disabled?: boolean;
  required?: boolean;
  form?: string;
  value?: string;
  defaultValue?: string;
}

export declare const Select: React.ComponentType<SelectProps>;
