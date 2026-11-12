/*
 * Learner browsing: route table (stream 2).
 *
 * This file is the only thing the app router knows about this feature.
 *
 * Home is not lazy: it is the first screen of nearly every visit, and this
 * file is already downloaded on demand by the app router, so a second lazy
 * step would only add a request before the first paint. The other screens
 * load when opened. The three /portal routes share one component and one
 * `instance`, so that it stays mounted while a learner moves from a portal
 * to a class (see screens/Browse.tsx); without `instance` the router mounts
 * a new screen whenever the route or a path param changes.
 */
import { lazy } from 'react';
import { paths, type RouteDef } from '@shared/router';
import Home from './screens/Home';
import './learner.css';

const Browse = lazy(() => import('./screens/Browse'));

export const routes: RouteDef[] = [
  { path: paths.home(), component: Home },
  { path: paths.saveProgress(), component: lazy(() => import('./screens/SaveProgress')) },
  // `help` is a reserved group id in Child protection: it must come before the group route.
  { path: paths.help(), component: lazy(() => import('./screens/Help')) },
  { path: '/portal/:portalId', component: Browse, instance: 'browse' },
  { path: '/portal/:portalId/:groupId', component: Browse, instance: 'browse' },
  { path: '/portal/:portalId/:groupId/:seriesId', component: Browse, instance: 'browse' },
];
