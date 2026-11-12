/*
 * A-05: useQuery() returns a new URLSearchParams object on every render.
 * Used as a dependency (the natural way to write a filtered list:
 * `useApi(load, [query])`), it makes the request run again after every
 * render; each answer sets state, which renders again: an endless request
 * loop against the Pi. ESLint does not check useApi's dependency list.
 */
import { render } from '@testing-library/react';
import { useApi } from '@shared/api/useApi';
import { useQuery } from '@shared/router';

let requests = 0;

function Library() {
  const query = useQuery();
  const { data } = useApi(() => {
    requests += 1;
    return Promise.resolve(`page for ${query.get('type') ?? 'all'}`);
  }, [query]);
  return <p>{data ?? 'loading'}</p>;
}

describe('A-05 useQuery is not referentially stable', () => {
  it('returns a different object for the same URL on every render', () => {
    const seen: URLSearchParams[] = [];
    function Probe() {
      seen.push(useQuery());
      return null;
    }
    const view = render(<Probe />);
    view.rerender(<Probe />);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('turns useApi(load, [query]) into a request loop although the URL never changes', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.replaceState(null, '', '/admin/library?type=watch');
    const view = render(<Library />);
    await new Promise((resolve) => setTimeout(resolve, 150));
    view.unmount();
    quiet.mockRestore();
    // One request is correct. Anything above a handful is the loop.
    expect(requests).toBeGreaterThan(10);
  });
});
