# features/learner — Learner browsing (stream 2)

This folder belongs to **stream 2**. It builds: Home, Save my progress, portal pages and lesson lists (Primary, JSS, Agriculture, Climate, Child protection: Who / Child / Parent / Elder / Help).

Stream 1 created only `routes.tsx` (a working placeholder) and this note. Everything else in here is yours.

## What is here now

| File | What |
|---|---|
| `routes.tsx` | Route table. Home is eager; Save my progress, Get help now and the browsing screen are lazy |
| `screens/Home.tsx` | Home, the gateway (board Main) |
| `screens/SaveProgress.tsx` | Save my progress (V3-SignIn) |
| `screens/Browse.tsx` | The three `/portal/…` URLs in one component, so it stays mounted from portal to class |
| `screens/Help.tsx` | Child protection: Get help now (CPB-Help). Contacts are bracketed placeholders |
| `views/PortalViews.tsx` | Who are you? (CPB-Who), topics (AGB-Agriculture, CLB-Climate), class then subjects (V3-Primary, V3-JSS) |
| `views/SeriesView.tsx` | Lesson list of a series with filter and progress (CPB-Child, CPB-Parent, CPB-Elder) |
| `views/ChildProtectionExtras.tsx` | Per-audience sections after the lesson list |
| `components.tsx`, `icons.tsx`, `lib.ts`, `progress.ts` | Local pieces, icons, helpers, progress hooks |
| `learner.css` | Local styles, prefix `lrn-` |
| `learner.test.tsx`, `lib.test.ts` | Screen and journey tests on the mock API |



## The one rule: add screens in `routes.tsx`

The app router (`src/app/features.ts`, owned by stream 1) lazy-loads **this folder's `routes.tsx`** the first time someone opens one of its URLs. You never edit the app router. To add a screen:

1. Create the screen as a component with a **default export**, e.g. `screens/PortalPage.tsx`.
2. Add one line to the `routes` array in `routes.tsx`:

```tsx
import { lazy } from 'react';
import type { RouteDef } from '@shared/router';

export const routes: RouteDef[] = [
  { path: '/portal/:portalId', component: lazy(() => import('./screens/PortalPage')) },
];
```

- `routes.tsx` must keep the named export `routes: RouteDef[]`. That is the whole contract with the app router.
- **Paths are absolute** and must stay inside this feature's URL space: everything that is not under `/lesson` or `/admin`: `/`, `/save-progress`, `/portal/…`. A test (`src/app/App.test.tsx`) fails if a route leaves it.
- `:name` matches one segment (`useParams<'name'>()`); a trailing `/*` matches the rest. First match wins, so put specific paths before general ones.
- Wrap each screen in `lazy()` so its code is downloaded only when opened. A loading state and a "did not open" error screen are already provided around every screen.
- Link to screens (yours or another stream's) with the `paths` helpers from `@shared/router`, never with hand-written strings and never by importing another feature: `<ButtonLink to={paths.portal(…)}>`. The full URL scheme is in `src/shared/router/paths.ts`.

## What to import

```tsx
import { Button, LessonCard, LoadingState, ErrorState } from '@shared/components'; // catalogue: docs/ARCHITECTURE.md
import { IconBack } from '@shared/icons';
import { PageShell, ListenBar } from '@shared/shell';
import { paths, Link, navigate, useParams, useQuery } from '@shared/router';
import { useApi, learnerApi, adminApi, type Lesson } from '@shared/api';
import { useSession, setLearner } from '@shared/session';
import { sceneUrl } from '@shared/illustrations';
```

Every screen is wrapped in `<PageShell title="…" backTo={paths.…}>`. Load data with `useApi`; show `<LoadingState />` while loading and `<ErrorState error={error} onRetry={reload} />` on failure.

## House rules (details in docs/ARCHITECTURE.md)

- Import only from `@shared/*` and from this folder. ESLint blocks imports from other features, from `src/app` and from `mock/`.
- CSS: put styles next to the component as `Name.module.css` (CSS Modules) or plain `.css` with a `learner-` class prefix. Use the tokens (`var(--sb-accent)`, `var(--sb-space-4)` …). **No flex `gap`**, no `:has()`, container queries, `color-mix()`, `aspect-ratio`, `inset`, `clamp()`: they do not exist on Android 8.
- Movement only inside `@media (prefers-reduced-motion: no-preference)`.
- Tests live next to the code as `*.test.tsx`; use `installMockApi()` from `@mock/installMockFetch` for API data.
- Something shared missing or wrong? Add an entry to `docs/team/REQUESTS.md`, work around it here and mark it `TODO(stream-1)`.
