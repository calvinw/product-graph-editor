import * as React from 'react';

/**
 * Popover — from product-graph-editor@0.1.0.
 */
export interface PopoverProps {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  modal?: boolean;
}

export declare const Popover: React.ComponentType<PopoverProps>;
