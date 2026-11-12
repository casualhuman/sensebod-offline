import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Link, matchPath, navigate, paths, Routes, useParams, useQuery, type RouteDef } from './index';

describe('matchPath', () => {
  it('matches static paths and ignores a trailing slash', () => {
    expect(matchPath('/', '/')).toEqual({});
    expect(matchPath('/save-progress', '/save-progress/')).toEqual({});
    expect(matchPath('/save-progress', '/other')).toBeNull();
  });

  it('reads and decodes params', () => {
    expect(matchPath('/portal/:portalId/:groupId', '/portal/agriculture/agriculture-rabbits')).toEqual({
      portalId: 'agriculture',
      groupId: 'agriculture-rabbits',
    });
    expect(matchPath('/lesson/:lessonId', '/lesson/a%20b')).toEqual({ lessonId: 'a b' });
  });

  it('does not match a longer or shorter path', () => {
    expect(matchPath('/lesson/:lessonId', '/lesson/x/done')).toBeNull();
    expect(matchPath('/lesson/:lessonId/done', '/lesson/x')).toBeNull();
    expect(matchPath('/lesson/:lessonId', '/lesson/')).toBeNull();
  });

  it('supports a trailing wildcard', () => {
    expect(matchPath('/admin/*', '/admin/library/series')).toEqual({ '*': 'library/series' });
    expect(matchPath('/admin/*', '/admin')).toEqual({ '*': '' });
    expect(matchPath('/admin/*', '/administrator')).toBeNull();
  });
});

describe('paths', () => {
  it('builds the documented URL scheme', () => {
    expect(paths.home()).toBe('/');
    expect(paths.portal('child-protection')).toBe('/portal/child-protection');
    expect(paths.series('agriculture', 'g', 's')).toBe('/portal/agriculture/g/s');
    expect(paths.lesson('cp-child-staying-safe-1')).toBe('/lesson/cp-child-staying-safe-1');
    expect(paths.lessonDone('x')).toBe('/lesson/x/done');
    expect(paths.admin()).toBe('/admin');
    expect(paths.admin('library')).toBe('/admin/library');
    expect(paths.help()).toBe('/portal/child-protection/help');
  });
});

function Show() {
  const { lessonId } = useParams<'lessonId'>();
  const type = useQuery().get('type');
  return (
    <p>
      lesson {lessonId} {type}
    </p>
  );
}

const routes: RouteDef[] = [
  { path: '/', component: () => <Link to="/lesson/abc?type=watch">Open lesson</Link> },
  { path: '/lesson/:lessonId', component: Show },
];

describe('Routes and Link', () => {
  it('renders the matching screen and navigates without a page load', () => {
    render(<Routes routes={routes} notFound={<p>Not found</p>} />);
    const link = screen.getByRole('link', { name: 'Open lesson' });
    expect(link).toHaveAttribute('href', '/lesson/abc?type=watch');
    fireEvent.click(link);
    expect(window.location.pathname).toBe('/lesson/abc');
    expect(screen.getByText('lesson abc watch')).toBeInTheDocument();
  });

  it('shows the fallback for an unknown path and follows the Back button', () => {
    render(<Routes routes={routes} notFound={<p>Not found</p>} />);
    act(() => navigate('/nowhere'));
    expect(screen.getByText('Not found')).toBeInTheDocument();
    act(() => {
      window.history.replaceState(null, '', '/lesson/back');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByText(/lesson back/)).toBeInTheDocument();
  });

  it('leaves modified clicks to the browser', () => {
    render(<Routes routes={routes} notFound={<p>Not found</p>} />);
    // jsdom cannot open a new tab; stop the default once our handler has declined the click.
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(screen.getByRole('link', { name: 'Open lesson' }), { ctrlKey: true });
    expect(window.location.pathname).toBe('/');
  });
});
