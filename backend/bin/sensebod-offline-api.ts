/*
 * sensebod-offline-api: the one HTTP process (127.0.0.1:8000 behind nginx).
 *
 * - Starts only after boot recovery; never contacts anything outside the bag.
 * - Removes the clean-shutdown marker when it starts and writes it when it
 *   stops gracefully, so a power cut is the absence of the marker.
 * - Persists the bag's accumulated uptime at least every 5 minutes (V-034).
 * - SIGTERM: stop accepting, finish in-flight requests (≤ 20 s), then exit.
 */
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { buildApp, buildMaintenanceApp } from '../src/app.ts';
import { configPathFromArgv, loadConfig } from '../src/config.ts';
import { readClockState, type Ctx } from '../src/core/context.ts';
import { writeFileDurable } from '../src/core/fsx.ts';
import { log, logError } from '../src/core/log.ts';
import { nowIso } from '../src/core/time.ts';
import { writeClockState } from '../src/system/bootstrap.ts';
import { NotReadyError, installCrashHandlers, openContext } from '../src/system/start.ts';

installCrashHandlers('api');

const config = loadConfig(configPathFromArgv());
let ctx: Ctx | null = null;
try {
  ctx = openContext('api');
} catch (error) {
  if (!(error instanceof NotReadyError)) throw error;
  // The database cannot be used: answer 503 maintenance to everything until a technician restores it (DATABASE §9.3).
  log('api.maintenance', { message: error.message });
}

const app = ctx ? buildApp(ctx) : buildMaintenanceApp();
const server = createServer(app);
// Slow headers are cut off; bodies may be slow (a chunk over weak Wi-Fi), nginx bounds those.
server.headersTimeout = 30_000;
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;

function persistUptime(context: Ctx): Promise<unknown> {
  // Also notes the last wall time seen, so the next boot can tell an unexplained jump (V-033).
  try {
    writeClockState(context.paths, { ...readClockState(context.paths), lastSeenWall: nowIso() });
  } catch (error) {
    logError('clock.state', error);
  }
  return context.write((tx) => tx.run("UPDATE bag_meta SET value = ? WHERE key = 'uptime_total_s'", String(context.uptimeTotalS())));
}

let timer: NodeJS.Timeout | null = null;
if (ctx) {
  const context = ctx;
  rmSync(context.paths.cleanShutdownMarker, { force: true });
  void persistUptime(context).catch((error: unknown) => logError('uptime.persist', error));
  timer = setInterval(() => void persistUptime(context).catch((error: unknown) => logError('uptime.persist', error)), 5 * 60_000);
  timer.unref();
}

server.listen(config.server.port, config.server.host, () => {
  log('api.listening', { host: config.server.host, port: config.server.port, version: ctx?.version ?? null, maintenance: ctx === null });
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log('api.stopping', { signal });
  if (timer) clearInterval(timer);
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 20_000).unref())]);
  server.closeAllConnections();
  if (ctx) {
    try {
      await persistUptime(ctx);
      writeFileDurable(ctx.paths.cleanShutdownMarker, `${nowIso()}\n`, 0o600);
    } catch (error) {
      logError('api.stop', error);
    }
    ctx.close();
  }
  process.exit(0);
}
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
