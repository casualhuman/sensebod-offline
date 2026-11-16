/*
 * The only way this backend asks root for anything (SYSTEM-ARCHITECTURE §9.8):
 * it starts one of the listed systemd units, which polkit allows to the
 * `sensebod-offline` user, and passes data through a one-time request file in
 * /run/sensebod-offline/requests/ that the unit reads, checks and deletes. No sudo,
 * no shell: the unit name is built from validated parts and handed to
 * systemctl as one argument.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Config, Paths } from '../config.ts';
import { ApiError } from '../core/errors.ts';
import { removeQuietly, writeFileDurable } from '../core/fsx.ts';
import { log } from '../core/log.ts';

const ALLOWED = [
  /^sensebod-offline-usb-eject\.service$/,
  /^sensebod-offline-usb-format@sd[a-z][0-9]*-[0-9a-f]{16}\.service$/,
  /^sensebod-offline-update@[0-9A-Za-z._-]{1,64}\.service$/,
  /^sensebod-offline-clock@[0-9]{1,12}-[0-9a-f]{16}\.service$/,
  /^sensebod-offline-poweroff\.service$/,
];

export function nonce(): string {
  return randomBytes(8).toString('hex');
}

/** Write the one-time request the root unit will read (younger than 60 s, carrying the nonce of the instance). */
export function writeRequest(ctx: { paths: Paths }, requestNonce: string, data: Record<string, unknown>): string {
  const file = join(ctx.paths.requests, `${requestNonce}.json`);
  writeFileDurable(file, JSON.stringify({ ...data, nonce: requestNonce, at: Math.floor(Date.now() / 1000) }), 0o600);
  return file;
}

export interface StartOptions {
  /** Wait for the unit to finish (true) or only queue it (false). */
  wait: boolean;
  timeoutMs?: number;
}

/**
 * Start a privileged unit. On a laptop (`dev.fake_privileged`) nothing is
 * started and the call succeeds, so the flows around it can be exercised.
 */
export function startUnit(ctx: { config: Config }, unit: string, options: StartOptions): Promise<void> {
  if (!ALLOWED.some((pattern) => pattern.test(unit))) return Promise.reject(new Error(`Refusing to start ${unit}: not a Sensebod Offline entry point.`));
  if (ctx.config.dev.fakePrivileged) {
    log('privileged.fake', { unit });
    return Promise.resolve();
  }
  const args = options.wait ? ['start', unit] : ['start', '--no-block', unit];
  return new Promise((resolve, reject) => {
    execFile(ctx.config.tools.systemctl, args, { timeout: options.timeoutMs ?? 15_000 }, (error) => {
      if (error) {
        log('privileged.failed', { unit, code: (error as { code?: unknown }).code ?? null });
        reject(new ApiError(503, 'unavailable', 'The bag could not do this just now. Try again.'));
      } else {
        log('privileged.started', { unit });
        resolve();
      }
    });
  });
}

export function dropRequest(file: string): void {
  removeQuietly(file);
}
