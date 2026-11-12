/*
 * Admin: route table (stream 4). The only file the app router knows about.
 *
 * Every screen is lazy, so a facilitator on a phone downloads the question
 * editor or the Try it setup only if they open it. Every screen except the
 * sign-in form is wrapped in `RequireAdmin`; the server remains the real
 * authority (each /admin API call is refused without a session).
 *
 * The URL scheme is documented in adminPaths.ts.
 */
import { lazy, type ComponentType } from 'react';
import type { RouteDef } from '@shared/router';
import { RequireAdmin } from './session';

function guarded(Screen: ComponentType): ComponentType {
  return function GuardedScreen() {
    return (
      <RequireAdmin>
        <Screen />
      </RequireAdmin>
    );
  };
}

const notAvailable = guarded(lazy(() => import('./screens/NotAvailable')));

export const routes: RouteDef[] = [
  { path: '/admin/sign-in', component: lazy(() => import('./screens/SignIn')) },
  { path: '/admin', component: guarded(lazy(() => import('./screens/Home'))) },
  { path: '/admin/menu', component: guarded(lazy(() => import('./screens/Menu'))) },
  { path: '/admin/add', component: guarded(lazy(() => import('./screens/AddSource'))) },
  { path: '/admin/add/upload', component: guarded(lazy(() => import('./screens/Upload'))) },
  { path: '/admin/add/notes', component: guarded(lazy(() => import('./screens/Notes'))) },
  { path: '/admin/add/type', component: guarded(lazy(() => import('./screens/TypeLesson'))) },
  { path: '/admin/add/animation', component: guarded(lazy(() => import('./screens/Animation'))) },
  { path: '/admin/lessons/:lessonId/place', component: guarded(lazy(() => import('./screens/Place'))) },
  { path: '/admin/lessons/:lessonId/picture', component: guarded(lazy(() => import('./screens/Picture'))) },
  { path: '/admin/lessons/:lessonId/check', component: guarded(lazy(() => import('./screens/Done'))) },
  { path: '/admin/lessons/:lessonId/questions', component: guarded(lazy(() => import('./screens/Questions'))) },
  { path: '/admin/lessons/:lessonId/try-it', component: guarded(lazy(() => import('./screens/TryIt'))) },
  { path: '/admin/library', component: guarded(lazy(() => import('./screens/Library'))) },
  { path: '/admin/series', component: guarded(lazy(() => import('./screens/Series'))) },
  { path: '/admin/series/:seriesId', component: guarded(lazy(() => import('./screens/Series'))) },
  // Listed in the menu, not designed yet (HANDOFF section 8), and anything unknown under /admin.
  { path: '/admin/*', component: notAvailable },
];
