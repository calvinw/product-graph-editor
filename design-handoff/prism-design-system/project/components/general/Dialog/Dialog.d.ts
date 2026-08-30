import * as React from 'react';

/**
 * Dialog — from product-graph-editor@0.1.0.
 * @replaces dialog
 */
export interface DialogProps {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  modal?: boolean;
}

export declare const Dialog: React.ComponentType<DialogProps>;
