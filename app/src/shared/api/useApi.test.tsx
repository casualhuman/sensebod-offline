import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import { useApi } from './useApi';

/** A request the test settles by hand. */
interface Pending {
  id: string;
  signal: AbortSignal | undefined;
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
}

function manualLoader() {
  const pending: Pending[] = [];
  const load = (id: string) => (signal: AbortSignal | undefined) =>
    new Promise<string>((resolve, reject) => {
      pending.push({ id, signal, resolve, reject });
    });
  return { pending, load };
}

interface Seen {
  id: string;
  data: string | undefined;
  loading: boolean;
  error: string | null;
}

function Screen({ id, load, seen }: { id: string; load: (id: string) => (signal: AbortSignal | undefined) => Promise<string>; seen?: Seen[] }) {
  const { data, error, loading, reload } = useApi((signal) => load(id)(signal), [id, load]);
  // What a real screen does: act on what was committed.
  useEffect(() => {
    if (seen) seen.push({ id, data, loading, error: error ? error.kind : null });
  });
  return (
    <div>
      <p data-testid="state">{`${loading ? 'loading' : 'idle'}|${data ?? '-'}|${error ? error.kind : '-'}`}</p>
      <button type="button" onClick={reload}>
        Try again
      </button>
    </div>
  );
}

const state = () => screen.getByTestId('state').textContent;

async function settle(run: () => void): Promise<void> {
  await act(async () => {
    run();
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useApi', () => {
  it('loads, then shows the answer', async () => {
    const { pending, load } = manualLoader();
    render(<Screen id="a" load={load} />);
    expect(state()).toBe('loading|-|-');
    await settle(() => pending[0]?.resolve('lesson-a'));
    expect(state()).toBe('idle|lesson-a|-');
    expect(pending).toHaveLength(1);
  });

  it('never commits the old answer under new inputs (A-01)', async () => {
    const { pending, load } = manualLoader();
    const seen: Seen[] = [];
    const view = render(<Screen id="a" load={load} seen={seen} />);
    await settle(() => pending[0]?.resolve('lesson-a'));
    view.rerender(<Screen id="b" load={load} seen={seen} />);
    // The very first commit with id "b" is already loading, with no data.
    expect(state()).toBe('loading|-|-');
    await settle(() => pending[1]?.resolve('lesson-b'));
    expect(state()).toBe('idle|lesson-b|-');
    for (const commit of seen) {
      if (commit.id === 'b') expect(commit.data === undefined || commit.data === 'lesson-b').toBe(true);
      if (commit.id === 'b' && commit.data === undefined) expect(commit.loading).toBe(true);
    }
  });

  it('does not show an old error under new inputs', async () => {
    const { pending, load } = manualLoader();
    const view = render(<Screen id="a" load={load} />);
    await settle(() => pending[0]?.reject(new ApiError('http', 'Not here', 404)));
    expect(state()).toBe('idle|-|http');
    view.rerender(<Screen id="b" load={load} />);
    expect(state()).toBe('loading|-|-');
  });

  it('cancels the old request and ignores its late answer', async () => {
    const { pending, load } = manualLoader();
    const view = render(<Screen id="a" load={load} />);
    view.rerender(<Screen id="b" load={load} />);
    expect(pending[0]?.signal?.aborted).toBe(true);
    expect(pending[1]?.signal?.aborted).toBe(false);
    // The answers arrive out of order: the newer one first, the stale one after it.
    await settle(() => pending[1]?.resolve('lesson-b'));
    await settle(() => pending[0]?.resolve('lesson-a'));
    expect(state()).toBe('idle|lesson-b|-');
  });

  it('"Try again" keeps the answer on screen while it runs, then replaces it', async () => {
    const { pending, load } = manualLoader();
    render(<Screen id="a" load={load} />);
    await settle(() => pending[0]?.resolve('first'));
    await settle(() => screen.getByRole('button', { name: 'Try again' }).click());
    expect(state()).toBe('loading|first|-');
    await settle(() => pending[1]?.resolve('second'));
    expect(state()).toBe('idle|second|-');
  });

  it('keeps the answer and sets the error when a reload fails, and clears the error when the next one works', async () => {
    const { pending, load } = manualLoader();
    render(<Screen id="a" load={load} />);
    await settle(() => pending[0]?.resolve('first'));
    await settle(() => screen.getByRole('button', { name: 'Try again' }).click());
    await settle(() => pending[1]?.reject(new ApiError('timeout', 'Too slow')));
    expect(state()).toBe('idle|first|timeout');
    await settle(() => screen.getByRole('button', { name: 'Try again' }).click());
    expect(state()).toBe('loading|first|-');
    await settle(() => pending[2]?.resolve('third'));
    expect(state()).toBe('idle|third|-');
  });

  it('turns an unknown failure into a network ApiError', async () => {
    const { pending, load } = manualLoader();
    render(<Screen id="a" load={load} />);
    await settle(() => pending[0]?.reject(new TypeError('boom')));
    expect(state()).toBe('idle|-|network');
  });

  it('cancels on unmount and ignores the answer', async () => {
    const { pending, load } = manualLoader();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<Screen id="a" load={load} />);
    view.unmount();
    expect(pending[0]?.signal?.aborted).toBe(true);
    await settle(() => pending[0]?.resolve('late'));
    expect(quiet).not.toHaveBeenCalled();
  });

  it('does not ask again when the screen renders again with equal inputs', async () => {
    const { pending, load } = manualLoader();
    const view = render(<Screen id="a" load={load} />);
    await settle(() => pending[0]?.resolve('lesson-a'));
    view.rerender(<Screen id="a" load={load} />);
    view.rerender(<Screen id="a" load={load} />);
    expect(pending).toHaveLength(1);
    expect(state()).toBe('idle|lesson-a|-');
  });

  it('still ignores a stale answer on a browser without AbortController (Chrome < 66)', async () => {
    vi.stubGlobal('AbortController', undefined);
    const { pending, load } = manualLoader();
    const view = render(<Screen id="a" load={load} />);
    expect(pending[0]?.signal).toBeUndefined();
    view.rerender(<Screen id="b" load={load} />);
    await settle(() => pending[0]?.resolve('lesson-a'));
    expect(state()).toBe('loading|-|-');
    await settle(() => pending[1]?.resolve('lesson-b'));
    expect(state()).toBe('idle|lesson-b|-');
  });
});
