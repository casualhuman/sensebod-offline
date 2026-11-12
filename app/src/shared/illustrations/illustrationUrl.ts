/*
 * Path scheme for the drawings in the repository's `illustrations/` folder:
 *
 *   /illustrations/<portal>/<cast|scenes>/<name>.svg?v=<version>
 *
 * which mirrors the folder exactly (portal = child-protection | climate |
 * agriculture). `v` is a hash of the whole folder, set at build time, so the
 * Pi can cache the files for a year and a changed drawing is still picked up
 * after the next deployment.
 */

export type IllustrationPortal = 'child-protection' | 'climate' | 'agriculture';

/** `illustrationUrl('agriculture/scenes/quail-house')` → '/illustrations/agriculture/scenes/quail-house.svg?v=…' */
export function illustrationUrl(key: string): string {
  const clean = key.replace(/^\/+/, '').replace(/\.svg$/, '');
  return `/illustrations/${clean}.svg?v=${__ILLUSTRATIONS_VERSION__}`;
}

/**
 * Accepts what components are given: an illustration key, or a root-relative
 * URL from the API. Illustration URLs without a version get the build's one.
 */
export function resolvePictureUrl(src: string): string {
  if (src.charAt(0) !== '/') return illustrationUrl(src);
  if (src.indexOf('/illustrations/') === 0 && src.indexOf('?') === -1) return `${src}?v=${__ILLUSTRATIONS_VERSION__}`;
  return src;
}

export function castUrl(portal: IllustrationPortal, name: string): string {
  return illustrationUrl(`${portal}/cast/${name}`);
}

export function sceneUrl(portal: IllustrationPortal, name: string): string {
  return illustrationUrl(`${portal}/scenes/${name}`);
}
