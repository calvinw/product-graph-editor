import * as React from 'react';

/**
 * MessageScrollerButton — from product-graph-editor@0.1.0.
 */
export interface MessageScrollerButtonProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  render?: React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | ((props: Record<string, unknown>, state: { active: boolean; direction: "start" | "end"; }) => React.ReactElement | null);
  behavior?: "auto" | "instant" | "smooth";
  direction?: "start" | "end";
}

export declare const MessageScrollerButton: React.ComponentType<MessageScrollerButtonProps>;
