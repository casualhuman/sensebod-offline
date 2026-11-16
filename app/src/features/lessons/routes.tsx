/*
 * Lesson players: route table (stream 3).
 *
 * This file is the only thing the app router knows about this feature, and
 * the app router already loads it lazily, the first time a /lesson URL is
 * opened. The two screens are imported directly rather than through a second
 * `lazy()`: the whole feature is then ONE request (measured) instead of three small ones in a
 * row, which matters more on the bag's Wi-Fi than the few kilobytes a
 * learner might not need. Every lesson after the first downloads no code.
 */
import type { RouteDef } from '@shared/router';
import LessonDoneScreen from './screens/LessonDoneScreen';
import LessonScreen from './screens/LessonScreen';

export const routes: RouteDef[] = [
  // Specific first: the first match wins.
  { path: '/lesson/:lessonId/done', component: LessonDoneScreen },
  { path: '/lesson/:lessonId', component: LessonScreen },
];
