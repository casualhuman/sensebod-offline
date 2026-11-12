/*
 * Try it · an uploaded animation package (a .zip with index.html, unpacked
 * on the Pi). The boards show the admin side only (ADM-M-Animation); the
 * learner side reuses the player card pattern.
 *
 * The package is somebody else's code, so it runs in a sandboxed frame:
 * scripts only, in a throw-away origin of its own. It cannot read the app's
 * storage, cookies or pages, cannot navigate the app, open windows or submit
 * forms. The Pi adds its own Content-Security-Policy to /media/tryit/ so the
 * package cannot reach any network either (app/deploy/nginx.conf).
 * Nothing is downloaded until the learner taps Start.
 */
import { useEffect, useRef, useState } from 'react';
import type { Lesson } from '@shared/api';
import { Button, EmptyState, Message } from '@shared/components';
import { IconFullScreen, IconInfo, IconSpinner, IconTick, IconTryAgain, IconTryIt } from '@shared/icons';
import { navigate, paths } from '@shared/router';
import { stopListening } from '@shared/shell';
import { IconExitFullScreen } from '../parts/icons';
import { isLocalUrl } from '../media/localUrl';
import { useFullscreen } from '../media/fullscreen';
import { finishLesson } from '../progress/progress';

type Stage = 'ready' | 'checking' | 'open' | 'missing' | 'unreachable';

export default function TryItPackage({ lesson, packageUrl }: { lesson: Lesson; packageUrl: string }) {
  const [stage, setStage] = useState<Stage>('ready');
  const [loaded, setLoaded] = useState(false);
  /** Changing the key throws the frame away and loads the package afresh ("Start again"). */
  const [run, setRun] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const noVideo = useRef<HTMLVideoElement>(null);
  const fullscreen = useFullscreen(boxRef, noVideo);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (!isLocalUrl(packageUrl)) {
    // Only files served by the bag itself are ever opened.
    return <EmptyState title="This activity is not in this bag yet">Ask your facilitator.</EmptyState>;
  }

  function start(): void {
    stopListening();
    setStage('checking');
    // A frame cannot tell us that its page is missing, so ask for the headers
    // first (no body is downloaded).
    fetch(packageUrl, { method: 'HEAD', credentials: 'omit' }).then(
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

  function startAgain(): void {
    setLoaded(false);
    setRun((value) => value + 1);
  }

  function finish(): void {
    finishLesson(lesson.id);
    navigate(paths.lessonDone(lesson.id));
  }

  if (stage === 'missing') {
    return <EmptyState title="This activity is not in this bag yet">Ask your facilitator.</EmptyState>;
  }

  return (
    <section className="sb-card sb-card--lg sb-card--tappable les-player les-package" aria-label="Activity">
      {stage === 'open' ? (
        <div ref={boxRef} className="les-package__box">
          {loaded ? null : (
            <p className="les-package__loading" role="status">
              <IconSpinner size={32} />
              Opening the activity…
            </p>
          )}
          <iframe
            key={run}
            className="les-package__frame"
            title={lesson.title}
            src={packageUrl}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
          />
          {fullscreen.active ? (
            <div className="les-stage__bar">
              <Button size="sm" variant="secondary" icon={<IconExitFullScreen size={28} />} onClick={fullscreen.exit}>
                Leave full screen
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="les-package__start">
          <span className="les-package__badge" aria-hidden="true">
            <IconTryIt size={48} />
          </span>
          {stage === 'unreachable' ? (
            <Message
              tone="error"
              title="The activity did not open"
              action={
                <Button variant="danger" fullWidth icon={<IconTryAgain size={28} />} onClick={start}>
                  Try again
                </Button>
              }
            >
              This phone cannot reach the bag. Check you are on the bag’s Wi-Fi, then try again.
            </Message>
          ) : (
            <Button size="lg" fullWidth working={stage === 'checking'} workingLabel="Opening…" icon={<IconTryIt size={32} />} onClick={start}>
              Start
            </Button>
          )}
        </div>
      )}

      <div className="les-player__body">
        {stage === 'open' ? (
          <>
            <div className="les-package__actions">
              <Button variant="secondary" icon={<IconTryAgain size={28} />} onClick={startAgain}>
                Start again
              </Button>
              {fullscreen.available ? (
                <Button variant="secondary" icon={<IconFullScreen size={28} />} onClick={fullscreen.enter}>
                  Full screen
                </Button>
              ) : null}
            </div>
            <Button fullWidth className="les-package__finish" icon={<IconTick size={28} />} onClick={finish}>
              I have finished
            </Button>
          </>
        ) : (
          <p className="les-player__hint">
            <IconInfo size={26} />
            You take part: tap and try things. It works without the internet.
          </p>
        )}
      </div>
    </section>
  );
}
