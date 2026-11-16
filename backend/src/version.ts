/* The release version: the VERSION file of the release folder, else the package version. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function read(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const up of ['..', '../..', '../../..']) {
    try {
      const version = readFileSync(join(here, up, 'VERSION'), 'utf8').trim();
      if (version) return version;
    } catch {
      // not a release layout
    }
  }
  for (const up of ['..', '../..']) {
    try {
      const pkg = JSON.parse(readFileSync(join(here, up, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'sensebod-offline-backend' && pkg.version) return pkg.version;
    } catch {
      // keep looking
    }
  }
  return '0.0.0';
}

export const VERSION = read();
