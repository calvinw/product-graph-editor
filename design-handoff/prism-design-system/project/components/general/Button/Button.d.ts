import * as React from 'react';

/**
 * Button — from product-graph-editor@0.1.0.
 * @replaces button
 */
export interface ButtonProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  variant?: "link" | "default" | "secondary" | "ghost" | "outline" | "destructive";
  size?: "default" | "sm" | "icon";
  asChild?: boolean;
}

export declare const Button: React.ComponentType<ButtonProps>;
