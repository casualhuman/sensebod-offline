import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListenButton } from './ListenButton';
import { isListening, listenFailed, startListening, stopListening } from './listen';

/** A stand-in for the browser's audio element: records what the store asks of it. */
class FakeAudio {
  static made: FakeAudio[] = [];
  /** What the next play() does. */
  static playResult: () => Promise<void> | undefined = () => Promise.resolve();
  preload = '';
  src = '';
  paused = true;
  loads = 0;
  private handlers: Record<string, (() => void)[]> = {};

  constructor() {
    FakeAudio.made.push(this);
  }
  addEventListener(type: string, handler: () => void): void {
    (this.handlers[type] ?? (this.handlers[type] = [])).push(handler);
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
  load(): void {
    this.loads += 1;
  }
  pause(): void {
    this.paused = true;
  }
  play(): Promise<void> | undefined {
    this.paused = false;
    return FakeAudio.playResult();
  }
  emit(type: string): void {
    for (const handler of this.handlers[type] ?? []) handler();
  }
}

const element = () => FakeAudio.made[0] as FakeAudio;

beforeEach(() => {
  FakeAudio.playResult = () => Promise.resolve();
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  stopListening();
  vi.unstubAllGlobals();
});

describe('listen store', () => {
  it('fetches nothing until asked, then plays one recording', () => {
    expect(isListening('/media/a.m4a')).toBe(false);
    startListening('/media/a.m4a');
    expect(element().preload).toBe('none');
    expect(element().src).toBe('/media/a.m4a');
    expect(element().paused).toBe(false);
    expect(isListening('/media/a.m4a')).toBe(true);
  });

  it('only one thing speaks at a time, through one audio element', () => {
    startListening('/media/a.m4a');
    startListening('/media/b.m4a');
    expect(FakeAudio.made).toHaveLength(1);
    expect(isListening('/media/a.m4a')).toBe(false);
    expect(isListening('/media/b.m4a')).toBe(true);
    expect(element().src).toBe('/media/b.m4a');
  });

  it('stops, and lets the browser drop the recording', () => {
    startListening('/media/a.m4a');
    const loadsBefore = element().loads;
    stopListening();
    expect(element().paused).toBe(true);
    expect(element().src).toBe('');
    expect(element().loads).toBe(loadsBefore + 1);
    expect(isListening('/media/a.m4a')).toBe(false);
  });

  it('stops by itself at the end', () => {
    startListening('/media/a.m4a');
    element().emit('ended');
    expect(isListening('/media/a.m4a')).toBe(false);
    expect(listenFailed('/media/a.m4a')).toBe(false);
  });

  it('marks the recording as failed when the file cannot be played', () => {
    startListening('/media/broken.m4a');
    element().emit('error');
    expect(isListening('/media/broken.m4a')).toBe(false);
    expect(listenFailed('/media/broken.m4a')).toBe(true);
    // Another recording gets a clean start.
    startListening('/media/a.m4a');
    expect(listenFailed('/media/broken.m4a')).toBe(false);
  });

  it('marks the recording as failed when the browser refuses to play', async () => {
    FakeAudio.playResult = () => Promise.reject(new DOMException('No', 'NotAllowedError'));
    startListening('/media/a.m4a');
    await Promise.resolve();
    await Promise.resolve();
    expect(isListening('/media/a.m4a')).toBe(false);
    expect(listenFailed('/media/a.m4a')).toBe(true);
  });

  it('copes with a play() that returns nothing (old browsers)', () => {
    FakeAudio.playResult = () => undefined;
    startListening('/media/a.m4a');
    expect(isListening('/media/a.m4a')).toBe(true);
  });
});

describe('ListenButton with a recording', () => {
  it('plays on tap, says "Stop" while playing, and stops on the next tap', () => {
    render(<ListenButton src="/media/a.m4a" />);
    const button = screen.getByRole('button', { name: 'Listen' });
    // The words carry the state; no aria-pressed ("Stop, pressed") (A-13).
    expect(button).not.toHaveAttribute('aria-pressed');
    fireEvent.click(button);
    expect(isListening('/media/a.m4a')).toBe(true);
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).not.toHaveAttribute('aria-pressed');
    fireEvent.click(stop);
    expect(isListening('/media/a.m4a')).toBe(false);
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument();
  });

  it('says so in words when the recording cannot be played', () => {
    render(<ListenButton src="/media/broken.m4a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    act(() => element().emit('error'));
    expect(screen.getByRole('button', { name: 'No sound here yet' })).toBeInTheDocument();
  });

  it('stops the sound when the page that owns it goes away', () => {
    const view = render(<ListenButton src="/media/a.m4a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    view.unmount();
    expect(isListening('/media/a.m4a')).toBe(false);
    expect(element().paused).toBe(true);
  });

  it('two buttons on one page: starting one stops the other', () => {
    render(
      <>
        <ListenButton src="/media/a.m4a" label="Listen to the page" />
        <ListenButton src="/media/b.m4a" label="Listen to the question" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Listen to the page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Listen to the question' }));
    expect(screen.getByRole('button', { name: 'Listen to the page' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(1);
  });
});
