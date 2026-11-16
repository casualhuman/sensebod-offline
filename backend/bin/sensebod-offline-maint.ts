/* sensebod-offline-maint: one run of the maintenance tasks (sensebod-offline-maint.timer: 1 min after boot, then every 15 min). */
import { logError } from '../src/core/log.ts';
import { runMaintenance } from '../src/system/maint.ts';
import { installCrashHandlers, openContext } from '../src/system/start.ts';

installCrashHandlers('maint');
const ctx = openContext('batch');
runMaintenance(ctx).then(
  () => {
    ctx.close();
    process.exit(0);
  },
  (error: unknown) => {
    logError('maint.failed', error);
    ctx.close();
    process.exit(1);
  },
);
