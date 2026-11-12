/*
 * A-01: useApi commits one render in which the NEW inputs are paired with the
 * OLD answer and loading === false. Effects of the screen run on that render.
 */
import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { useApi } from '@shared/api/useApi';

interface Seen {
  id: string;
  data: string | undefined;
  loading: boolean;
}

const committed: Seen[] = [];
const saved: string[] = [];

function LessonScreen({ id }: { id: string }) {
  const { data, loading } = useApi(() => Promise.resolve(`lesson-${id}`), [id]);
  // What a real screen does: act on the loaded lesson (save progress, set the title, start media).
  useEffect(() => {
    committed.push({ id, data, loading });
    if (data && !loading) saved.push(`progress saved for url=${id} using data=${data}`);
  });
  return <p>{loading ? 'loading' : data}</p>;
}

describe('A-01 useApi stale render when inputs change', () => {
  it('commits old data with the new id and loading=false, and screen effects act on it', async () => {
    const view = render(<LessonScreen id="a" />);
    await screen.findByText('lesson-a');
    view.rerender(<LessonScreen id="b" />);
    await screen.findByText('lesson-b');

    // The faulty commit: id is already "b", the answer is still lesson "a", and the hook says it is not loading.
    expect(committed).toContainEqual({ id: 'b', data: 'lesson-a', loading: false });
    // A screen effect keyed on "loaded" therefore ran once with mismatched id and data.
    expect(saved).toContain('progress saved for url=b using data=lesson-a');
  });
});
