/*
 * sensebod-offline-worker: the background worker (one process, supervised by systemd).
 * Each job runs in its own child process; see src/worker/supervisor.ts.
 */
import { configPathFromArgv } from '../src/config.ts';
import { log } from '../src/core/log.ts';
import { installCrashHandlers, openContext } from '../src/system/start.ts';
import { Supervisor } from '../src/worker/supervisor.ts';

installCrashHandlers('worker');
const ctx = openContext('batch');
const supervisor = new Supervisor(ctx, { childArgv: ['--config', configPathFromArgv()] });
supervisor.start();

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log('worker.stopping', { signal });
  await supervisor.stop();
  ctx.close();
  process.exit(0);
}
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
