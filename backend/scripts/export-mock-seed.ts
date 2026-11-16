/*
 * Development helper: write seed/content.json from the frontend mock's seed
 * (app/mock/data/seed.ts), so a laptop backend shows the same sample content
 * the screens were built against. Not used on a bag: real content arrives as
 * signed content packs.
 *
 *   node scripts/export-mock-seed.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const seedModule = (await import(join(here, '../../app/mock/data/seed.ts'))) as { createDb: () => Record<string, unknown> };
const db = seedModule.createDb();
const out = {
  format: 'sensebod-offline-seed/1',
  portals: db.portals,
  groups: db.groups,
  series: db.series,
  lessons: db.lessons,
  pictures: db.pictures,
};
const file = join(here, '../seed/content.json');
writeFileSync(file, JSON.stringify(out));
const count = (key: keyof typeof out): number => (Array.isArray(out[key]) ? (out[key] as unknown[]).length : 0);
console.log(`wrote ${file}: ${count('portals')} portals, ${count('groups')} groups, ${count('series')} series, ${count('lessons')} lessons, ${count('pictures')} pictures`);
