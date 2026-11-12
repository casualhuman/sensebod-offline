/* Development only. Not part of the production bundle (see ../features.ts). */
import type { RouteDef } from '@shared/router';
import { KitchenSink } from './KitchenSink';

export const routes: RouteDef[] = [
  { path: '/__dev', component: KitchenSink },
  { path: '/__dev/kitchen-sink', component: KitchenSink },
];
