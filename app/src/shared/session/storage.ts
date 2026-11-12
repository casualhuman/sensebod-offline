/*
 * localStorage with a safe fallback. Storage can be missing or throw
 * (private mode, full disk, WebView with storage disabled); the app must
 * keep working as a guest session when it does.
 */
const memory = new Map<string, string>();

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    // fall through to memory
  }
  const kept = memory.get(key);
  if (kept === undefined) return fallback;
  try {
    return JSON.parse(kept) as T;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    // kept in memory for this page load only
  }
}

export function removeStored(key: string): void {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // nothing to do
  }
}
