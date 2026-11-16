/*
 * Application log: one JSON line per event on stdout (journald keeps it).
 * Enforcement of SYSTEM-ARCHITECTURE §12.3: every record passes a filter that
 * replaces learner ids and known sensitive lesson ids by "[redacted]" and
 * counts how often it had to (test SEC-7). Nothing here ever logs a path, a
 * query string, a name, a token or a client IP.
 */
import { LEARNER_ID_ANYWHERE } from './ids.ts';

let sensitiveIds: string[] = [];
let redactions = 0;
let sink: (line: string) => void = (line) => {
  process.stdout.write(line + '\n');
};

/** Lesson ids of sensitive (Child protection) portals; refreshed when content changes. */
export function setSensitiveLessonIds(ids: string[]): void {
  // Longest first, so an id that contains another is replaced whole.
  sensitiveIds = [...ids].sort((a, b) => b.length - a.length);
}

export function redactionCount(): number {
  return redactions;
}

/** For tests: capture lines instead of printing them. */
export function setLogSink(next: ((line: string) => void) | null): void {
  sink = next ?? ((line) => void process.stdout.write(line + '\n'));
}

export function redact(text: string): string {
  let out = text.replace(LEARNER_ID_ANYWHERE, () => {
    redactions += 1;
    return '[redacted]';
  });
  for (const id of sensitiveIds) {
    if (out.indexOf(id) === -1) continue;
    out = out.split(id).join('[redacted]');
    redactions += 1;
  }
  return out;
}

export function log(ev: string, fields: Record<string, unknown> = {}): void {
  let line: string;
  try {
    line = JSON.stringify({ ev, ...fields });
  } catch {
    line = JSON.stringify({ ev, note: 'unserialisable log record' });
  }
  sink(redact(line));
}

/** Log an unexpected error: its class and message only (redacted), never request data. */
export function logError(ev: string, error: unknown, fields: Record<string, unknown> = {}): void {
  const e = error as { name?: string; message?: string; stack?: string };
  log(ev, { ...fields, error: e?.name ?? 'Error', message: String(e?.message ?? error), stack: typeof e?.stack === 'string' ? e.stack.split('\n').slice(1, 6).map((s) => s.trim()) : undefined });
}
