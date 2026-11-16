/*
 * The app's URL scheme in one place. Every stream builds links with these
 * helpers instead of writing path strings, so a screen can link into another
 * stream's feature without importing its code.
 *
 *   /                                         Home (gateway)                 learner
 *   /save-progress                            Save my progress               learner
 *   /portal/:portalId                         portal page                    learner
 *   /portal/:portalId/:groupId                class / audience / topic       learner
 *   /portal/:portalId/:groupId/:seriesId      lesson list of a series        learner
 *   /portal/child-protection/help             Get help now                   learner
 *   /lesson/:lessonId                         lesson player (any type)       lessons
 *   /lesson/:lessonId/done                    finished screen                lessons
 *   /admin, /admin/…                          admin                          admin
 *   /games                                    Games (?category=<id>)         games
 *   /games/:gameId                            one game                       games
 *
 * Anything not under /lesson, /admin or /games belongs to the learner feature.
 * The files of a game are static and live one level deeper, at
 * /games/<id>/index.html (see app/docs/GAMES.md): the app only owns /games
 * and /games/<id>.
 */
const enc = encodeURIComponent;

export const paths = {
  home: (): string => '/',
  saveProgress: (): string => '/save-progress',
  portal: (portalId: string): string => `/portal/${enc(portalId)}`,
  group: (portalId: string, groupId: string): string => `/portal/${enc(portalId)}/${enc(groupId)}`,
  series: (portalId: string, groupId: string, seriesId: string): string =>
    `/portal/${enc(portalId)}/${enc(groupId)}/${enc(seriesId)}`,
  /** Child protection "Get help now". `help` is a reserved group id in that portal. */
  help: (): string => '/portal/child-protection/help',
  lesson: (lessonId: string): string => `/lesson/${enc(lessonId)}`,
  lessonDone: (lessonId: string): string => `/lesson/${enc(lessonId)}/done`,
  admin: (rest = ''): string => (rest ? `/admin/${rest.replace(/^\/+/, '')}` : '/admin'),
  games: (): string => '/games',
  gamesCategory: (categoryId: string): string => `/games?category=${enc(categoryId)}`,
  game: (gameId: string): string => `/games/${enc(gameId)}`,
} as const;
