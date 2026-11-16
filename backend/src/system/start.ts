/* Shared start-up for every process: configuration, this boot, keys, context, start-up assertions. */
import { type Config, configPathFromArgv, loadConfig, paths as buildPaths } from '../config.ts';
import { type BootInfo, Ctx, loadKeys, readBootInfo } from '../core/context.ts';
import { assertSqliteVersion, type DbRole } from '../core/db.ts';
import { log } from '../core/log.ts';
import { headState } from '../core/migrate.ts';
import { VERSION } from '../version.ts';
import { bootRecover } from './bootstrap.ts';

export class NotReadyError extends Error {}

/** The record of this boot, written by sensebod-offline-boot-recover. On a laptop (`dev.self_recover`) recovery runs here. */
export function bootInfoFor(config: Config): BootInfo {
  const p = buildPaths(config);
  const found = readBootInfo(p);
  if (found) return found;
  if (!config.dev.selfRecover) throw new NotReadyError('Boot recovery has not run in this boot (sensebod-offline-boot-recover.service).');
  const result = bootRecover(config);
  if (result.maintenance) throw new NotReadyError(`The database cannot be used: ${result.notes.join(' ')}`);
  return result.boot;
}

/**
 * Open the context and assert DATABASE §3: WAL (asserted on open), SQLite ≥ 3.35,
 * and a schema equal to this release's migrations. Migrations never run here.
 */
export function openContext(role: DbRole, argv: string[] = process.argv): Ctx {
  const config = loadConfig(configPathFromArgv(argv));
  const boot = bootInfoFor(config);
  const keys = loadKeys(buildPaths(config));
  const ctx = new Ctx({ config, role, version: VERSION, boot, keys });
  try {
    assertSqliteVersion(ctx.db);
    const head = headState(ctx.db, 'main');
    if (head !== 'equal') throw new NotReadyError(`The database schema is ${head} of this release. Run the update procedure.`);
    const countsHead = headState(ctx.counts, 'counts');
    if (countsHead !== 'equal') throw new NotReadyError(`The counts database schema is ${countsHead} of this release.`);
  } catch (error) {
    ctx.close();
    throw error;
  }
  return ctx;
}

/** Log and leave when something escapes every handler; systemd restarts the service. */
export function installCrashHandlers(name: string): void {
  process.on('uncaughtException', (error) => {
    log('crash', { process: name, error: error.name, message: error.message });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log('unhandled_rejection', { process: name, message: String((reason as Error | undefined)?.message ?? reason) });
  });
}
