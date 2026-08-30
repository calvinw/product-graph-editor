import * as React from 'react';

/**
 * PopoverAnchor — from product-graph-editor@0.1.0.
 */
export interface PopoverAnchorProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  virtualRef?: React.RefObject<Measurable>;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}

export declare const PopoverAnchor: React.ComponentType<PopoverAnchorProps>;
