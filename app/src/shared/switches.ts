/*
 * Parts of the app that are built but switched off for now.
 *
 * Listen: there are no recordings yet, so every Listen button would only say
 * "No sound here yet". Language: there are no Krio translations yet, so the
 * switch would change nothing on screen. Set a line to `true` to bring that
 * part back everywhere; nothing else needs to change.
 *
 * The tests switch both on (src/shared/test/setup.ts) so the code that is
 * waiting stays tested.
 *
 * Games: the Games section (src/features/games, docs: app/docs/GAMES.md).
 * Set to `false` to take it away everywhere: the "Games" entry in the header
 * goes, and /games answers like any unknown page.
 */
export const features = {
  listen: false,
  languageSwitch: false,
  games: true,
};
