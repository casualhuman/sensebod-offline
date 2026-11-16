/*
 * The job runner: the entry point of the child process the supervisor forks
 * for ONE job (R-6). It talks to the supervisor over the IPC pipe only:
 *
 *   → { t: 'progress', p }     also the heartbeat
 *   → { t: 'done', result }    the result the supervisor commits
 *   → { t: 'fail', code }      a failure the job understands
 *
 * It never writes job state itself, so a child stuck on a dead stick holds
 * no database connection (V-024).
 */
import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { configPathFromArgv, loadConfig, paths as buildPaths } from '../config.ts';
import { Db } from '../core/db.ts';
import { log } from '../core/log.ts';
import { handlerFor } from './registry.ts';
import { JobFailure } from './types.ts';

function send(message: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    if (!process.send) {
      resolve();
      return;
    }
    process.send(message, () => resolve());
  });
}

async function main(): Promise<void> {
  const jobId = process.argv[process.argv.indexOf('--job') + 1] ?? '';
  const config = loadConfig(configPathFromArgv());
  const paths = buildPaths(config);
  const db = new Db(paths.mainDb, { role: 'batch', readOnly: true });
  let row: { id: string; kind: string; lane: string; payload_json: string } | undefined;
  try {
    row = db.get('SELECT id, kind, lane, payload_json FROM job WHERE id = ?', jobId);
  } finally {
    db.close();
  }
  if (!row) throw new JobFailure('internal', 'The job is not in the queue.');
  const handler = handlerFor(row.lane, row.kind);
  if (!handler) throw new JobFailure('internal', `No code runs jobs of kind ${row.kind}.`);
  // Conversions yield to everything else; exports to learners' requests.
  try {
    os.setPriority(0, row.lane === 'media' ? 19 : 10);
  } catch {
    // not permitted: carry on at normal priority
  }
  const workDir = join(paths.jobsTmp, row.id);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  let last = -1;
  try {
    const result = await handler.run({
      config,
      paths,
      job: { id: row.id, kind: row.kind, payload: JSON.parse(row.payload_json) as Record<string, unknown> },
      workDir,
      progress(percent) {
        const p = Math.max(0, Math.min(100, Math.round(percent)));
        if (p === last) return;
        last = p;
        void send({ t: 'progress', p });
      },
    });
    await send({ t: 'done', result: result ?? null });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  async (error: unknown) => {
    const code = error instanceof JobFailure ? error.code : 'internal';
    // The detail goes to the log (redacted there), not into the database.
    log('job.error', { code, message: String((error as Error)?.message ?? error) });
    await send({ t: 'fail', code });
    process.exit(1);
  },
);
