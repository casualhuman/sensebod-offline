import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Suspense, useEffect, useState, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bagReachable, lazyScreen, Link, loadPageIfReachable, navigate, pageLoad, Routes, useParams, useQuery, type RouteDef } from './index';

const mounts: string[] = [];

function Player() {
  const { lessonId } = useParams<'lessonId'>();
  const [answer, setAnswer] = useState<string | null>(null);
  useEffect(() => {
    mounts.push(`mount ${lessonId}`);
    return () => {
      mounts.push(`unmount ${lessonId}`);
    };
    // Mount and unmount only: this records the life of the instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <p>
        lesson {lessonId} · answer: {answer ?? 'none'}
      </p>
      <button type="button" onClick={() => setAnswer('B')}>
        Answer B
      </button>
    </div>
  );
}

function Stateful({ name }: { name: string }) {
  const params = useParams();
  const [taps, setTaps] = useState(0);
  return (
    <button type="button" onClick={() => setTaps(taps + 1)}>
      {name} [{Object.keys(params).map((key) => `${key}=${params[key]}`).join(',')}] taps: {taps}
    </button>
  );
}

const Admin = () => <Stateful name="admin" />;
const Browse = () => <Stateful name="browse" />;

const routes: RouteDef[] = [
  { path: '/lesson/:lessonId', component: Player },
  { path: '/admin/*', component: Admin },
  { path: '/portal/:portalId', component: Browse, instance: 'browse' },
  { path: '/portal/:portalId/:groupId', component: Browse, instance: 'browse' },
];

function open(path: string) {
  window.history.replaceState(null, '', path);
  return render(<Routes routes={routes} notFound={<p>Not found</p>} />);
}

beforeEach(() => {
  mounts.length = 0;
});

describe('one screen instance per route and params (A-02)', () => {
  it('starts a fresh screen when only a path param changes', () => {
    open('/lesson/a');
    fireEvent.click(screen.getByRole('button', { name: 'Answer B' }));
    expect(screen.getByText('lesson a · answer: B')).toBeInTheDocument();
    act(() => navigate('/lesson/b'));
    expect(screen.getByText('lesson b · answer: none')).toBeInTheDocument();
    expect(mounts).toEqual(['mount a', 'unmount a', 'mount b']);
  });

  it('keeps the screen when only the query string changes', () => {
    open('/lesson/a');
    fireEvent.click(screen.getByRole('button', { name: 'Answer B' }));
    act(() => navigate('/lesson/a?type=watch', { keepScroll: true }));
    expect(screen.getByText('lesson a · answer: B')).toBeInTheDocument();
    expect(mounts).toEqual(['mount a']);
  });

  it('keeps a wildcard screen across its own sub-steps', () => {
    open('/admin');
    fireEvent.click(screen.getByRole('button'));
    act(() => navigate('/admin/add/place'));
    expect(screen.getByRole('button')).toHaveTextContent('admin [*=add/place] taps: 1');
    act(() => navigate('/admin/library'));
    expect(screen.getByRole('button')).toHaveTextContent('admin [*=library] taps: 1');
  });

  it('routes that name the same `instance` share one mounted screen across routes and params', () => {
    open('/portal/primary');
    fireEvent.click(screen.getByRole('button'));
    act(() => navigate('/portal/primary/class-4'));
    expect(screen.getByRole('button')).toHaveTextContent('browse [portalId=primary,groupId=class-4] taps: 1');
    act(() => navigate('/portal/jss'));
    expect(screen.getByRole('button')).toHaveTextContent('browse [portalId=jss] taps: 1');
  });
});

describe('useQuery (A-05)', () => {
  it('returns the same object while the query string is the same, a new one when it changes', () => {
    const seen: URLSearchParams[] = [];
    function Probe() {
      seen.push(useQuery());
      return null;
    }
    window.history.replaceState(null, '', '/admin/library?type=watch');
    const view = render(<Probe />);
    view.rerender(<Probe />);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[0]?.get('type')).toBe('watch');
    act(() => navigate('/admin/library?type=read', { keepScroll: true }));
    const last = seen[seen.length - 1];
    expect(last).not.toBe(seen[0]);
    expect(last?.get('type')).toBe('read');
  });

  it('does not run an effect again when used as a dependency', async () => {
    let runs = 0;
    function Library() {
      const query = useQuery();
      const [, setAnswer] = useState('');
      useEffect(() => {
        runs += 1;
        setAnswer(`page ${runs} for ${query.get('type') ?? 'all'}`);
      }, [query]);
      return null;
    }
    window.history.replaceState(null, '', '/admin/library?type=watch');
    render(<Library />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runs).toBe(1);
  });
});

describe('navigating to the URL already open (A-14)', () => {
  it('does not add a history entry', () => {
    window.history.replaceState(null, '', '/lesson/a');
    const before = window.history.length;
    navigate('/lesson/b');
    expect(window.history.length).toBe(before + 1);
    navigate('/lesson/b');
    navigate('/lesson/b');
    expect(window.history.length).toBe(before + 1);
    navigate('/lesson/b?type=watch');
    expect(window.history.length).toBe(before + 2);
  });

  it('a link to the current page, tapped twice, adds nothing', () => {
    window.history.replaceState(null, '', '/x');
    const before = window.history.length;
    render(<Link to="/x">Here</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Here' }));
    fireEvent.click(screen.getByRole('link', { name: 'Here' }));
    expect(window.history.length).toBe(before);
    expect(window.location.pathname).toBe('/x');
  });
});

describe('asking the bag before a page load', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is reachable when the bag answers, with an address no cache can answer', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await bagReachable()).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^\/\?reach=/);
    expect(init.cache).toBe('no-store');
  });

  it('is not reachable on a network error, an error answer, a throwing fetch or no answer in time', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await bagReachable()).toBe(false);
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 502 })));
    expect(await bagReachable()).toBe(false);
    vi.stubGlobal('fetch', () => {
      throw new Error('no fetch here');
    });
    expect(await bagReachable()).toBe(false);
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const slow = bagReachable(500);
    vi.advanceTimersByTime(600);
    expect(await slow).toBe(false);
  });

  it('loads the page only when the bag answers', async () => {
    const reload = vi.spyOn(pageLoad, 'reload').mockImplementation(() => {});
    const go = vi.spyOn(pageLoad, 'go').mockImplementation(() => {});
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await loadPageIfReachable('/')).toBe(false);
    expect(await loadPageIfReachable(null)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('ok', { status: 200 })));
    expect(await loadPageIfReachable('/portal/primary')).toBe(true);
    expect(go).toHaveBeenCalledWith('/portal/primary');
    expect(await loadPageIfReachable(null)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('lazyScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setUp(failures: number) {
    let loads = 0;
    const Done: ComponentType = () => <h1>Screen loaded</h1>;
    const Lazy = lazyScreen(() => {
      loads += 1;
      return loads <= failures ? Promise.reject<{ default: ComponentType }>(new Error('Failed to fetch dynamically imported module')) : Promise.resolve({ default: Done });
    });
    function Catch({ children }: { children: React.ReactNode }) {
      return <Boundary>{children}</Boundary>;
    }
    const lazyRoutes: RouteDef[] = [
      { path: '/', component: () => <h1>Start</h1> },
      { path: '/done', component: Lazy },
    ];
    render(
      <Catch>
        <Suspense fallback={<p>Opening…</p>}>
          <Routes routes={lazyRoutes} notFound={<p>Not found</p>} />
        </Suspense>
      </Catch>,
    );
    return { loads: () => loads };
  }

  it('loads once and keeps the screen', async () => {
    const state = setUp(0);
    act(() => navigate('/done'));
    expect(await screen.findByText('Screen loaded')).toBeInTheDocument();
    act(() => navigate('/'));
    act(() => navigate('/done'));
    expect(await screen.findByText('Screen loaded')).toBeInTheDocument();
    expect(state.loads()).toBe(1);
  });

  it('shows the failure once, without retrying by itself, then asks again on the next visit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = setUp(1);
    act(() => navigate('/done'));
    expect(await screen.findByText('Could not open')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.loads()).toBe(1);
    // The learner leaves (the boundary clears), then comes back.
    act(() => navigate('/'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByText('Start')).toBeInTheDocument();
    act(() => navigate('/done'));
    expect(await screen.findByText('Screen loaded')).toBeInTheDocument();
    expect(state.loads()).toBe(2);
  });

  it('after a second failure loads a fresh page, but only if the bag answers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.spyOn(pageLoad, 'reload').mockImplementation(() => {});
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('ok', { status: 200 })));
    setUp(5);
    act(() => navigate('/done'));
    await screen.findByText('Could not open');
    expect(reload).not.toHaveBeenCalled();
    // The learner leaves (the boundary clears), then comes back.
    act(() => navigate('/'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByText('Start')).toBeInTheDocument();
    act(() => navigate('/done'));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Opening…')).toBeInTheDocument();
  });
});

/** A minimal boundary for these tests; the app's real one is tested in src/app. */
class Boundary extends (await import('react')).Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return (
        <div>
          <p>Could not open</p>
          <button type="button" onClick={() => this.setState({ failed: false })}>
            Reset
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
