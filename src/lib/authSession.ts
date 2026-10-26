import Storage from 'expo-sqlite/kv-store';
import * as SecureStore from 'expo-secure-store';

/**
 * Session persistence for the Supabase client.
 *
 * - The session lives in the iOS Keychain (SecureStore). Keychain items SURVIVE deleting the app, so a
 *   reinstall would otherwise open already signed in. The install guard below fixes that: the install flag
 *   lives in the app's own storage (kv-store, in the app container), which IS removed on delete.
 * - A signed-in user stays signed in across cold starts, updates, offline launches and failed refreshes.
 *   The session is dropped only by the explicit Sign out, account deletion, or the server definitively
 *   rejecting the refresh token (supabase-js removes it then).
 */

export const INSTALL_FLAG_KEY = 'install.v1';

/** supabase-js's default storage key: `sb-<first label of the project host>-auth-token`. */
export function authStorageKey(url: string): string {
  try {
    return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  } catch {
    return 'sb-placeholder-auth-token';
  }
}

/** Every Keychain key supabase-js writes for one project. */
export const sessionKeys = (storageKey: string): string[] => [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`];

export type KeyValue = {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<unknown>;
  removeItem(k: string): Promise<unknown>;
};
export type SecureLike = {
  getItemAsync(k: string): Promise<string | null>;
  setItemAsync(k: string, v: string): Promise<void>;
  deleteItemAsync(k: string): Promise<void>;
};

// Caches cleared with the leftover session (the in-memory plan, entitlements, customers); registered by auth.ts.
const resetters: (() => void)[] = [];
export function onInstallReset(fn: () => void): void {
  resetters.push(fn);
}

/** The app's own cached data (not the session): gone with a reinstall, cleared here if a stray copy is left. */
const CACHE_KEYS = ['site.v1', 'pendingPublish.v1'];

/**
 * First launch after an install: when the flag is missing and the app's storage holds nothing from an earlier
 * run (so this is a fresh container, not an update from a build before this flag existed), any session left in
 * the Keychain by a deleted copy of the app is removed and the cached plan / site / account data is cleared,
 * BEFORE anything reads it. Then the flag is set. Any doubt (storage unreadable) leaves the session alone:
 * never sign someone out on uncertainty. Resolves once; callers await the same promise.
 */
export async function runInstallGuard(deps: {
  kv: KeyValue;
  secure: SecureLike;
  storageKey: string;
}): Promise<'fresh-install' | 'existing' | 'unknown'> {
  const { kv, secure, storageKey } = deps;
  let flag: string | null;
  try {
    flag = await kv.getItem(INSTALL_FLAG_KEY);
  } catch {
    return 'unknown';
  }
  if (flag) return 'existing';
  let carriedOver = false;
  try {
    // Only the site and pending publish count: written by the user's own actions, never by launch code racing this check.
    carriedOver = (await Promise.all(CACHE_KEYS.map((k) => kv.getItem(k)))).some((v) => v != null);
  } catch {
    return 'unknown';
  }
  if (carriedOver) {
    // An update from a build without the flag: keep the session and the data, just record the install.
    await kv.setItem(INSTALL_FLAG_KEY, '1').catch(() => {});
    return 'existing';
  }
  for (const k of sessionKeys(storageKey)) await secure.deleteItemAsync(k).catch(() => {});
  for (const k of CACHE_KEYS) await kv.removeItem(k).catch(() => {});
  for (const r of resetters) {
    try {
      r();
    } catch {
      // a cache that cannot be reset must not stop the others
    }
  }
  // Set last, even if a delete above failed: a later launch must never sign out someone who signed in since.
  await kv.setItem(INSTALL_FLAG_KEY, '1').catch(() => {});
  return 'fresh-install';
}

/**
 * The supabase-js `storage` over the Keychain. Every operation waits for the install guard first, so the
 * session is never read (or written) before a reinstall's leftovers are gone.
 */
export function createAuthStorage(deps: { kv: KeyValue; secure: SecureLike; storageKey: string }) {
  let guard: Promise<unknown> | null = null;
  const ready = () => (guard ??= runInstallGuard(deps).catch(() => 'unknown'));
  return {
    ready,
    getItem: async (key: string) => {
      await ready();
      return deps.secure.getItemAsync(key);
    },
    setItem: async (key: string, value: string) => {
      await ready();
      return deps.secure.setItemAsync(key, value);
    },
    removeItem: async (key: string) => {
      await ready();
      return deps.secure.deleteItemAsync(key);
    },
  };
}

export function createDefaultAuthStorage(url: string) {
  return createAuthStorage({
    kv: Storage as unknown as KeyValue,
    secure: { getItemAsync: SecureStore.getItemAsync, setItemAsync: SecureStore.setItemAsync, deleteItemAsync: SecureStore.deleteItemAsync },
    storageKey: authStorageKey(url),
  });
}

/**
 * React Native has no tab visibility, so supabase-js cannot know when to refresh: run its refresh ticker only
 * while the app is in the foreground, and start it again on return (which also refreshes a token that
 * expired in the background).
 */
export function wireAutoRefresh(
  auth: { startAutoRefresh(): Promise<void> | void; stopAutoRefresh(): Promise<void> | void },
  appState: { currentState: string; addEventListener(t: 'change', cb: (s: string) => void): { remove(): void } },
): () => void {
  const apply = (s: string) => {
    void Promise.resolve(s === 'active' ? auth.startAutoRefresh() : auth.stopAutoRefresh()).catch(() => {});
  };
  apply(appState.currentState);
  const sub = appState.addEventListener('change', apply);
  return () => sub.remove();
}

type SessionLike = { user?: { id?: string } | null; refresh_token?: string };

/**
 * The session the UI should show after an auth event. Only an explicit SIGNED_OUT (sign out, account
 * deletion, or the server rejecting the refresh token) empties it. A null session on any other event
 * (supabase-js reports none while an expired token cannot be refreshed offline) keeps what we had.
 */
export function nextSession<S extends SessionLike>(prev: S | null, event: string, session: S | null): S | null {
  if (session) return session;
  return event === 'SIGNED_OUT' ? null : prev;
}

/** True for supabase-js's network-failure errors (never a verdict on the session). */
export function isNetworkAuthError(e: unknown): boolean {
  const err = (e ?? {}) as { name?: string; status?: number; message?: string };
  return (
    err.name === 'AuthRetryableFetchError' ||
    err.status === 0 ||
    /network request failed|failed to fetch|fetch failed|network error|timed? ?out/i.test(err.message ?? '')
  );
}

/**
 * getSession() for the UI. Offline with an expired access token supabase-js answers `session: null` plus a
 * network error although the refresh token is still stored; then the stored session is used (the
 * refresh happens when the network is back).
 */
export async function readSession<S extends SessionLike>(
  auth: { getSession(): Promise<{ data: { session: S | null }; error?: unknown }> },
  storage: { getItem(k: string): Promise<string | null> },
  storageKey: string,
): Promise<S | null> {
  const res = await auth.getSession();
  if (res.data.session) return res.data.session;
  if (!res.error || !isNetworkAuthError(res.error)) return null;
  try {
    const raw = await storage.getItem(storageKey);
    const s = raw ? (JSON.parse(raw) as S) : null;
    return s && s.user?.id && typeof s.refresh_token === 'string' ? s : null;
  } catch {
    return null;
  }
}
