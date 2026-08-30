import * as React from 'react';

/**
 * AlertDialog — from product-graph-editor@0.1.0.
 */
export interface AlertDialogProps {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
}

export declare const AlertDialog: React.ComponentType<AlertDialogProps>;
