import * as React from 'react';

/**
 * PopoverHeader — from product-graph-editor@0.1.0.
 */
export interface PopoverHeaderProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const PopoverHeader: React.ComponentType<PopoverHeaderProps>;
