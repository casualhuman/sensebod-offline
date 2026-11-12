/*
 * The controls under a video or audio picture (V3-Components "Video player",
 * CPB-Video, CPB-Audio): elapsed and length in words, a thick seek bar, big
 * labelled Back 10s · Play/Pause · Forward 10s, then labelled toggles.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Button, cx, formatLength, Message } from '@shared/components';
import { IconBack10, IconForward10, IconPause, IconPlay, IconTryAgain } from '@shared/icons';
import { percentPlayed, spokenTime } from './time';
import type { MediaProblem, MediaStatus } from './useMedia';

export interface SeekMarker {
  /** Seconds. */
  at: number;
  /** True once the question there has been answered. */
  done: boolean;
}

export interface SeekBarProps {
  /** "Video time", "Story time". */
  label: string;
  time: number;
  /** null until the browser knows the length: the bar cannot be moved yet. */
  duration: number | null;
  /** Length from the lesson's data, shown until the real one is known. null → "[length]". */
  knownLength: number | null;
  onSeek: (seconds: number) => void;
  /** Interactive video: where the questions are. */
  markers?: readonly SeekMarker[];
  /** Extra words for screen readers, e.g. "Stopped at question 1 of 2." */
  note?: string;
}

/**
 * Elapsed / length and the seek bar. A native range input: keyboard, touch
 * and screen-reader support come from the browser on every device, with no
 * pointer-tracking code of our own.
 */
export function SeekBar({ label, time, duration, knownLength, onSeek, markers, note }: SeekBarProps) {
  const total = duration ?? knownLength;
  const fill = `${percentPlayed(time, total)}%`;
  const spoken = total === null ? `${spokenTime(time)} played` : `${spokenTime(time)} of ${spokenTime(total)}`;
  return (
    <div className="les-seek">
      <div className="les-seek__times">
        <span>
          <span className="sb-visually-hidden">Played: </span>
          {formatLength(time)}
        </span>
        <span className="les-seek__length">
          <span className="sb-visually-hidden">Length: </span>
          {formatLength(total)}
        </span>
      </div>
      <div className={cx('les-seek__bar', markers && markers.length > 0 && 'les-seek__bar--marked')}>
        {total !== null && markers
          ? markers.map((marker) => (
              <span
                key={marker.at}
                aria-hidden="true"
                className={cx('les-seek__marker', marker.done && 'is-done')}
                // 16px = half the thumb, so the diamond sits over where the thumb stops.
                style={{ left: `calc(16px + (100% - 32px) * ${Math.round(Math.max(0, Math.min(1, marker.at / total)) * 10000) / 10000})` }}
              />
            ))
          : null}
        <input
          className="les-seek__input"
          type="range"
          aria-label={label}
          aria-valuetext={note ? `${spoken}. ${note}` : spoken}
          min={0}
          max={Math.max(1, Math.round(total ?? 1))}
          step={1}
          value={Math.round(time)}
          disabled={duration === null}
          style={{ '--les-fill': fill } as CSSProperties}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </div>
    </div>
  );
}

export interface TransportProps {
  status: MediaStatus;
  onToggle: () => void;
  onSkip: (delta: number) => void;
  /** Audio lessons use the large round Play button of CPB-Audio. */
  round?: boolean;
  /** Interactive video: Play waits for the answer. */
  playLocked?: boolean;
}

/** Back 10s · Play / Pause · Forward 10s. */
export function Transport({ status, onToggle, onSkip, round, playLocked }: TransportProps) {
  const active = status === 'playing' || status === 'loading';
  const word = active ? 'Pause' : 'Play';
  const glyph = active ? <IconPause size={round ? 52 : 44} /> : <IconPlay size={round ? 52 : 44} />;
  return (
    <>
      <Button stacked variant="secondary" className="les-ctl les-ctl--skip" icon={<IconBack10 size={42} strokeWidth={2.6} />} onClick={() => onSkip(-10)}>
        Back 10s
      </Button>
      {round ? (
        <button type="button" className="les-ctl les-ctl--round" disabled={playLocked} onClick={onToggle}>
          <span className="les-ctl__disc" aria-hidden="true">
            {glyph}
          </span>
          {word}
        </button>
      ) : (
        <Button stacked className="les-ctl les-ctl--play" icon={glyph} disabled={playLocked} onClick={onToggle}>
          {word}
        </Button>
      )}
      <Button stacked variant="secondary" className="les-ctl les-ctl--skip" icon={<IconForward10 size={42} strokeWidth={2.6} />} onClick={() => onSkip(10)}>
        Forward 10s
      </Button>
    </>
  );
}

export interface ToggleProps {
  icon: ReactNode;
  /** The words say the state ("Captions on" / "Captions off"), so it never rests on colour. */
  children: ReactNode;
  /** Leave out for a plain action in the same row (Full screen). */
  pressed?: boolean;
  onClick: () => void;
  controls?: string;
}

/** A labelled on/off control in the second row (Captions, Sound, Read along). */
export function Toggle({ icon, children, pressed, onClick, controls }: ToggleProps) {
  return (
    <Button stacked variant="secondary" className="les-ctl les-ctl--toggle" icon={icon} aria-pressed={pressed} aria-controls={controls} onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * Lays the buttons out as on the boards. Children order in the markup is the
 * tablet order (toggle, Back, Play, Forward, toggle …, CPB-WatchAnswer-Tab);
 * on phones CSS puts the three transport buttons on the first row.
 */
export function Controls({ children, toggles }: { children: ReactNode; toggles: number }) {
  return <div className={cx('les-controls', `les-controls--${toggles}`)}>{children}</div>;
}

/**
 * The fallback when the media cannot play (ENGINEER-INSTRUCTIONS 6.4). Two
 * different situations, said in plain words: the file did not arrive (try
 * again helps), or this phone cannot decode it (it will not, so no button
 * that leads nowhere).
 */
export function MediaProblemNote({ problem, what, onRetry }: { problem: MediaProblem | null; what: 'video' | 'sound'; onRetry: () => void }) {
  if (problem === 'network') {
    return (
      <Message
        tone="error"
        title={what === 'video' ? 'The video stopped' : 'The sound stopped'}
        action={
          <Button variant="danger" fullWidth icon={<IconTryAgain size={28} />} onClick={onRetry}>
            Try again
          </Button>
        }
      >
        This phone cannot reach the bag. Check you are on the bag’s Wi-Fi, then try again.
      </Message>
    );
  }
  return (
    <Message tone="error" title={what === 'video' ? 'This video cannot play on this phone' : 'This sound cannot play on this phone'}>
      {what === 'video' ? 'This phone cannot show this kind of video.' : 'This phone cannot play this kind of sound.'} Ask your facilitator, or try another phone.
    </Message>
  );
}
