/*
 * sensebod-offline-boot-recover: oneshot, before the worker and the API (DATA-EXPORT §13).
 * Exit 0: the databases are usable (possibly after going back to a saved copy).
 * Exit 1: they are not; the maintenance flag is set and the API answers 503.
 */
import { configPathFromArgv, loadConfig } from '../src/config.ts';
import { log, logError } from '../src/core/log.ts';
import { bootRecover } from '../src/system/bootstrap.ts';

try {
  const result = bootRecover(loadConfig(configPathFromArgv()));
  for (const note of result.notes) log('boot.note', { note });
  process.exit(result.maintenance ? 1 : 0);
} catch (error) {
  logError('boot.recover.failed', error);
  process.exit(1);
}
