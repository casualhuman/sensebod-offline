import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getSession, setChildProtectionAudience, setLearner } from '../session';
import { ListenButton, PageShell } from './index';

describe('PageShell', () => {
  it('gives every inner screen Back and Home, and sets the page title', () => {
    render(
      <PageShell title="Agriculture" theme="agriculture" backTo="/portal/agriculture">
        <h1>Agriculture</h1>
      </PageShell>,
    );
    const nav = screen.getByRole('navigation', { name: 'Go back' });
    expect(within(nav).getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/portal/agriculture');
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(document.title).toBe('Agriculture · Sensebod');
    expect(document.querySelector('.sb-shell')).toHaveAttribute('data-theme', 'agriculture');
    expect(screen.queryByRole('link', { name: 'Leave this page' })).toBeNull();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'sb-main');
  });

  it('shows the language switch but no Back on Home', () => {
    render(
      <PageShell title="Home" variant="home">
        <h1>Home</h1>
      </PageShell>,
    );
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
    const language = screen.getByRole('group', { name: 'Language' });
    expect(within(language).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(language).getByRole('button', { name: 'Krio' }));
    expect(getSession().language).toBe('kri');
  });

  it('adds the quick exit on Child protection screens: Home, no way back, choice forgotten', () => {
    window.history.replaceState(null, '', '/portal/child-protection/cp-child');
    setLearner({ id: 'l1', name: 'Fatmata', role: 'learner', roleLabel: 'Learner' });
    setChildProtectionAudience('cp-child');
    const before = window.history.length;
    render(
      <PageShell title="Staying safe" backTo="/portal/child-protection" quickExit listenSrc={null}>
        <h1>Staying safe</h1>
      </PageShell>,
    );
    const leave = screen.getByRole('link', { name: 'Leave this page' });
    expect(leave).toHaveAttribute('href', '/');
    fireEvent.click(leave);
    expect(window.location.pathname).toBe('/');
    expect(window.history.length).toBe(before);
    expect(getSession().childProtectionAudience).toBeNull();
    expect(getSession().learner?.name).toBe('Fatmata');
  });
});

describe('ListenButton', () => {
  it('says so in words when nothing is recorded', () => {
    render(<ListenButton src={null} label="Listen to this page" />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen to this page' }));
    expect(screen.getByRole('button', { name: 'No sound here yet' })).toBeInTheDocument();
  });
});
