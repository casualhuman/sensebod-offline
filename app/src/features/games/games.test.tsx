import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { featureFor } from '../../app/features';
import { paths, Routes } from '@shared/router';
import { PageShell } from '@shared/shell';
import { features } from '@shared/switches';
import {
  CATEGORIES,
  findGame,
  gamePath,
  GAMES,
  gamesIn,
  TO_BE_CONFIRMED,
  type Game,
} from './catalogue';
import { GamePlayer } from './GamePlayer';
import { routes } from './routes';

function open(path: string) {
  window.history.replaceState(null, '', path);
  return render(<Routes routes={routes} notFound={<p>no route</p>} />);
}

function tap(element: HTMLElement) {
  fireEvent.click(element, { button: 0 });
}

/** A game as it will be once its files are in the bag. */
const INSTALLED: Game = {
  id: 'test-game',
  title: 'Test game',
  description: 'A game for the tests.',
  category: 'puzzles',
  sourceProject: 'Test project',
  licence: 'MIT',
  installed: true,
  path: gamePath('test-game'),
};

afterEach(() => {
  features.games = true;
  vi.unstubAllGlobals();
});

describe('games catalogue', () => {
  it('gives every game a unique slug id and its own folder', () => {
    const ids = GAMES.map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const game of GAMES) {
      expect(game.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(game.path).toBe(`/games/${game.id}/index.html`);
      expect(findGame(game.id)).toBe(game);
    }
  });

  it('gives every game a known category and the words a card needs', () => {
    const categoryIds = CATEGORIES.map((category) => category.id);
    expect(new Set(categoryIds).size).toBe(categoryIds.length);
    for (const game of GAMES) {
      expect(categoryIds).toContain(game.category);
      expect(game.title.trim()).not.toBe('');
      expect(game.description.trim()).not.toBe('');
      expect(game.description).not.toMatch(/\n/);
      expect(game.sourceProject.trim()).not.toBe('');
      expect(game.licence.trim()).not.toBe('');
      expect(typeof game.installed).toBe('boolean');
    }
  });

  it('does not offer a game as installed while its licence is not confirmed', () => {
    for (const game of GAMES.filter((item) => item.installed)) {
      expect(game.licence).not.toBe(TO_BE_CONFIRMED);
      expect(game.sourceProject).not.toBe(TO_BE_CONFIRMED);
    }
  });

  it('has no empty category and the starting games', () => {
    for (const category of CATEGORIES) {
      expect(GAMES.some((game) => game.category === category.id)).toBe(true);
    }
    for (const id of ['blockly-games', '2048', 'hextris', 'tetris', 'tower-blocks', 'snake', 'dino-runner', 'clumsy-bird', 'open-chess']) {
      expect(findGame(id)).toBeDefined();
    }
  });

});

describe('Games home', () => {
  it('shows the categories, each with its number of games; Back goes Home', () => {
    open('/games');
    expect(screen.getByRole('heading', { level: 1, name: 'Games' })).toBeInTheDocument();
    expect(document.title).toBe('Games · Sensebod Offline');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
    const titles = Array.from(document.querySelectorAll('.sb-topic-card__title')).map((node) => node.textContent);
    expect(titles).toEqual(CATEGORIES.map((category) => category.title));
    for (const category of CATEGORIES) {
      const card = screen.getByText(category.title).closest('a') as HTMLElement;
      expect(card).toHaveAttribute('href', `/games?category=${category.id}`);
      const count = gamesIn(category.id).length;
      expect(within(card).getByText(count === 1 ? '1 game' : `${count} games`)).toBeInTheDocument();
    }
    // No game is listed before a category is chosen.
    expect(screen.queryByText((GAMES[0] as Game).title)).toBeNull();
  });

  it('a chosen category shows its games only, and Back goes to the categories', () => {
    open('/games?category=thinking');
    expect(screen.getByRole('heading', { level: 1, name: 'Thinking games' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/games');
    const titles = Array.from(document.querySelectorAll('.sb-topic-card__title')).map((node) => node.textContent);
    expect(titles).toEqual(gamesIn('thinking').map((game) => game.title));
  });

  it('a category the app does not know offers the way back', () => {
    open('/games?category=cooking');
    expect(screen.getByText('This kind of game is not in this bag')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Games' })).toHaveAttribute('href', '/games');
  });

  it('says in words that a game is not in the bag, and does not link to it', () => {
    const first = GAMES.filter((game) => !game.installed)[0];
    if (!first) return; // every game has been installed
    open(`/games?category=${first.category}`);
    const card = screen.getByText(first.title).closest('.sb-card') as HTMLElement;
    expect(card).toHaveClass('sb-card--unavailable');
    expect(card.tagName).not.toBe('A');
    expect(within(card).getByText('Not in bag')).toBeInTheDocument();
    expect(within(card).getByText('Not in this bag yet. Ask your facilitator.')).toBeInTheDocument();
    if (GAMES.every((game) => !game.installed)) expect(screen.getByText('No games in this bag yet')).toBeInTheDocument();
  });
});

describe('Game page', () => {
  it('shows a friendly state, not a frame, for a game that is not in the bag yet', () => {
    const missing = GAMES.filter((game) => !game.installed)[0];
    if (!missing) return; // every game has been installed
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    open(paths.game(missing.id));
    expect(screen.getByRole('heading', { level: 1, name: missing.title })).toBeInTheDocument();
    expect(screen.getByText('This game is not in this bag yet')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Both ways back go to the list the game is in.
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', `/games?category=${missing.category}`);
    expect(screen.getByRole('link', { name: 'Back to Games' })).toHaveAttribute('href', `/games?category=${missing.category}`);
    expect(screen.getByText(`From the project: ${missing.sourceProject}. Licence: ${missing.licence}.`)).toBeInTheDocument();
  });

  it('shows a way back for a game the catalogue does not know', () => {
    open('/games/no-such-game');
    expect(screen.getByText('This game is not in this bag')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Games' })).toHaveAttribute('href', '/games');
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('GamePlayer (an installed game)', () => {
  it('opens /games/<id>/index.html in a sandboxed frame at once, with no second Play button', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<GamePlayer game={INSTALLED} />);
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith('/games/test-game/index.html', { method: 'HEAD', credentials: 'omit' });
    const frame = await waitFor(() => {
      const found = document.querySelector('iframe');
      expect(found).not.toBeNull();
      return found as HTMLIFrameElement;
    });
    expect(frame).toHaveAttribute('src', '/games/test-game/index.html');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('title', 'Test game');
    expect(screen.getByText('Opening the game…')).toBeInTheDocument();
    fireEvent.load(frame);
    expect(screen.queryByText('Opening the game…')).toBeNull();

    // "Start again" throws the frame away and loads the game afresh.
    tap(screen.getByRole('button', { name: 'Start again' }));
    expect(document.querySelector('iframe')).not.toBe(frame);
    expect(screen.getByText('Opening the game…')).toBeInTheDocument();
  });

  it('says the game is not in the bag when its files are missing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
    render(<GamePlayer game={INSTALLED} />);
    expect(await screen.findByText('This game is not in this bag yet')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('offers Try again when the bag cannot be reached', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchSpy);
    render(<GamePlayer game={INSTALLED} />);
    expect(await screen.findByText('The game did not open')).toBeInTheDocument();
    tap(screen.getByRole('button', { name: 'Try again' }));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await act(async () => {});
  });
});

describe('the Games switch and the header entry', () => {
  it('routes /games to the games feature and shows "Games" in the header', () => {
    expect(featureFor('/games').id).toBe('games');
    expect(featureFor('/games/2048').id).toBe('games');
    expect(featureFor('/games-are-fun').id).toBe('learner');
    render(
      <PageShell title="Home" variant="home">
        <h1>Home</h1>
      </PageShell>,
    );
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const link = within(nav).getByRole('link', { name: 'Games' });
    expect(link).toHaveAttribute('href', '/games');
    expect(link).not.toHaveAttribute('aria-current');
  });

  it('marks the entry as the open section on a Games screen; inner screens show it from tablet width', () => {
    open('/games');
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(nav).toHaveClass('sb-from-tablet');
    expect(within(nav).getByRole('link', { name: 'Games' })).toHaveAttribute('aria-current', 'page');
  });

  it('leaves Child protection screens with the quick exit only', () => {
    render(
      <PageShell title="Staying safe" backTo="/portal/child-protection" quickExit>
        <h1>Staying safe</h1>
      </PageShell>,
    );
    expect(screen.queryByRole('link', { name: 'Games' })).toBeNull();
  });

  it('switched off: no header entry, and /games answers like an unknown page', async () => {
    features.games = false;
    expect(featureFor('/games').id).toBe('learner');
    expect(featureFor('/games/2048').id).toBe('learner');
    window.history.replaceState(null, '', '/games');
    render(<App />);
    expect(await screen.findByText('This page is not in this bag')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Games' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Games' })).toBeNull();
  });
});
