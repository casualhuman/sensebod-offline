import { createElement, lazy, type ComponentType } from 'react';
import { loadPageIfReachable, visits } from './recover';

/**
 * `React.lazy` for a screen, with recovery when its code could not be
 * downloaded. Use it in a feature's routes file in place of `lazy`:
 *
 *   { path: '/lesson/:lessonId/done', component: lazyScreen(() => import('./screens/LessonDone')) }
 *
 * Plain `React.lazy` keeps a failed download for the life of the page, so
 * every later visit shows the error again without asking the bag. This one:
 *  - shows the error screen for the failed visit (the app's error boundary);
 *    it does not retry by itself, so a struggling bag is not asked twice;
 *  - asks again when the learner comes back to the screen (a later
 *    navigation);
 *  - if that fails too, loads the page afresh, but only when the bag answers
 *    (in the production build the module loader also keeps the failure, so a
 *    fresh page is the only thing that clears it; see ./recover.ts).
 */
export function lazyScreen(load: () => Promise<{ default: ComponentType }>): ComponentType {
  let failedBefore = false;
  /** The visit during which the current attempt failed, or null while it has not. */
  let failedAtVisit: number | null = null;
  let Current = attempt();

  function attempt() {
    return lazy(() =>
      load().catch((error: unknown) => {
        const again = failedBefore;
        failedBefore = true;
        if (!again) {
          failedAtVisit = visits.count;
          throw error;
        }
        return loadPageIfReachable(null).then((leaving) => {
          if (!leaving) {
            failedAtVisit = visits.count;
            throw error;
          }
          // The page is being replaced: keep showing "Opening…" until it is.
          return new Promise<{ default: ComponentType }>(() => {});
        });
      }),
    );
  }

  function LazyScreen() {
    // A failed attempt is kept for the rest of the visit it failed in (React
    // may render this more than once) and replaced on the next visit.
    if (failedAtVisit !== null && failedAtVisit !== visits.count) {
      failedAtVisit = null;
      Current = attempt();
    }
    return createElement(Current);
  }
  return LazyScreen;
}
