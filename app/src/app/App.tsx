import { Component, lazy, Suspense, useMemo, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { ButtonLink, EmptyState, ErrorState, LoadingState } from '@shared/components';
import { IconHome } from '@shared/icons';
import { paths, Routes, useLocation } from '@shared/router';
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

/**
 * Catches a screen that crashed or whose code could not be downloaded (bag
 * Wi-Fi dropped, or the app was updated while this tab was open) and offers
 * a way out instead of a blank page.
 */
class ScreenBoundary extends Component<BoundaryProps, { error: unknown; key: string }> {
  override state: { error: unknown; key: string } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: { error: unknown; key: string }) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey };
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // Nothing is sent anywhere: there is no internet and no tracking.
  }

  override render() {
    if (this.state.error) {
      return (
        <PageShell title="This page did not open" backTo={paths.home()}>
          <ErrorState
            title="This page did not open"
            // A full reload also fetches the newest app after an update.
            onRetry={() => window.location.reload()}
            action={
              <ButtonLink to={paths.home()} variant="secondary" fullWidth icon={<IconHome size={28} />}>
                Go to Home
              </ButtonLink>
            }
          />
        </PageShell>
      );
    }
    return this.props.children;
  }
}

const featureScreens = new Map<FeatureEntry['id'], ComponentType>();

/** One React.lazy component per feature, created once. */
function screenFor(feature: FeatureEntry): ComponentType {
  let Screen = featureScreens.get(feature.id);
  if (!Screen) {
    Screen = lazy(() =>
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
