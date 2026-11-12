/*
 * The error boundary and the recovery after a feature's code could not be
 * downloaded (finding A-03). The feature table is replaced, so each test
 * decides which downloads fail.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate, pageLoad, type RouteDef } from '@shared/router';

const world = vi.hoisted(() => ({
  /** How many of the next downloads fail, per feature. */
  failures: { learner: 0, lessons: 0 } as Record<string, number>,
  loads: { learner: 0, lessons: 0 } as Record<string, number>,
  crash: false,
  /** Bumped before every test: App keeps one lazy screen per feature id, and each test needs new ones (a new page load). */
  generation: 0,
}));

vi.mock('./features', () => {
  function Crashing() {
    if (world.crash) throw new Error('render failed');
    return <h1>Lesson loaded</h1>;
  }
  const routesOf: Record<string, RouteDef[]> = {
    learner: [
      { path: '/', component: () => <h1>Home loaded</h1> },
      { path: '/save-progress', component: () => <h1>Save loaded</h1> },
    ],
    lessons: [{ path: '/lesson/:lessonId', component: Crashing }],
  };
  const made: Record<string, unknown> = {};
  const entry = (id: string, prefix: string) => ({
    id: `${id}-${world.generation}`,
    prefixes: [prefix],
    load: () => {
      world.loads[id] = (world.loads[id] ?? 0) + 1;
      if ((world.failures[id] ?? 0) > 0) {
        world.failures[id] = (world.failures[id] ?? 0) - 1;
        return Promise.reject(new Error('Failed to fetch dynamically imported module'));
      }
      return Promise.resolve({ routes: routesOf[id] });
    },
  });
  const featureFor = (pathname: string) => {
    const id = pathname === '/lesson' || pathname.indexOf('/lesson/') === 0 ? 'lessons' : 'learner';
    const key = `${id}-${world.generation}`;
    return made[key] ?? (made[key] = entry(id, id === 'lessons' ? '/lesson' : '/'));
  };
  return { featureFor, allFeatures: [] };
});

/** Whether the bag answers the "are you there?" request. */
let bagUp = true;
let reach: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.spyOn>;
let go: ReturnType<typeof vi.spyOn>;

async function freshApp() {
  const { App } = await import('./App');
  return render(<App />);
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  world.failures = { learner: 0, lessons: 0 };
  world.loads = { learner: 0, lessons: 0 };
  world.crash = false;
  world.generation += 1;
  bagUp = true;
  reach = vi.fn(() => (bagUp ? Promise.resolve(new Response('<!doctype html>', { status: 200 })) : Promise.reject(new TypeError('Failed to fetch'))));
  vi.stubGlobal('fetch', reach);
  reload = vi.spyOn(pageLoad, 'reload').mockImplementation(() => {});
  go = vi.spyOn(pageLoad, 'go').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a feature whose code could not be downloaded', () => {
  it('shows the error screen with a way out, inside the page shell', async () => {
    world.failures.learner = 1;
    await freshApp();
    expect(await screen.findByText('This page did not open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('navigation', { name: 'Go back' })).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it('"Try again" asks the bag first and loads a fresh page when it answers', async () => {
    world.failures.learner = 1;
    await freshApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(reach).toHaveBeenCalledTimes(1);
    expect(String(reach.mock.calls[0]?.[0])).toMatch(/^\/\?reach=/);
    expect(reach.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('"Try again" stays on the Sensebod error screen while the bag is out of reach', async () => {
    world.failures.learner = 1;
    bagUp = false;
    await freshApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/This phone cannot reach the bag/)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    // Still offered, and it works once the bag is back.
    bagUp = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('"Go to Home" works when the failed code is Home’s own: it loads Home as a fresh page', async () => {
    world.failures.learner = 1;
    await freshApp();
    fireEvent.click(await screen.findByRole('link', { name: 'Go to Home' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('/'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('Back and Home in the header of the error screen also load a fresh page, after asking the bag', async () => {
    world.failures.lessons = 1;
    window.history.replaceState(null, '', '/lesson/a');
    await freshApp();
    await screen.findByText('This page did not open');
    bagUp = false;
    fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(await screen.findByText(/This phone cannot reach the bag/)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/lesson/a');
    bagUp = true;
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('/'));
  });

  it('ignores a second tap while the bag is being asked', async () => {
    world.failures.learner = 1;
    await freshApp();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fireEvent.click(retry);
    fireEvent.click(screen.getByRole('button', { name: /Trying again/ }));
    fireEvent.click(screen.getByRole('link', { name: 'Go to Home' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(reach).toHaveBeenCalledTimes(1);
    expect(go).not.toHaveBeenCalled();
  });

  it('asks for the code again on the next visit (browser Back, then the lesson again)', async () => {
    world.failures.lessons = 1;
    await freshApp();
    expect(await screen.findByText('Home loaded')).toBeInTheDocument();
    act(() => navigate('/lesson/a'));
    expect(await screen.findByText('This page did not open')).toBeInTheDocument();
    // The learner goes back with the browser, the Wi-Fi returns, they open the lesson again.
    act(() => navigate('/'));
    expect(await screen.findByText('Home loaded')).toBeInTheDocument();
    act(() => navigate('/lesson/a'));
    expect(await screen.findByText('Lesson loaded')).toBeInTheDocument();
    expect(world.loads.lessons).toBe(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('when the second attempt fails too (the loader kept the failure), loads a fresh page if the bag answers', async () => {
    world.failures.lessons = 2;
    await freshApp();
    await screen.findByText('Home loaded');
    act(() => navigate('/lesson/a'));
    await screen.findByText('This page did not open');
    act(() => navigate('/'));
    await screen.findByText('Home loaded');
    act(() => navigate('/lesson/a'));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // "Opening…" stays until the new page replaces this one; no second error screen.
    expect(screen.queryByText('This page did not open')).toBeNull();
    expect(screen.getByText('Opening…')).toBeInTheDocument();
  });

  it('when the second attempt fails and the bag is out of reach, shows the error screen and does not reload', async () => {
    world.failures.lessons = 2;
    await freshApp();
    await screen.findByText('Home loaded');
    act(() => navigate('/lesson/a'));
    await screen.findByText('This page did not open');
    act(() => navigate('/'));
    await screen.findByText('Home loaded');
    bagUp = false;
    act(() => navigate('/lesson/a'));
    expect(await screen.findByText('This page did not open')).toBeInTheDocument();
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('a screen that crashes while drawing', () => {
  it('is contained, and the error clears when the learner goes somewhere else', async () => {
    world.crash = true;
    window.history.replaceState(null, '', '/lesson/a');
    await freshApp();
    expect(await screen.findByText('This page did not open')).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    act(() => navigate('/'));
    expect(await screen.findByText('Home loaded')).toBeInTheDocument();
    expect(screen.queryByText('This page did not open')).toBeNull();
  });
});
