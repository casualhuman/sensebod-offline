import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LessonSummary } from '../api/types';
import { ChoiceGroup, ErrorState, FactsRow, Illustration, LessonCard, PortalCard, ScenePicture, TopicCard } from './index';

const lesson: LessonSummary = {
  id: 'l1',
  seriesId: 's1',
  position: 1,
  title: 'Quail housing',
  summary: '',
  picture: null,
  language: 'en',
  type: 'watch',
  interactive: false,
  captions: true,
  readAlong: false,
  needsSound: true,
  length: 125,
  pages: null,
};

/** The observer old browsers get; the test decides when a picture comes near the screen. */
class FakeObserver {
  static made: FakeObserver[] = [];
  watched: Element[] = [];
  disconnected = false;
  options: IntersectionObserverInit | undefined;
  constructor(
    private callback: (entries: { isIntersecting: boolean }[]) => void,
    options?: IntersectionObserverInit,
  ) {
    this.options = options;
    FakeObserver.made.push(this);
  }
  observe(node: Element): void {
    this.watched.push(node);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  show(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }]);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeObserver.made = [];
});

describe('Illustration on a browser without native lazy loading', () => {
  // jsdom has no `loading` on images, like Chrome before 77, so the
  // IntersectionObserver path is the one taken here.
  it('holds the place without asking for the file, then loads it near the screen', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    render(<Illustration src="agriculture/scenes/quail-house" alt="A quail house on legs" width={360} height={200} />);
    expect(document.querySelector('img')).toBeNull();
    const placeholder = screen.getByRole('img', { name: 'A quail house on legs' });
    expect(placeholder.tagName).toBe('SPAN');
    const observer = FakeObserver.made[0] as FakeObserver;
    expect(observer.watched).toEqual([placeholder]);
    expect(observer.options?.rootMargin).toBe('300px 0px');

    act(() => observer.show(false));
    expect(document.querySelector('img')).toBeNull();
    act(() => observer.show(true));
    const img = screen.getByRole('img', { name: 'A quail house on legs' });
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toMatch(/^\/illustrations\/agriculture\/scenes\/quail-house\.svg/);
    expect(observer.disconnected).toBe(true);
  });

  it('hides a decorative placeholder from screen readers instead of leaving a nameless image (A-13)', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const view = render(<Illustration src="/media/x.png" alt="" />);
    const placeholder = view.container.querySelector('.sb-illustration');
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(placeholder).not.toHaveAttribute('role');
  });

  it('loads at once when asked to, and stops watching when it goes away', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const eager = render(<Illustration src="/media/top.png" alt="Top picture" eager />);
    expect(eager.container.querySelector('img')).toHaveAttribute('src', '/media/top.png');
    expect(FakeObserver.made).toHaveLength(0);
    const lazy = render(<Illustration src="/media/low.png" alt="Lower picture" />);
    lazy.unmount();
    expect(FakeObserver.made[0]?.disconnected).toBe(true);
  });

  it('loads at once as the last resort when there is no observer either', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const view = render(<Illustration src="/media/x.png" alt="A picture" />);
    expect(view.container.querySelector('img')).toHaveAttribute('src', '/media/x.png');
  });
});

describe('a picture that does not load (A-13)', () => {
  it('is taken out so the card keeps its tint; its words stay for screen readers', () => {
    const view = render(<ScenePicture picture={{ url: '/media/missing.png', alt: 'A hen and her chicks' }} eager />);
    fireEvent.error(view.container.querySelector('img') as HTMLImageElement);
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('.sb-picture')).not.toBeNull();
    expect(screen.getByText('A hen and her chicks')).toHaveClass('sb-visually-hidden');
  });

  it('gives a new picture a new chance', () => {
    const view = render(<Illustration src="/media/missing.png" alt="" eager />);
    fireEvent.error(view.container.querySelector('img') as HTMLImageElement);
    expect(view.container.querySelector('img')).toBeNull();
    view.rerender(<Illustration src="/media/other.png" alt="" eager />);
    expect(view.container.querySelector('img')).toHaveAttribute('src', '/media/other.png');
  });
});

describe('facts row', () => {
  it('is a list on its own', () => {
    render(<FactsRow tag={lesson} />);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
  });

  it('is plain text inside a lesson card, which is one link (A-13)', () => {
    render(<LessonCard lesson={lesson} to="/lesson/l1" state="not-started" />);
    const card = screen.getByRole('link');
    expect(card.querySelector('ul, li, div, p')).toBeNull();
    expect(card).toHaveTextContent('Needs sound');
    expect(card).toHaveTextContent('Captions');
    expect(card.querySelector('.sb-facts')?.tagName).toBe('SPAN');
  });
});

describe('ChoiceGroup on a keyboard (A-13)', () => {
  function Quiz({ disabled = false }: { disabled?: boolean }) {
    const [value, setValue] = useState<'a' | 'b' | 'c' | null>(null);
    return (
      <ChoiceGroup
        label="Answers"
        value={value}
        onChange={setValue}
        disabled={disabled}
        options={[
          { value: 'a', label: 'First' },
          { value: 'b', label: 'Second' },
          { value: 'c', label: 'Third' },
        ]}
      />
    );
  }

  it('arrow keys move to and choose the next and previous row, wrapping round', () => {
    render(<Quiz />);
    const radios = screen.getAllByRole('radio');
    (radios[0] as HTMLElement).focus();
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowDown' });
    expect(radios[1]).toHaveFocus();
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(radios[1] as HTMLElement, { key: 'ArrowRight' });
    expect(radios[2]).toHaveFocus();
    fireEvent.keyDown(radios[2] as HTMLElement, { key: 'ArrowDown' });
    expect(radios[0]).toHaveFocus();
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowUp' });
    expect(radios[2]).toHaveFocus();
    fireEvent.keyDown(radios[2] as HTMLElement, { key: 'ArrowLeft' });
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });

  it('leaves other keys alone, keeps every row reachable with Tab, and does nothing when disabled', () => {
    const view = render(<Quiz />);
    const radios = screen.getAllByRole('radio');
    (radios[0] as HTMLElement).focus();
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'Tab' });
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'x' });
    expect(screen.queryByRole('radio', { checked: true })).toBeNull();
    for (const radio of radios) expect(radio).not.toHaveAttribute('tabindex', '-1');
    view.unmount();
    render(<Quiz disabled />);
    fireEvent.keyDown(screen.getAllByRole('radio')[0] as HTMLElement, { key: 'ArrowDown' });
    expect(screen.queryByRole('radio', { checked: true })).toBeNull();
  });
});

describe('card options added for the learner screens', () => {
  it('PortalCard says "Open" unless told otherwise (CPB-Who: "This is me")', () => {
    const view = render(<PortalCard to="/a" title="Primary school" description="Class 1 to Class 6" picture={null} icon={null} />);
    expect(screen.getByRole('link')).toHaveTextContent('Open');
    view.rerender(<PortalCard to="/a" title="I am a child" description="Stories to help you stay safe." picture={null} icon={null} actionLabel="This is me" />);
    expect(screen.getByRole('link')).toHaveTextContent('This is me');
    expect(screen.getByRole('link')).not.toHaveTextContent('Open');
  });

  it('TopicCard shows a facts row when given one (AGB-Agriculture: "Needs sound")', () => {
    const view = render(<TopicCard to="/t" title="Rabbits" picture={null} icon={null} state="not-started" detail="9 videos" />);
    expect(view.container.querySelector('.sb-topic-card__facts')).toBeNull();
    view.rerender(<TopicCard to="/t" title="Rabbits" picture={null} icon={null} state="not-started" detail="9 videos" facts={<span className="sb-facts">Needs sound</span>} />);
    expect(screen.getByRole('link')).toHaveTextContent('Needs sound');
  });
});

describe('ErrorState while "Try again" runs', () => {
  it('shows it is busy and ignores taps', () => {
    const retry = vi.fn();
    const view = render(<ErrorState onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
    view.rerender(<ErrorState onRetry={retry} retrying />);
    const busy = screen.getByRole('button', { name: 'Trying again…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(busy);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
