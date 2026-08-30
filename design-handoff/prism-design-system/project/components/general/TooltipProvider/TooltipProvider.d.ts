import * as React from 'react';

/**
 * TooltipProvider — from product-graph-editor@0.1.0.
 */
export interface TooltipProviderProps {
  children: React.ReactNode;
  /** The duration from when the pointer enters the trigger until the tooltip gets opened. */
  delayDuration?: number;
  /** How much time a user has to enter another trigger without incurring a delay again. */
  skipDelayDuration?: number;
  /** When `true`, trying to hover the content will result in the tooltip closing as the pointer leaves the trigger. */
  disableHoverableContent?: boolean;
}

export declare const TooltipProvider: React.ComponentType<TooltipProviderProps>;
