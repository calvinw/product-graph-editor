import * as React from 'react';

/**
 * DropdownMenuSubContent — from product-graph-editor@0.1.0.
 */
export interface DropdownMenuSubContentProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  asChild?: boolean;
  /** Used to force mounting when more control is needed. Useful when controlling animation with React animation libraries. */
  forceMount?: true;
  sideOffset?: number;
  /** Controls the direction the subcontent appears from its anchor menu item Default: start */
  align?: "start" | "end";
  alignOffset?: number;
  arrowPadding?: number;
  avoidCollisions?: boolean;
  collisionBoundary?: Element | Element[];
  collisionPadding?: number | Partial<Record<"top" | "right" | "bottom" | "left", number>>;
  sticky?: "partial" | "always";
  hideWhenDetached?: boolean;
  updatePositionStrategy?: "always" | "optimized";
  /** Whether keyboard navigation should loop around */
  loop?: boolean;
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
}

export declare const DropdownMenuSubContent: React.ComponentType<DropdownMenuSubContentProps>;
