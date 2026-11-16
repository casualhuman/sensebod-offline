/*
 * Plays one installed game: the game's own page, /games/<id>/index.html, in
 * a sandboxed frame inside this screen.
 *
 * Why a frame and not a page of its own (full reasoning: app/docs/GAMES.md):
 *   - Back and Home stay on screen. A game on a page of its own has no way
 *     back except the phone's Back key.
 *   - A game is somebody else's code. `sandbox="allow-scripts"` gives it a
 *     throw-away origin: it cannot read the names stored on this phone, use
 *     an admin's session, move the app to another page or open windows.
 *   - Leaving the screen removes the frame, so the game's memory, timers and
 *     sound stop with it. That matters on a phone with 1 GB of memory.
 * The cost: without an origin a game cannot keep anything on the phone (a
 * best score is forgotten when the game is closed).
 *
 * The game opens at once: the learner already tapped Play on the game's card,
 * so there is no second Play button here. A frame cannot say that its page is
 * missing, so the bag is asked for the headers first.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, Message } from '@shared/components';
import { IconInfo, IconSpinner, IconTryAgain } from '@shared/icons';
import { stopListening } from '@shared/shell';
import type { Game } from './catalogue';

type Stage = 'checking' | 'open' | 'missing' | 'unreachable';

export function GamePlayer({ game }: { game: Game }) {
  const [stage, setStage] = useState<Stage>('checking');
  const [loaded, setLoaded] = useState(false);
  /** Changing the key throws the frame away and loads the game afresh ("Start again"). */
  const [run, setRun] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function start(): void {
    stopListening();
    setStage('checking');
    fetch(game.path, { method: 'HEAD', credentials: 'omit' }).then(
      (response) => {
        if (!alive.current) return;
        // Some servers do not answer HEAD: then just try to show it.
        setStage(response.ok || response.status === 405 ? 'open' : 'missing');
      },
      () => {
        if (alive.current) setStage('unreachable');
      },
    );
  }

  // Open the game as soon as the screen shows (and again if another game is shown here).
  useEffect(() => {
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.path]);

  function startAgain(): void {
    setLoaded(false);
    setRun((value) => value + 1);
  }

  if (stage === 'missing') {
    // Marked as installed, but the files are not where the bag serves them.
    return <EmptyState title="This game is not in this bag yet">Ask your facilitator.</EmptyState>;
  }

  if (stage === 'open') {
    return (
      <section className="sb-card sb-card--lg gam-player" aria-label="Game">
        <div className="gam-player__box">
          {loaded ? null : (
            <p className="gam-player__loading" role="status">
              <IconSpinner size={32} />
              Opening the game…
            </p>
          )}
          <iframe
            key={run}
            className="gam-player__frame"
            title={game.title}
            src={game.path}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
          />
        </div>
        <div className="gam-player__body">
          <Button variant="secondary" fullWidth icon={<IconTryAgain size={28} />} onClick={startAgain}>
            Start again
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="sb-card sb-card--lg gam-player" aria-label="Game">
      <div className="gam-player__body">
        {stage === 'unreachable' ? (
          <Message
            tone="error"
            title="The game did not open"
            action={
              <Button variant="danger" fullWidth icon={<IconTryAgain size={28} />} onClick={start}>
                Try again
              </Button>
            }
          >
            This phone cannot reach the bag. Check you are on the bag’s Wi-Fi, then try again.
          </Message>
        ) : (
          <p className="gam-player__loading gam-player__loading--plain" role="status">
            <IconSpinner size={32} />
            Opening the game…
          </p>
        )}
        <p className="gam-player__hint">
          <IconInfo size={26} />
          It works without the internet. Play by touch.
        </p>
      </div>
    </section>
  );
}
