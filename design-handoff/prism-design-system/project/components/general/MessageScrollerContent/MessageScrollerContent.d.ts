import * as React from 'react';

/**
 * MessageScrollerContent — from product-graph-editor@0.1.0.
 */
export interface MessageScrollerContentProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  spacerClassName?: string;
}

export declare const MessageScrollerContent: React.ComponentType<MessageScrollerContentProps>;
