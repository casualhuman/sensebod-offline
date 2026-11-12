/*
 * A small history router (about 1 KB gzip) instead of react-router (+14 KB)
 * or wouter (+2 KB): the app needs path params, links and lazy screens,
 * nothing more. See docs/ARCHITECTURE.md, "Router".
 *
 * Uses the History API (Chrome 5+). The static server must answer every
 * unknown path with index.html (see app/deploy), so refresh and deep links work.
 */
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from 'react';

export interface RouteLocation {
  pathname: string;
  search: string;
  hash: string;
}

export type RouteParams = Record<string, string>;

export interface RouteDef {
  /**
   * Absolute pattern. `:name` matches one path segment; a trailing `/*`
   * matches the rest, including nothing (available as params['*']), so
   * '/admin/*' also matches '/admin'. Examples:
   * '/portal/:portalId', '/lesson/:lessonId/done', '/admin/*'.
   */
  path: string;
  /** The screen. Wrap big screens in React.lazy so they load on demand. */
  component: ComponentType;
}

export interface NavigateOptions {
  /** Replace the current history entry instead of adding one (redirects, quick exit). */
  replace?: boolean;
  /** Leave the scroll position alone (in-page state changes such as a filter in the URL). */
  keepScroll?: boolean;
}

/* ---- location store ---- */

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('popstate', notify);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', notify);
  };
}

/** A string snapshot keeps useSyncExternalStore stable without allocating objects. */
function snapshot(): string {
  return window.location.pathname + '\n' + window.location.search + '\n' + window.location.hash;
}

export function getLocation(): RouteLocation {
  return { pathname: normalisePath(window.location.pathname), search: window.location.search, hash: window.location.hash };
}

/** Drops a trailing slash so '/portal/agriculture/' and '/portal/agriculture' are one route. */
export function normalisePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname || '/';
}

/** Go to another screen without reloading the page. */
export function navigate(to: string, options: NavigateOptions = {}): void {
  if (options.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  notify();
  if (!options.keepScroll) window.scrollTo(0, 0);
}

export function useLocation(): RouteLocation {
  const value = useSyncExternalStore(subscribe, snapshot);
  const [pathname = '/', search = '', hash = ''] = value.split('\n');
  return { pathname: normalisePath(pathname), search, hash };
}

/* ---- matching ---- */

export function matchPath(pattern: string, pathname: string): RouteParams | null {
  const patternParts = normalisePath(pattern).split('/');
  const pathParts = normalisePath(pathname).split('/');
  const params: RouteParams = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const part = patternParts[i] as string;
    if (part === '*' && i === patternParts.length - 1) {
      params['*'] = pathParts.slice(i).map(safeDecode).join('/');
      return params;
    }
    const actual = pathParts[i];
    if (actual === undefined) return null;
    if (part.charAt(0) === ':') {
      if (actual === '') return null;
      params[part.slice(1)] = safeDecode(actual);
    } else if (part !== actual) {
      return null;
    }
  }
  return patternParts.length === pathParts.length ? params : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function matchRoutes(routes: readonly RouteDef[], pathname: string): { route: RouteDef; params: RouteParams } | null {
  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

/* ---- params ---- */

const ParamsContext = createContext<RouteParams>({});

/** Path params of the matched route: `const { lessonId } = useParams<'lessonId'>();` */
export function useParams<K extends string = string>(): Record<K, string> {
  return useContext(ParamsContext) as Record<K, string>;
}

/** Query string values: `useQuery().get('type')`. */
export function useQuery(): URLSearchParams {
  return new URLSearchParams(useLocation().search);
}

/* ---- components ---- */

export interface RoutesProps {
  routes: readonly RouteDef[];
  /** Rendered when nothing matches. */
  notFound: ReactNode;
}

/** Renders the first route whose pattern matches the current path. */
export function Routes({ routes, notFound }: RoutesProps) {
  const { pathname } = useLocation();
  const match = matchRoutes(routes, pathname);
  if (!match) return <>{notFound}</>;
  const Screen = match.route.component;
  return (
    <ParamsContext.Provider value={match.params}>
      <Screen />
    </ParamsContext.Provider>
  );
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** In-app path, e.g. paths.portal('agriculture'). */
  to: string;
  replace?: boolean;
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * A real <a href> (so long-press, open in new tab and screen readers behave),
 * that navigates without reloading the page on a plain tap.
 */
export function Link({ to, replace, onClick, target, children, ...rest }: LinkProps) {
  return (
    <a
      {...rest}
      href={to}
      target={target}
      onClick={(event) => {
        if (onClick) onClick(event);
        if (event.defaultPrevented || !isPlainLeftClick(event) || (target && target !== '_self')) return;
        event.preventDefault();
        navigate(to, { replace });
      }}
    >
      {children}
    </a>
  );
}
