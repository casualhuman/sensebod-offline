/*
 * A-02: <Routes> keeps the same component instance when only a path param
 * changes (/lesson/a -> /lesson/b), so every useState/useRef of the screen
 * survives into the next lesson.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { navigate, Routes, useParams, type RouteDef } from '@shared/router';

function Player() {
  const { lessonId } = useParams<'lessonId'>();
  const [answer, setAnswer] = useState<string | null>(null);
  return (
    <div>
      <p>
        lesson {lessonId} · chosen answer: {answer ?? 'none'}
      </p>
      <button type="button" onClick={() => setAnswer('B')}>
        Answer B
      </button>
    </div>
  );
}

const routes: RouteDef[] = [{ path: '/lesson/:lessonId', component: Player }];

describe('A-02 screen state survives a param-only navigation', () => {
  it('carries the answer chosen in lesson a into lesson b', () => {
    window.history.replaceState(null, '', '/lesson/a');
    render(<Routes routes={routes} notFound={<p>Not found</p>} />);
    fireEvent.click(screen.getByRole('button', { name: 'Answer B' }));
    expect(screen.getByText('lesson a · chosen answer: B')).toBeInTheDocument();

    act(() => navigate('/lesson/b'));
    // A fresh lesson should start with no answer. It does not.
    expect(screen.getByText('lesson b · chosen answer: B')).toBeInTheDocument();
  });
});
