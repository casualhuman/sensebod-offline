/* Time helpers. Ordering never uses the wall clock (ADR-014); these are for display and coarse dates. */

export function nowIso(at: Date = new Date()): string {
  return at.toISOString();
}

/** 'YYYY-MM-DD' of the server date (UTC). */
export function dayOf(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(toDay + 'T00:00:00Z') - Date.parse(fromDay + 'T00:00:00Z')) / 86_400_000);
}

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
