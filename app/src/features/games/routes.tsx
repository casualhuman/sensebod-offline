/*
 * Games: route table. The only file the app router knows about this feature
 * (src/app/features.ts), which loads it the first time a /games URL is
 * opened and only while the `games` switch is on (src/shared/switches.ts).
 *
 * The two screens are imported directly, as in the lessons feature: the
 * whole section is then one small request instead of three in a row. No game
 * code is in here: a game is a folder of static files that the bag serves at
 * /games/<id>/index.html (app/docs/GAMES.md).
 */
import type { RouteDef } from '@shared/router';
import GameScreen from './screens/GameScreen';
import GamesHome from './screens/GamesHome';
import './games.css';

export const routes: RouteDef[] = [
  { path: '/games', component: GamesHome },
  { path: '/games/:gameId', component: GameScreen },
];
