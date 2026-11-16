/*
 * The app router: one lazy-loaded entry per feature, pre-wired.
 * Streams 2-4 never edit this file. They add screens to the `routes` array
 * in their own `src/features/<name>/routes.tsx`.
 *
 * A feature's code (and CSS) is downloaded the first time one of its URLs is
 * opened: a learner never downloads the admin, an admin on a phone never
 * downloads the lesson players until they preview one.
 */
import type { RouteDef } from '@shared/router';
import { features } from '@shared/switches';

export interface FeatureModule {
  routes: readonly RouteDef[];
}

export interface FeatureEntry {
  id: 'learner' | 'lessons' | 'admin' | 'games' | 'dev';
  /** Left out: always on. Otherwise asked on every look-up, so a switch in shared/switches.ts turns the feature off. */
  enabled?: () => boolean;
  /** The feature owns every path that is, or starts with, one of these. */
  prefixes: readonly string[];
  load: () => Promise<FeatureModule>;
}

const entries: FeatureEntry[] = [
  { id: 'lessons', prefixes: ['/lesson'], load: () => import('../features/lessons/routes') },
  { id: 'admin', prefixes: ['/admin'], load: () => import('../features/admin/routes') },
  // Switched off, /games falls through to the learner feature and gets its "not in this bag" page.
  { id: 'games', prefixes: ['/games'], load: () => import('../features/games/routes'), enabled: () => features.games },
];

// Component kitchen sink: development server only. `import.meta.env.DEV` is
// replaced by `false` in a production build, so this branch and the page it
// imports are removed from the bundle.
if (import.meta.env.DEV) {
  entries.push({ id: 'dev', prefixes: ['/__dev'], load: () => import('./dev/routes') });
}

/** Everything else (Home, Save my progress, portals) is the learner feature. */
const learner: FeatureEntry = { id: 'learner', prefixes: ['/'], load: () => import('../features/learner/routes') };

export function featureFor(pathname: string): FeatureEntry {
  for (const entry of entries) {
    if (entry.enabled && !entry.enabled()) continue;
    for (const prefix of entry.prefixes) {
      if (pathname === prefix || pathname.indexOf(prefix + '/') === 0) return entry;
    }
  }
  return learner;
}

export const allFeatures: readonly FeatureEntry[] = [...entries, learner];
