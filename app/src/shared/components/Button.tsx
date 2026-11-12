import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { IconSpinner } from '../icons';
import { Link } from '../router';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'listen' | 'danger' | 'danger-outline' | 'success' | 'exit';
export type ButtonSize = 'lg' | 'md' | 'sm';

interface LookProps {
  /** primary = solid accent (blue, green on Agriculture). Default. */
  variant?: ButtonVariant;
  /** lg 72px (the one main action of a screen), md 64px (default), sm 56px. */
  size?: ButtonSize;
  /** Icon shown before the words. Buttons always have words. */
  icon?: ReactNode;
  iconAfter?: ReactNode;
  /** Stretch to the full width of the container (main actions on phones). */
  fullWidth?: boolean;
  /** Icon above the word (player controls). */
  stacked?: boolean;
  className?: string;
  children: ReactNode;
}

function lookClass(p: LookProps, extra?: string | false): string {
  return cx(
    'sb-btn',
    p.variant && p.variant !== 'primary' && `sb-btn--${p.variant}`,
    p.size && p.size !== 'md' && `sb-btn--${p.size}`,
    p.fullWidth && 'sb-btn--full',
    p.stacked && 'sb-btn--stacked',
    extra,
    p.className,
  );
}

function Content({ icon, iconAfter, children }: Pick<LookProps, 'icon' | 'iconAfter' | 'children'>) {
  return (
    <>
      {icon ? <span className="sb-btn__icon">{icon}</span> : null}
      <span className="sb-btn__label">{children}</span>
      {iconAfter ? <span className="sb-btn__icon sb-btn__icon--after">{iconAfter}</span> : null}
    </>
  );
}

export interface ButtonProps extends LookProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> {
  /**
   * The action is running: shows a spinner and `workingLabel`, ignores taps
   * (prevents a double submit) and tells screen readers it is busy.
   */
  working?: boolean;
  /** Words while working, e.g. "Saving your name…". */
  workingLabel?: string;
  /**
   * "Not ready yet": dashed grey look and disabled. Make the label say what
   * to do first ("Type your name first"), usually with a pencil icon.
   */
  notReady?: boolean;
}

/** An action. Use a named action for the words ("Save and start learning"), never "Submit". */
export function Button({
  variant,
  size,
  icon,
  iconAfter,
  fullWidth,
  stacked,
  className,
  children,
  working = false,
  workingLabel,
  notReady = false,
  disabled,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  const look = { variant, size, fullWidth, stacked, className, children };
  return (
    <button
      {...rest}
      type={type}
      className={lookClass(look, notReady && 'is-not-ready')}
      disabled={disabled || notReady}
      aria-busy={working || undefined}
      onClick={(event) => {
        if (working) {
          event.preventDefault();
          return;
        }
        if (onClick) onClick(event);
      }}
    >
      <Content icon={working ? <IconSpinner size={size === 'sm' ? 26 : 32} /> : icon} iconAfter={working ? undefined : iconAfter}>
        {working && workingLabel ? workingLabel : children}
      </Content>
    </button>
  );
}

export interface ButtonLinkProps extends LookProps {
  /** In-app path (use `paths`). */
  to: string;
  replace?: boolean;
  onClick?: () => void;
  'aria-label'?: string;
}

/** Looks like a Button, navigates like a link. Use it when the action is "go to another screen". */
export function ButtonLink({ to, replace, onClick, variant, size, icon, iconAfter, fullWidth, stacked, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link {...rest} to={to} replace={replace} onClick={onClick} className={lookClass({ variant, size, fullWidth, stacked, className, children })}>
      <Content icon={icon} iconAfter={iconAfter}>
        {children}
      </Content>
    </Link>
  );
}

export interface ButtonLookProps extends LookProps {
  'aria-hidden'?: boolean;
}

/**
 * The look of a button without being one. For cards that are a single link
 * and show their action at the bottom (lesson cards): the card is the control.
 */
export function ButtonLook({ variant, size, icon, iconAfter, fullWidth, stacked, className, children, ...rest }: ButtonLookProps) {
  return (
    <span {...rest} className={lookClass({ variant, size, fullWidth, stacked, className, children })}>
      <Content icon={icon} iconAfter={iconAfter}>
        {children}
      </Content>
    </span>
  );
}
