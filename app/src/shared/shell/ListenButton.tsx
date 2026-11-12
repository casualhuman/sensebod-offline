import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '../components/Button';
import { LanguageSwitch } from '../components/Chips';
import { cx } from '../components/cx';
import { IconListen } from '../icons';
import { getListenSnapshot, isListening, listenFailed, startListening, stopListening, subscribeListen } from './listen';

export interface ListenButtonProps {
  /**
   * Recorded narration for this page or question (`listenUrl` from the API).
   * null/undefined: nothing recorded yet; the button stays, and says so when tapped.
   */
  src: string | null | undefined;
  /** Words on the button. Default "Listen". Home uses "Listen to this page". */
  label?: string;
  size?: 'lg' | 'md' | 'sm';
  fullWidth?: boolean;
  className?: string;
}

/**
 * Listen · the only gold button. Plays a recording stored in the bag; tap
 * again to stop. Never starts by itself. If there is no recording, or it
 * cannot be played, the button says so in words. While it plays the words
 * change to "Stop" (the words carry the state; there is no aria-pressed,
 * which would be read out as "Stop, pressed").
 */
export function ListenButton({ src, label = 'Listen', size, fullWidth, className }: ListenButtonProps) {
  useSyncExternalStore(subscribeListen, getListenSnapshot);
  const [asked, setAsked] = useState(false);
  const playing = isListening(src);
  const failed = listenFailed(src);

  // Stop when the page that owns the recording goes away.
  useEffect(() => {
    setAsked(false);
    return () => {
      if (isListening(src)) stopListening();
    };
  }, [src]);

  const unavailable = (asked && !src) || failed;
  return (
    <Button
      variant="listen"
      size={size}
      fullWidth={fullWidth}
      className={className}
      icon={<IconListen size={32} />}
      onClick={() => {
        if (!src) setAsked(true);
        else if (playing) stopListening();
        else startListening(src);
      }}
    >
      {playing ? 'Stop' : unavailable ? 'No sound here yet' : label}
    </Button>
  );
}

export interface ListenBarProps {
  src: string | null | undefined;
  label?: string;
  className?: string;
}

/**
 * Phone layout: the Listen button with the language switch beside it, placed
 * by each page under its title (as on the boards). Hidden from tablet width
 * up, where the page shell shows both in the header instead.
 */
export function ListenBar({ src, label, className }: ListenBarProps) {
  return (
    <div className={cx('sb-listen-bar sb-phone-only', className)}>
      <ListenButton src={src} label={label} />
      <LanguageSwitch />
    </div>
  );
}
