/*
 * The admin's own URL scheme, built on `paths.admin()` from the shared
 * router. Every admin link goes through here; nothing writes "/admin/…" by hand.
 *
 *   /admin                              Home (ADM-M-Home)
 *   /admin/sign-in                      Sign in (ADM-SignIn)
 *   /admin/menu                         Jumbo menu (ADM-M-Menu)
 *   /admin/add                          Where is your content from? (ADM-Source)
 *   /admin/add/upload                   Upload files (ADM-M-Upload, ADM-Add-2)
 *   /admin/add/notes                    Photos of notes, PDF, Word (ADM-M-Notes)
 *   /admin/add/type                     Type it yourself (ADM-M-Type)
 *   /admin/add/animation                Upload an animation (ADM-M-Animation)
 *   /admin/lessons/:id/place            Where does it go? (ADM-M-Place, ADM-Add-3)
 *   /admin/lessons/:id/picture          Choose a picture (ADM-M-Picture, ADM-Picture)
 *   /admin/lessons/:id/check            Check and publish (ADM-M-Done)
 *   /admin/lessons/:id/questions        Questions (ADM-Questions)
 *   /admin/lessons/:id/try-it           Try it setup (ADM-TryIt)
 *   /admin/library                      Library (ADM-Library)
 *   /admin/series, /admin/series/:id    Series and order (ADM-Series)
 *   /admin/learners | storage | settings   not designed yet
 */
import { paths } from '@shared/router';

const enc = encodeURIComponent;

function withQuery(path: string, query: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (value) parts.push(`${enc(key)}=${enc(value)}`);
  }
  return parts.length > 0 ? `${path}?${parts.join('&')}` : path;
}

export interface LibraryLinkQuery {
  portalId?: string;
  groupId?: string;
  seriesId?: string;
}

export const adminPaths = {
  home: (): string => paths.admin(),
  signIn: (next?: string): string => withQuery(paths.admin('sign-in'), { next }),
  /** `from` is the section the menu was opened from, so the menu can mark "You are here". */
  menu: (from?: string): string => withQuery(paths.admin('menu'), { from }),
  add: (): string => paths.admin('add'),
  addUpload: (): string => paths.admin('add/upload'),
  addNotes: (): string => paths.admin('add/notes'),
  addType: (): string => paths.admin('add/type'),
  addAnimation: (): string => paths.admin('add/animation'),
  place: (lessonId: string): string => paths.admin(`lessons/${enc(lessonId)}/place`),
  /** `from` says where "Use this picture" returns to. */
  picture: (lessonId: string, from?: 'place' | 'check'): string => withQuery(paths.admin(`lessons/${enc(lessonId)}/picture`), { from }),
  check: (lessonId: string): string => paths.admin(`lessons/${enc(lessonId)}/check`),
  questions: (lessonId: string): string => paths.admin(`lessons/${enc(lessonId)}/questions`),
  tryIt: (lessonId: string): string => paths.admin(`lessons/${enc(lessonId)}/try-it`),
  library: (query: LibraryLinkQuery = {}): string => withQuery(paths.admin('library'), { ...query }),
  series: (seriesId?: string): string => (seriesId ? paths.admin(`series/${enc(seriesId)}`) : paths.admin('series')),
  learners: (): string => paths.admin('learners'),
  storage: (): string => paths.admin('storage'),
  settings: (): string => paths.admin('settings'),
};

/**
 * Where to go after signing in. Only a path inside the admin is accepted, so
 * a crafted link (`?next=//elsewhere`) can never send a signed-in person away
 * from this site.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (next.charAt(0) !== '/' || next.charAt(1) === '/' || next.indexOf('\\') !== -1) return null;
  const pathOnly = next.split(/[?#]/)[0] ?? '';
  if (pathOnly !== '/admin' && pathOnly.indexOf('/admin/') !== 0) return null;
  if (pathOnly === '/admin/sign-in') return null;
  return next;
}
