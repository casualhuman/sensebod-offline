import type { ReactNode } from 'react';

export interface IconProps {
  /** Drawn size in CSS pixels. Library sizes: 22 (chips), 28-32 (buttons), 36-42 (badges). */
  size?: number;
  /**
   * Accessible name. Leave it out when a word sits beside the icon (the usual
   * case: icons here always come with a label) and the icon is hidden from
   * screen readers.
   */
  title?: string;
  /** Stroke width at the 24px grid. 3 is the house style; do not go thinner than 2.6. */
  strokeWidth?: number;
  className?: string;
}

interface BaseProps extends IconProps {
  children: ReactNode;
}

/**
 * Base for every icon: 24x24 grid, 3px round stroke, coloured by `currentColor`
 * so an icon always matches the text it sits with. Feature code can build a
 * local icon with it: `<Icon><path d="…" /></Icon>`.
 */
export function Icon({ size = 28, title, strokeWidth = 3, className, children }: BaseProps) {
  return (
    <svg
      className={className ? `sb-icon ${className}` : 'sb-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {children}
    </svg>
  );
}
