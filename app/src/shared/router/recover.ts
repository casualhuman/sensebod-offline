/*
 * Recovery after code could not be downloaded (bag Wi-Fi dropped, or the app
 * was updated while this tab was open).
 *
 * In the production build the module loader (SystemJS) keeps a failed
 * download for the life of the page: asking for the same chunk again fails at
 * once, without a new request. Only a fresh page load clears it. But a page
 * load while the bag is still out of reach replaces the app with the
 * browser's own error page, so the bag is always asked first.
 */

const REACH_TIMEOUT_MS = 10000;

/**
 * Counts the location changes of this page load (the router adds one for
 * every in-app navigation and every browser Back / Forward). `lazyScreen`
 * uses it to tell a new visit from a second render of the same visit.
 */
export const visits = { count: 0 };

/** Full page loads, in one place so tests can watch them. */
export const pageLoad = {
  reload(): void {
    window.location.reload();
  },
  go(url: string): void {
    window.location.assign(url);
  },
};

/**
 * True when the bag answers a small request for the app's own page.
 * Never rejects. The address is new every time, so no cache can answer for the bag.
 */
export function bagReachable(timeoutMs: number = REACH_TIMEOUT_MS): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(reachable);
    };
    const timer = setTimeout(() => {
      if (controller) controller.abort();
      finish(false);
    }, timeoutMs);
    try {
      fetch('/?reach=' + Date.now().toString(36), {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller ? controller.signal : undefined,
      }).then(
        (response) => finish(response.ok),
        () => finish(false),
      );
    } catch {
      finish(false);
    }
  });
}

/**
 * Loads `url` as a fresh page (or reloads this one when `url` is null), but
 * only if the bag answers. Resolves true when the page is being replaced,
 * false when the bag could not be reached and nothing was done.
 */
export function loadPageIfReachable(url: string | null): Promise<boolean> {
  return bagReachable().then((reachable) => {
    if (!reachable) return false;
    if (url === null) pageLoad.reload();
    else pageLoad.go(url);
    return true;
  });
}
