/*
 * Retention of learner data (OWNER-5, ADR-018, DATA-EXPORT §8.1) and the
 * guards against a wrong clock (V-033).
 *
 * - A learner and their progress are removed `learner_days` (61) after their
 *   last activity. Data that has NOT been exported for EasySTEM is held
 *   `unexported_hold_days` longer (owner decision O-16: 60 days), then removed
 *   anyway: a hard stop, so a hub that never exports does not keep data for ever.
 * - Days inside a guarded clock jump (a hand-set or unexplained forward step
 *   of more than 7 days) never count for unexported learners, and count for
 *   exported learners only after a hub manager confirmed the date.
 * - Nothing is removed while the clock is `unsure`, nor for a learner whose
 *   last activity is "after today".
 * - Each daily run removes at most 10 % of the learners on the bag.
 *
 * "Exported" = the learner's newest change has seq ≤ the snapshot_seq of the
 * newest records or full backup that reached the admin (saved file checked,
 * or copied to a stick). The partner spreadsheet does not count.
 */
import type { Config } from '../config.ts';
import type { ClockTrust, Tx } from '../core/context.ts';
import type { Db } from '../core/db.ts';
import { dayOf, daysBetween, nowIso } from '../core/time.ts';

export interface Jump {
  id: string;
  to_time: string;
  days: number;
  source: string;
  confirmed_at: string | null;
}

export interface LearnerAge {
  id: string;
  last_active_day: string | null;
  created_at: string;
  /** Highest seq of the learner row and of its progress rows. */
  last_seq: number;
}

export function exportedSeq(db: Db): number {
  return Number(
    db.value(
      "SELECT coalesce(max(snapshot_seq), 0) FROM export WHERE kind IN ('backup-records','backup-full') AND snapshot_seq IS NOT NULL AND (saved_checked_at IS NOT NULL OR state = 'copied-to-usb')",
    ) ?? 0,
  );
}

export function lastExport(db: Db): { at: string | null; kind: string | null } {
  const row = db.get<{ at: string | null; kind: string }>(
    "SELECT coalesce(saved_checked_at, ready_at) AS at, kind FROM export WHERE kind IN ('backup-records','backup-full') AND snapshot_seq IS NOT NULL AND (saved_checked_at IS NOT NULL OR state = 'copied-to-usb') ORDER BY snapshot_seq DESC LIMIT 1",
  );
  return row ? { at: row.at, kind: row.kind } : { at: null, kind: null };
}

export function learnerAges(db: Db): LearnerAge[] {
  return db.all<LearnerAge>(
    `SELECT l.id, l.last_active_day, l.created_at,
            max(l.seq, coalesce((SELECT max(seq) FROM lesson_progress lp WHERE lp.learner_id = l.id), 0)) AS last_seq
       FROM learner l`,
  );
}

export function openJumps(db: Db): Jump[] {
  return db.all<Jump>('SELECT id, to_time, days, source, confirmed_at FROM clock_jump ORDER BY to_time');
}

export interface Verdict {
  exported: boolean;
  /** Days without activity that count (jump days subtracted as the rules say). */
  countedDays: number;
  /** Days still to go before removal; ≤ 0 means removable now. */
  daysLeft: number;
  /** Past the two months, kept only because it was not exported yet. */
  heldBack: boolean;
  /** Ids of unconfirmed jumps whose days were subtracted and would otherwise make this learner removable. */
  blockedBy: string[];
}

export function judge(learner: LearnerAge, today: string, exportedUpTo: number, jumps: Jump[], retention: Config['retention']): Verdict | null {
  const last = learner.last_active_day ?? learner.created_at.slice(0, 10);
  const raw = daysBetween(last, today);
  // Never act on a learner whose last activity is after "today": the clock is behind.
  if (raw < 0) return null;
  const exported = learner.last_seq <= exportedUpTo;
  let subtract = 0;
  let unconfirmedDays = 0;
  const blocking: string[] = [];
  for (const jump of jumps) {
    if (jump.to_time.slice(0, 10) <= last) continue;
    if (!exported) subtract += jump.days;
    else if (jump.confirmed_at === null) {
      subtract += jump.days;
      unconfirmedDays += jump.days;
      blocking.push(jump.id);
    }
  }
  const countedDays = Math.max(0, raw - subtract);
  const limit = retention.learnerDays + (exported ? 0 : retention.unexportedHoldDays);
  const daysLeft = limit - countedDays;
  return {
    exported,
    countedDays,
    daysLeft,
    heldBack: !exported && countedDays >= retention.learnerDays && daysLeft > 0,
    blockedBy: daysLeft > 0 && daysLeft - unconfirmedDays <= 0 ? blocking : [],
  };
}

export function clockAllowsRetention(trust: ClockTrust): boolean {
  return trust !== 'unsure';
}

/** Delete learners (cascade: progress) with tombstones. The caller's transaction must run with secure_delete. */
export function deleteLearners(tx: Tx, ids: string[]): { learners: number; progress: number } {
  let progress = 0;
  const now = nowIso();
  for (const id of ids) {
    progress += Number(tx.value('SELECT count(*) FROM lesson_progress WHERE learner_id = ?', id) ?? 0);
    tx.run('DELETE FROM learner WHERE id = ?', id);
    tx.run(
      "INSERT INTO tombstone (entity, entity_id, seq, deleted_at) VALUES ('learner', ?, ?, ?) ON CONFLICT (entity, entity_id) DO UPDATE SET seq = excluded.seq, deleted_at = excluded.deleted_at",
      id,
      tx.seq(),
      now,
    );
  }
  return { learners: ids.length, progress };
}

export interface RetentionPlan {
  removable: string[];
  heldBack: number;
  /** Earliest future removal: date and how many learners go on it. */
  next: { date: string; learners: number } | null;
  /** jump id → exported learners it keeps from being removed. */
  blocked: Map<string, number>;
  total: number;
}

export function planRetention(db: Db, retention: Config['retention'], today = dayOf()): RetentionPlan {
  const exportedUpTo = exportedSeq(db);
  const jumps = openJumps(db);
  const learners = learnerAges(db);
  const plan: RetentionPlan = { removable: [], heldBack: 0, next: null, blocked: new Map(), total: learners.length };
  const upcoming = new Map<number, number>();
  for (const learner of learners) {
    const verdict = judge(learner, today, exportedUpTo, jumps, retention);
    if (!verdict) continue;
    if (verdict.heldBack) plan.heldBack += 1;
    for (const id of verdict.blockedBy) plan.blocked.set(id, (plan.blocked.get(id) ?? 0) + 1);
    if (verdict.daysLeft <= 0) plan.removable.push(learner.id);
    else upcoming.set(verdict.daysLeft, (upcoming.get(verdict.daysLeft) ?? 0) + 1);
  }
  if (plan.removable.length > 0) {
    plan.next = { date: today, learners: plan.removable.length };
  } else if (upcoming.size > 0) {
    const soonest = Math.min(...upcoming.keys());
    plan.next = { date: new Date(Date.parse(`${today}T00:00:00Z`) + soonest * 86_400_000).toISOString().slice(0, 10), learners: upcoming.get(soonest) ?? 0 };
  }
  return plan;
}
