import { Component, Suspense, useMemo, type ComponentType, type ErrorInfo, type MouseEvent, type ReactNode } from 'react';
// From the client module, not the '@shared/api' barrel: the barrel would pull
// every API function into the start bundle.
import { ApiError } from '@shared/api/client';
import { ButtonLink, EmptyState, ErrorState, LoadingState } from '@shared/components';
import { IconHome } from '@shared/icons';
import { lazyScreen, loadPageIfReachable, paths, Routes, useLocation } from '@shared/router';
import { PageShell } from '@shared/shell';
import { featureFor, type FeatureEntry } from './features';

/** Shown for a URL no feature knows. */
export function NotFound() {
  return (
    <PageShell title="Page not found" backTo={paths.home()}>
      <EmptyState
        title="This page is not in this bag"
        action={
          <ButtonLink to={paths.home()} fullWidth icon={<IconHome size={28} />}>
            Go to Home
          </ButtonLink>
        }
      >
        The page you asked for could not be found.
      </EmptyState>
    </PageShell>
  );
}

function ScreenLoading() {
  return <LoadingState label="Opening…" />;
}

interface BoundaryProps {
  /** Changing this value clears the error (the learner went somewhere else). */
  resetKey: string;
  children: ReactNode;
}

interface BoundaryState {
  error: unknown;
  key: string;
  /** The bag is being asked whether a fresh page can be loaded. */
  checking: boolean;
  /** The last such check got no answer: say so, and stay on this screen. */
  unreachable: boolean;
}

const UNREACHABLE = new ApiError('network', 'Could not reach the bag.');

/**
 * Catches a screen that crashed or whose code could not be downloaded (bag
 * Wi-Fi dropped, or the app was updated while this tab was open) and offers
 * a way out instead of a blank page.
 *
 * Every way out of the error screen ("Try again", "Go to Home", Back, Home,
 * the logo) loads a fresh page, because that is the only thing that clears a
 * failed download in the production build (see shared/router/recover.ts).
 * The bag is asked first: while it does not answer, the learner stays on
 * this screen and is told so, instead of landing on the browser's own
 * "no internet" page.
 */
class ScreenBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, key: this.props.resetKey, checking: false, unreachable: false };

  /** Counts the checks, so the answer to an old one is ignored. */
  private check = 0;

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('Screen failed') };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey, checking: false, unreachable: false };
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // Nothing is sent anywhere: there is no internet and no tracking.
  }

  override componentDidUpdate(_previous: BoundaryProps, previous: BoundaryState) {
    if (previous.key !== this.state.key) this.check += 1;
  }

  override componentWillUnmount() {
    this.check += 1;
  }

  /** Load `url` as a fresh page (null: this page again) if the bag answers. */
  private leave(url: string | null): void {
    if (this.state.checking) return;
    this.check += 1;
    const mine = this.check;
    this.setState({ checking: true });
    void loadPageIfReachable(url).then((leaving) => {
      // When leaving, the button keeps spinning until the new page replaces this one.
      if (!leaving && mine === this.check) this.setState({ checking: false, unreachable: true });
    });
  }

  /** Turns a tap on any in-app link of the error screen into a checked page load. */
  private onLinkClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    let node = event.target as HTMLElement | null;
    while (node && node.tagName !== 'A') node = node.parentElement;
    const link = node as HTMLAnchorElement | null;
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.charAt(0) === '#' || (link.target && link.target !== '_self') || link.origin !== window.location.origin) return;
    event.preventDefault();
    event.stopPropagation();
    this.leave(link.pathname + link.search + link.hash);
  };

  override render() {
    if (this.state.error) {
      return (
        <div onClickCapture={this.onLinkClick}>
          <PageShell title="This page did not open" backTo={paths.home()}>
            <ErrorState
              title="This page did not open"
              error={this.state.unreachable ? UNREACHABLE : undefined}
              // A fresh page also fetches the newest app after an update.
              onRetry={() => this.leave(null)}
              retrying={this.state.checking}
              action={
                <ButtonLink to={paths.home()} variant="secondary" fullWidth icon={<IconHome size={28} />}>
                  Go to Home
                </ButtonLink>
              }
            />
          </PageShell>
        </div>
      );
    }
    return this.props.children;
  }
}

const featureScreens = new Map<FeatureEntry['id'], ComponentType>();

/**
 * One lazy screen per feature, created once. `lazyScreen` asks for the
 * feature's code again on the next visit after a failed download.
 */
function screenFor(feature: FeatureEntry): ComponentType {
  let Screen = featureScreens.get(feature.id);
  if (!Screen) {
    Screen = lazyScreen(() =>
      feature.load().then((module) => ({
        default: function FeatureRoutes() {
          return (
            <Suspense fallback={<ScreenLoading />}>
              <Routes routes={module.routes} notFound={<NotFound />} />
            </Suspense>
          );
        },
      })),
    );
    featureScreens.set(feature.id, Screen);
  }
  return Screen;
}

export function App() {
  const { pathname } = useLocation();
  const feature = featureFor(pathname);
  const Screen = useMemo(() => screenFor(feature), [feature]);
  return (
    <ScreenBoundary resetKey={pathname}>
      <Suspense fallback={<ScreenLoading />}>
        <Screen />
      </Suspense>
    </ScreenBoundary>
  );
}
