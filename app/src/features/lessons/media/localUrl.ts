/**
 * True for a root-relative address served by the bag itself ("/media/…").
 * The API contract promises only such addresses; this is the last line of
 * defence so a wrong record can never make a phone ask the internet for a
 * video, a sound or an activity.
 */
export function isLocalUrl(url: string): boolean {
  return url.charAt(0) === '/' && url.charAt(1) !== '/' && url.charAt(1) !== '\\';
}
