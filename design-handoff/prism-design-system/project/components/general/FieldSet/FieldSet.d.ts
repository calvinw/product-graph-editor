import * as React from 'react';

/**
 * FieldSet — from product-graph-editor@0.1.0.
 */
export interface FieldSetProps {
  /** Allows getting a ref to the component instance. Once the component unmounts, React will set `ref.current` to `null` (or  */
  ref?: React.Ref;
  className?: string;
  id?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
}

export declare const FieldSet: React.ComponentType<FieldSetProps>;
