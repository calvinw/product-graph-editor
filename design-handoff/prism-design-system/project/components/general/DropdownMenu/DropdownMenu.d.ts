import * as React from 'react';

/**
 * DropdownMenu — from product-graph-editor@0.1.0.
 */
export interface DropdownMenuProps {
  children?: React.ReactNode;
  dir?: "ltr" | "rtl";
  open?: boolean;
  defaultOpen?: boolean;
  modal?: boolean;
}

export declare const DropdownMenu: React.ComponentType<DropdownMenuProps>;
