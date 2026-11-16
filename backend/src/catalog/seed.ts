/*
 * Load the shipped content tree (seed/content.json) into an empty bag:
 * always the five portals, their groups and the built-in pictures; with
 * `demo`, also the sample series and lessons the screens were designed with.
 * Real lessons reach a bag as signed content packs, not through this file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../core/db.ts';
import { sha256Hex } from '../core/ids.ts';
import { nowIso } from '../core/time.ts';

interface SeedPicture {
  url: string;
  alt: string;
}

interface Seed {
  portals: { id: string; title: string; description: string; theme: string; groupKind: string; picture: SeedPicture | null }[];
  groups: { id: string; portalId: string; kind: string; title: string; description: string; picture: SeedPicture | null; availability: string; icon?: string | null; audience?: string | null }[];
  series: { id: string; groupId: string; title: string; description: string; picture: SeedPicture | null; availability: string; icon?: string | null }[];
  lessons: ({
    id: string;
    seriesId: string;
    position: number | null;
    title: string;
    summary: string;
    picture: SeedPicture | null;
    language: string;
    type: string;
    interactive: boolean;
    captions: boolean;
    readAlong: boolean;
    needsSound: boolean;
    length: number | null;
    pages: number | null;
    status: string;
    placement: unknown;
    source: string;
    fileNames: string[];
    pictureId: string | null;
    listenUrl: string | null;
    content: Record<string, unknown>;
  })[];
  pictures: { id: string; group: string; url: string; alt: string }[];
}

export function defaultSeedPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const up of ['../..', '../../..']) {
    const file = join(here, up, 'seed', 'content.json');
    try {
      readFileSync(file);
      return file;
    } catch {
      // next layout
    }
  }
  throw new Error('seed/content.json was not found.');
}

function pictureGroup(url: string): string {
  if (url.indexOf('/child-protection/') !== -1) return 'child-protection';
  if (url.indexOf('/agriculture/') !== -1) return 'agriculture';
  if (url.indexOf('/climate/') !== -1) return 'climate';
  if (url.indexOf('/pictures/subjects/') !== -1) return 'school';
  return 'people-places';
}

export function importSeed(db: Db, file: string, options: { demo: boolean }): { portals: number; groups: number; series: number; lessons: number; pictures: number } {
  const seed = JSON.parse(readFileSync(file, 'utf8')) as Seed;
  const now = nowIso();
  return db.tx(() => {
    const seq = (): number => Number((db.get<{ value: string }>("UPDATE bag_meta SET value = value + 1 WHERE key = 'change_seq' RETURNING value") as { value: string }).value);
    const pictureIds = new Map<string, string>();
    let pictures = 0;
    const picture = (p: SeedPicture | null, id?: string, group?: string): string | null => {
      if (!p) return null;
      const known = pictureIds.get(p.url);
      if (known) return known;
      const pictureId = id ?? `pi-s-${sha256Hex(p.url).slice(0, 16)}`;
      const changed = db.run(
        'INSERT INTO picture (id, grp, url_path, alt, created_at, seq) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
        pictureId,
        group ?? pictureGroup(p.url),
        p.url,
        p.alt,
        now,
        seq(),
      );
      pictures += changed;
      pictureIds.set(p.url, pictureId);
      return pictureId;
    };
    for (const p of seed.pictures) picture({ url: p.url, alt: p.alt }, p.id, p.group);

    let portals = 0;
    seed.portals.forEach((p, index) => {
      portals += db.run(
        'INSERT INTO portal (id, title, description, theme, group_kind, picture_id, sort_order, sensitive, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
        p.id,
        p.title,
        p.description,
        p.theme,
        p.groupKind,
        picture(p.picture),
        index + 1,
        // Child protection rules apply to this portal (ADR-009).
        p.id === 'child-protection' ? 1 : 0,
        now,
        seq(),
      );
    });
    let groups = 0;
    seed.groups.forEach((g, index) => {
      groups += db.run(
        'INSERT INTO content_group (id, portal_id, kind, title, description, picture_id, availability, icon, audience, sort_order, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
        g.id,
        g.portalId,
        g.kind,
        g.title,
        g.description,
        picture(g.picture),
        g.availability,
        g.icon ?? null,
        g.audience ?? null,
        index + 1,
        now,
        seq(),
      );
    });
    let series = 0;
    let lessons = 0;
    if (options.demo) {
      seed.series.forEach((s, index) => {
        series += db.run(
          'INSERT INTO series (id, group_id, title, description, picture_id, availability, icon, sort_order, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
          s.id,
          s.groupId,
          s.title,
          s.description,
          picture(s.picture),
          s.availability,
          s.icon ?? null,
          index + 1,
          now,
          seq(),
        );
      });
      for (const l of seed.lessons) {
        const placed = l.placement !== null && l.seriesId !== '';
        const { type: _type, ...content } = l.content;
        const body: Record<string, unknown> = { ...content };
        if (l.listenUrl) body.listenUrl = l.listenUrl;
        lessons += db.run(
          `INSERT INTO lesson (id, series_id, position, type, interactive, captions, read_along, needs_sound, length_seconds, pages, title, summary, language, status, source,
                               picture_id, file_names_json, body_json, version, created_at, updated_at, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
          l.id,
          placed ? l.seriesId : null,
          placed && l.type !== 'check' ? l.position : null,
          l.type,
          l.interactive ? 1 : 0,
          l.captions ? 1 : 0,
          l.readAlong ? 1 : 0,
          l.needsSound ? 1 : 0,
          l.length,
          l.pages,
          l.title.slice(0, 120),
          l.summary,
          l.language,
          placed ? l.status : 'draft',
          l.source,
          l.pictureId && db.get('SELECT 1 FROM picture WHERE id = ?', l.pictureId) ? l.pictureId : picture(l.picture),
          JSON.stringify(l.fileNames),
          JSON.stringify(body),
          now,
          now,
          seq(),
        );
      }
    }
    db.run("UPDATE bag_meta SET value = value + 1 WHERE key = 'content_rev'");
    return { portals, groups, series, lessons, pictures };
  });
}
