/*
 * The games catalogue: THE one place a game is registered.
 *
 * Static data, part of the app: no API call, nothing in the mock, nothing in
 * openapi.yaml. To add a game later, or to mark one as copied into the bag,
 * edit `ENTRIES` below and nothing else. The steps are in app/docs/GAMES.md.
 *
 * Where a game's files live: every game has a folder of its own, served by
 * the bag as static files, and is opened at `/games/<id>/index.html`
 * (`gamePath`). The app owns only `/games` and `/games/<id>` (its screens).
 */

/* ---- categories ---- */

export type GameCategoryId = 'thinking' | 'puzzles' | 'quick-play';

export interface GameCategory {
  id: GameCategoryId;
  title: string;
  /** One short line under the title. */
  description: string;
}

/**
 * In the order they are shown. A category exists only while it has a game: "Science and making" and
 * "Early learning" were removed with their games (no open-source game was found for them; docs/GAMES.md).
 */
export const CATEGORIES: readonly GameCategory[] = [
  // Coding, maths and strategy had one game each, so they share one banner.
  { id: 'thinking', title: 'Thinking games', description: 'Plan, count and code. Take your time and think ahead.' },
  { id: 'puzzles', title: 'Puzzles and patterns', description: 'Fit the shapes and find the pattern.' },
  { id: 'quick-play', title: 'Quick play', description: 'Short games for fast fingers.' },
];

/* ---- games ---- */

/** Written where the licence (or the source project) has not been checked yet. */
export const TO_BE_CONFIRMED = 'to be confirmed';

interface GameEntry {
  /** Slug: small letters, digits and "-". Also the name of the game's folder. */
  id: string;
  title: string;
  /** One line, in plain words. */
  description: string;
  category: GameCategoryId;
  /** The open-source project the game comes from. */
  sourceProject: string;
  /**
   * The licence as written in the project's own LICENSE file, e.g. "MIT".
   * `TO_BE_CONFIRMED` until somebody has read that file in the copy that
   * goes into the bag.
   */
  licence: string;
  /** `true` only when the game's files are in the bag (app/docs/GAMES.md). */
  installed: boolean;
}

export interface Game extends GameEntry {
  /** Where the game's files are served: `/games/<id>/index.html`. */
  path: string;
}

/** The address of a game's start page. Root-relative: always the bag itself. */
export function gamePath(id: string): string {
  return `/games/${id}/index.html`;
}

/*
 * Source projects and licences were looked up on GitHub (licence as GitHub
 * reports it, or the first lines of the LICENSE file). They must still be
 * checked against the LICENSE file of the copy that is cloned. "to be
 * confirmed": no open-source project of that name was found yet.
 * Games are grouped by category only, not by class.
 */
const ENTRIES: readonly GameEntry[] = [
  {
    id: 'blockly-games',
    title: 'Blockly Games',
    description: 'Solve puzzles by joining blocks. Best on a tablet or a computer: too small for a phone.',
    category: 'thinking',
    sourceProject: 'Blockly Games (github.com/blockly-games/blockly-games)',
    licence: 'Apache-2.0',
    installed: true,
  },
  {
    id: '2048',
    title: '2048',
    description: 'Slide the tiles. Join the same numbers to reach 2048.',
    category: 'thinking',
    sourceProject: '2048 by Gabriele Cirulli (github.com/gabrielecirulli/2048)',
    licence: 'MIT',
    installed: true,
  },
  {
    id: 'hextris',
    title: 'Hextris',
    description: 'Turn the six-sided shape to catch the falling colours. Fast and fun.',
    category: 'puzzles',
    sourceProject: 'Hextris (github.com/Hextris/hextris)',
    licence: 'GPL-3.0',
    installed: true,
  },
  {
    id: 'tetris',
    title: 'Tetris',
    description: 'Turn the falling shapes and fit them into full lines.',
    category: 'puzzles',
    sourceProject: 'javascript-tetris by Jake Gordon (github.com/jakesgordon/javascript-tetris)',
    licence: 'MIT',
    installed: true,
  },
  {
    id: 'open-chess',
    title: 'Open Chess',
    description: 'Play chess. Plan your moves and solve problems.',
    category: 'thinking',
    sourceProject: 'chess-ai by Zhang Zeyu (github.com/zeyu2001/chess-ai)',
    licence: 'MIT',
    installed: true,
  },
  {
    id: 'tower-blocks',
    title: 'Tower Blocks',
    description: 'Tap at the right time to build the tallest tower.',
    category: 'quick-play',
    sourceProject: 'tower_game by iamkun (github.com/iamkun/tower_game)',
    licence: 'MIT',
    installed: true,
  },
  {
    id: 'snake',
    title: 'Snake',
    description: 'Guide the snake to its food. Do not hit the wall or your own tail.',
    category: 'quick-play',
    sourceProject: 'JavaScript-Snake by patorjk (github.com/patorjk/JavaScript-Snake)',
    licence: 'MIT',
    installed: true,
  },
  {
    id: 'dino-runner',
    title: 'Dino Runner',
    description: 'Tap to jump over what is in the way. Easy to start.',
    category: 'quick-play',
    sourceProject: 't-rex-runner, taken from Chromium (github.com/wayou/t-rex-runner)',
    licence: 'BSD-3-Clause',
    installed: true,
  },
  {
    id: 'clumsy-bird',
    title: 'Clumsy Bird',
    description: 'Tap to keep the bird flying between the pipes.',
    category: 'quick-play',
    sourceProject: 'Clumsy Bird by Ellison Leão (github.com/ellisonleao/clumsy-bird)',
    licence: 'GPL-3.0',
    installed: true,
  },
];

/** Every game the app knows, installed or not. */
export const GAMES: readonly Game[] = ENTRIES.map((entry) => ({ ...entry, path: gamePath(entry.id) }));

/* ---- look-ups ---- */

export function findGame(id: string | undefined): Game | undefined {
  return GAMES.filter((game) => game.id === id)[0];
}

export function findCategory(id: string | null | undefined): GameCategory | undefined {
  return CATEGORIES.filter((category) => category.id === id)[0];
}

/** The games of one category, in catalogue order. */
export function gamesIn(category: GameCategoryId): Game[] {
  return GAMES.filter((game) => game.category === category);
}
