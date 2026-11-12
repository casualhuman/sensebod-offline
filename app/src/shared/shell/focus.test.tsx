/*
 * Focus after navigation. In its own file because the shell remembers, for
 * the whole page load, whether the first screen has been shown.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Link, navigate, Routes, type RouteDef } from '../router';
import { PageShell } from './index';

const routes: RouteDef[] = [
  {
    path: '/',
    component: () => (
      <PageShell title="Home" variant="home">
        <Link to="/portal/primary">Primary school</Link>
      </PageShell>
    ),
  },
  {
    path: '/portal/:portalId',
    component: () => (
      <PageShell title="Primary school" backTo="/">
        <h1>Primary school</h1>
      </PageShell>
    ),
  },
];

describe('PageShell focus', () => {
  it('leaves focus alone on the first screen, then moves it to the main area after in-app navigation', () => {
    render(<Routes routes={routes} notFound={<p>Not found</p>} />);
    expect(screen.getByRole('main')).not.toHaveFocus();
    expect(document.body).toHaveFocus();

    const link = screen.getByRole('link', { name: 'Primary school' });
    link.focus();
    act(() => navigate('/portal/primary'));
    const main = screen.getByRole('main');
    expect(main).toHaveFocus();
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(document.title).toBe('Primary school · Sensebod');

    // Back to Home with the browser's Back button: the new screen's main area again.
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('main')).toHaveFocus();
    expect(document.title).toBe('Home · Sensebod');
  });

  it('has a skip link to the main area', () => {
    render(<Routes routes={routes} notFound={<p>Not found</p>} />);
    expect(screen.getByRole('link', { name: 'Skip to the main part' })).toHaveAttribute('href', '#sb-main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'sb-main');
  });
});
