import * as React from 'react';

/**
 * MessageScrollerProvider — from product-graph-editor@0.1.0.
 */
export interface MessageScrollerProviderProps {
  children?: React.ReactNode;
  autoScroll?: boolean;
  defaultScrollPosition?: "start" | "end" | "last-anchor";
  scrollEdgeThreshold?: number;
  scrollPreviousItemPeek?: number;
  scrollMargin?: number;
}

export declare const MessageScrollerProvider: React.ComponentType<MessageScrollerProviderProps>;
