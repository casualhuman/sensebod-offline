import type { ReactNode } from 'react';
import { describeError } from '../api/client';
import { IconBag, IconError, IconInfoMark, IconTick, IconTryAgain } from '../icons';
import { Button } from './Button';
import { cx } from './cx';

export type MessageTone = 'success' | 'info' | 'empty' | 'error';

export interface MessageProps {
  /** success = saved (green) · info = good to know (blue) · empty = not in this bag (dashed grey) · error (red). */
  tone: MessageTone;
  title: string;
  /** One or two plain sentences. */
  children?: ReactNode;
  /** A recovery button or link, shown under the text. */
  action?: ReactNode;
  className?: string;
}

/**
 * Messages. Each has an icon, a bold title and words, so the meaning never
 * rests on colour. Errors are announced at once (role="alert"); the others
 * politely (role="status").
 */
export function Message({ tone, title, children, action, className }: MessageProps) {
  const Glyph = tone === 'success' ? IconTick : tone === 'error' ? IconError : tone === 'empty' ? IconBag : IconInfoMark;
  return (
    <div className={cx('sb-message', tone !== 'info' && `sb-message--${tone}`, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="sb-message__badge" aria-hidden="true">
        <Glyph size={30} />
      </span>
      <div className="sb-message__content">
        <p className="sb-message__title">{title}</p>
        {children ? <div className="sb-message__text">{children}</div> : null}
        {action ? <div className="sb-message__action">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * Three brand dots (blue, gold, green) that bounce in turn: the loader for a
 * screen, a section, a game or an activity. Pure CSS, so it costs nothing on
 * old phones; the dots sit still when the phone asks for less motion.
 * Small in-place waits (a button, an upload row) keep IconSpinner.
 */
export function LoadingDots({ className }: { className?: string }) {
  return (
    <span className={cx('sb-dots', className)} aria-hidden="true">
      <span className="sb-dots__dot" />
      <span className="sb-dots__dot" />
      <span className="sb-dots__dot" />
    </span>
  );
}

/** Loading: bouncing dots with words under them. Use for a whole screen or a section while data arrives. */
export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('sb-loading', className)} role="status">
      <LoadingDots />
      <span>{label}</span>
    </div>
  );
}

export interface ErrorStateProps {
  /** What failed, in the user's words: "This lesson did not open". */
  title?: string;
  /** The caught error (ApiError or anything). Turned into a plain sentence. */
  error?: unknown;
  /** Shows the red "Try again" button. Pass `reload` from useApi. */
  onRetry?: () => void;
  /** "Try again" is running: the button shows a spinner and ignores taps. */
  retrying?: boolean;
  /** Extra recovery control, e.g. a Back link. */
  action?: ReactNode;
  className?: string;
}

/** Error with a way out. Says nothing is lost and offers "Try again". */
export function ErrorState({ title = 'This page did not open', error, onRetry, retrying, action, className }: ErrorStateProps) {
  return (
    <Message
      tone="error"
      title={title}
      className={className}
      action={
        onRetry || action ? (
          <>
            {onRetry ? (
              <Button variant="danger" fullWidth icon={<IconTryAgain size={28} />} onClick={onRetry} working={retrying} workingLabel="Trying again…">
                Try again
              </Button>
            ) : null}
            {action}
          </>
        ) : undefined
      }
    >
      {describeError(error)}
    </Message>
  );
}

export interface EmptyStateProps {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Empty: "Not in this bag yet", with words that say what to do and a way back. */
export function EmptyState({ title = 'Not in this bag yet', children = 'Ask your facilitator.', action, className }: EmptyStateProps) {
  return (
    <Message tone="empty" title={title} action={action} className={className}>
      {children}
    </Message>
  );
}

/** Success: "Saved", in green with a tick. */
export function SuccessState({ title = 'Saved', children, action, className }: EmptyStateProps) {
  return (
    <Message tone="success" title={title} action={action} className={className}>
      {children}
    </Message>
  );
}
