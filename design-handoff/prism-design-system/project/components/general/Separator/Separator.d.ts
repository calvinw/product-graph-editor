import * as React from 'react';

/**
 * Separator — from product-graph-editor@0.1.0.
 */
export interface SeparatorProps {
  /** Either `vertical` or `horizontal`. Defaults to `horizontal`. */
  orientation?: "horizontal" | "vertical";
  /** Whether or not the component is purely decorative. When true, accessibility-related attributes are updated so that that  */
  decorative?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}

export declare const Separator: React.ComponentType<SeparatorProps>;
