import { installMockApi } from '@mock/installMockFetch';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { allFeatures, featureFor } from './features';

beforeEach(() => {
  installMockApi();
});

describe('feature routing', () => {
  it('sends each URL to its feature', () => {
    expect(featureFor('/').id).toBe('learner');
    expect(featureFor('/save-progress').id).toBe('learner');
    expect(featureFor('/portal/agriculture/x').id).toBe('learner');
    expect(featureFor('/lesson/abc').id).toBe('lessons');
    expect(featureFor('/lesson/abc/done').id).toBe('lessons');
    expect(featureFor('/lessons-are-fun').id).toBe('learner');
    expect(featureFor('/admin').id).toBe('admin');
    expect(featureFor('/admin/library').id).toBe('admin');
  });

  it('every feature route stays inside its own prefixes', async () => {
    for (const feature of allFeatures) {
      const { routes } = await feature.load();
      expect(routes.length).toBeGreaterThan(0);
      for (const route of routes) {
        expect(featureFor(route.path.replace(/\/\*$/, '/x').replace(/:[^/]+/g, 'x')).id).toBe(feature.id);
      }
    }
  });
});

describe('App', () => {
  it('loads the learner feature for Home and shows the portals from the API', async () => {
    render(<App />);
    expect(await screen.findByRole('link', { name: /Primary school/ })).toHaveAttribute('href', '/portal/primary');
    expect(screen.getByRole('link', { name: /Agriculture/ })).toHaveAttribute('data-theme', 'agriculture');
  });

  it('opens a lesson by deep link', async () => {
    window.history.replaceState(null, '', '/lesson/cp-child-staying-safe-1');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'My body belongs to me' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Leave this page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/portal/child-protection/cp-child/cp-child-staying-safe');
  });

  it('shows a way out for an unknown URL inside a feature', async () => {
    window.history.replaceState(null, '', '/portal/nowhere');
    render(<App />);
    expect(await screen.findByText('This page is not in this bag')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });
});
