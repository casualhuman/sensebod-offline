/* Time words for the players. Display uses the shared `formatLength` ("1:24"). */

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** 84 → "1 minute 24 seconds". For screen readers (slider value text). */
export function spokenTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return plural(rest, 'second');
  if (rest === 0) return plural(minutes, 'minute');
  return `${plural(minutes, 'minute')} ${plural(rest, 'second')}`;
}

/** Keeps a time inside the media. An unknown length only stops it going below 0. */
export function clampTime(seconds: number, duration: number | null): number {
  const low = Math.max(0, seconds);
  return duration === null ? low : Math.min(low, duration);
}

/** How far along, 0–100. 0 when the length is unknown. */
export function percentPlayed(seconds: number, duration: number | null): number {
  if (duration === null || duration <= 0) return 0;
  return Math.max(0, Math.min(100, (seconds / duration) * 100));
}
