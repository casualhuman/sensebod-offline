/*
 * A-03: after one failed download of a feature chunk, the cached React.lazy
 * component stays rejected for the life of the page. "Go to Home" and any
 * other in-app navigation into that feature show the error again and the
 * download is never attempted a second time, even though it would succeed.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { navigate } from '@shared/router';

const calls = vi.hoisted(() => ({ count: 0 }));

vi.mock('@app/features', () => {
  const learner = {
    id: 'learner',
    prefixes: ['/'],
    load: () => {
      calls.count += 1;
      // First attempt: the bag's Wi-Fi dropped. Every later attempt would work.
      if (calls.count === 1) return Promise.reject(new Error('Failed to fetch dynamically imported module'));
      return Promise.resolve({
        routes: [
          { path: '/', component: () => <h1>Home loaded</h1> },
          { path: '/save-progress', component: () => <h1>Save loaded</h1> },
        ],
      });
    },
  };
  return { featureFor: () => learner, allFeatures: [learner] };
});

describe('A-03 a failed feature download is never retried in place', () => {
  it('keeps showing the error after Go to Home and after navigating elsewhere in the feature', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { App } = await import('@app/App');
    render(<App />);
    expect(await screen.findByText('This page did not open')).toBeInTheDocument();
    expect(calls.count).toBe(1);

    // The offered way out. The network is "back" (load would now resolve).
    fireEvent.click(screen.getByRole('link', { name: 'Go to Home' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('This page did not open')).toBeInTheDocument();
    expect(screen.queryByText('Home loaded')).toBeNull();

    // Another URL of the same feature: the boundary resets, the poisoned lazy throws again.
    act(() => navigate('/save-progress'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('This page did not open')).toBeInTheDocument();
    expect(screen.queryByText('Save loaded')).toBeNull();

    // The download was attempted exactly once: only a full page reload can recover.
    expect(calls.count).toBe(1);
    quiet.mockRestore();
  });
});
