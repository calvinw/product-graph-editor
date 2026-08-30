import * as React from 'react';

/**
 * MessageScrollerItem — from product-graph-editor@0.1.0.
 */
export interface MessageScrollerItemProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  messageId?: string;
  scrollAnchor?: boolean;
}

export declare const MessageScrollerItem: React.ComponentType<MessageScrollerItemProps>;
