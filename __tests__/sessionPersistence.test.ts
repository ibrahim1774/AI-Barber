/**
 * "Signed in until the app is deleted or Sign out is tapped": the real supabase-js client over the real
 * Keychain adapter and install guard (authSession.ts), with a fake network and in-memory storage.
 */
import { createClient } from '@supabase/supabase-js';
import {
  INSTALL_FLAG_KEY, authStorageKey, createAuthStorage, nextSession, onInstallReset, readSession, wireAutoRefresh,
} from '@/lib/authSession';

const URL_ = 'https://abc123.supabase.co';
const KEY = authStorageKey(URL_);
const mem = () => {
  const m = new Map<string, string>();
  return {
    m,
    kv: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), removeItem: async (k: string) => void m.delete(k) },
  };
};
const keychain = () => {
  const m = new Map<string, string>();
  return {
    m,
    secure: {
      getItemAsync: async (k: string) => m.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => void m.set(k, v),
      deleteItemAsync: async (k: string) => void m.delete(k),
    },
  };
};

const user = { id: 'u1', email: 'a@b.co', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const sessionJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    access_token: 'at-old', refresh_token: 'rt-1', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user, ...over,
  });
const expired = () => sessionJson({ expires_at: Math.floor(Date.now() / 1000) - 600 });

type Net = { mode: 'ok' | 'offline' | 'invalid-token'; calls: number };
const makeFetch = (net: Net) =>
  (async (url: string) => {
    net.calls++;
    if (net.mode === 'offline') throw new TypeError('Network request failed');
    if (/grant_type=refresh_token/.test(String(url))) {
      if (net.mode === 'invalid-token') {
        return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found', code: 'refresh_token_not_found' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ access_token: 'at-new', refresh_token: 'rt-2', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

/** supabase-js retries a network failure with backoff for a while: drive its timers instead of waiting. */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.finally(() => (done = true));
  for (let i = 0; i < 200 && !done; i++) await jest.advanceTimersByTimeAsync(5000);
  return p;
}

function launch(kvm: ReturnType<typeof mem>, kc: ReturnType<typeof keychain>, net: Net) {
  const storage = createAuthStorage({ kv: kvm.kv, secure: kc.secure, storageKey: KEY });
  const client = createClient(URL_, 'anon', {
    global: { fetch: makeFetch(net) },
    auth: { storage, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
  });
  const events: string[] = [];
  client.auth.onAuthStateChange((e) => void events.push(e));
  return { client, storage, events };
}

describe('session persistence', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('persists across a cold start (flag set, same Keychain)', async () => {
    const kvm = mem(), kc = keychain(), net: Net = { mode: 'ok', calls: 0 };
    kvm.m.set(INSTALL_FLAG_KEY, '1');
    kc.m.set(KEY, sessionJson());
    const a = launch(kvm, kc, net);
    expect((await a.client.auth.getSession()).data.session?.user.id).toBe('u1');
    const b = launch(kvm, kc, net); // a second cold start
    expect((await b.client.auth.getSession()).data.session?.user.id).toBe('u1');
    expect(kc.m.has(KEY)).toBe(true);
  });

  describe('reinstall (Keychain survives app deletion, the app container does not)', () => {
    it('no install flag and an empty app container: the leftover session and caches are cleared first, then the flag is set', async () => {
      const kvm = mem(), kc = keychain(), net: Net = { mode: 'ok', calls: 0 };
      kc.m.set(KEY, sessionJson());
      kc.m.set(`${KEY}-code-verifier`, 'v');
      const reset = jest.fn();
      onInstallReset(reset);
      const a = launch(kvm, kc, net);
      expect((await a.client.auth.getSession()).data.session).toBeNull(); // never saw the old session
      expect(kc.m.size).toBe(0);
      expect(kvm.m.get(INSTALL_FLAG_KEY)).toBe('1');
      expect(reset).toHaveBeenCalledTimes(1);
      expect(net.calls).toBe(0); // no refresh was attempted with the dead install's token
    });

    it('the guard runs before ANY read: a getItem racing it still sees nothing', async () => {
      const kvm = mem(), kc = keychain();
      kc.m.set(KEY, sessionJson());
      const s = createAuthStorage({ kv: kvm.kv, secure: kc.secure, storageKey: KEY });
      expect(await s.getItem(KEY)).toBeNull();
    });

    it('after the guard ran, signing in and relaunching keeps the session (the flag is not re-armed)', async () => {
      const kvm = mem(), kc = keychain(), net: Net = { mode: 'ok', calls: 0 };
      const first = launch(kvm, kc, net);
      await first.storage.ready();
      await first.storage.setItem(KEY, sessionJson()); // what a sign-in writes
      const second = launch(kvm, kc, net);
      expect((await second.client.auth.getSession()).data.session?.user.id).toBe('u1');
    });

    it('an update from a build without the flag (site data present) keeps the session and just records the flag', async () => {
      const kvm = mem(), kc = keychain(), net: Net = { mode: 'ok', calls: 0 };
      kvm.m.set('site.v1', '{"draftId":"d1"}');
      kc.m.set(KEY, sessionJson());
      const a = launch(kvm, kc, net);
      expect((await a.client.auth.getSession()).data.session?.user.id).toBe('u1');
      expect(kvm.m.get(INSTALL_FLAG_KEY)).toBe('1');
      expect(kvm.m.get('site.v1')).toBeDefined();
    });

    it('unreadable app storage is doubt, not a reinstall: the session is left alone', async () => {
      const kc = keychain();
      kc.m.set(KEY, sessionJson());
      const broken = { getItem: async () => { throw new Error('db locked'); }, setItem: async () => {}, removeItem: async () => {} };
      const s = createAuthStorage({ kv: broken, secure: kc.secure, storageKey: KEY });
      expect(await s.getItem(KEY)).not.toBeNull();
    });
  });

  it('offline cold start with an expired access token stays signed in (stored session kept, UI reads it)', async () => {
    const kvm = mem(), kc = keychain(), net: Net = { mode: 'offline', calls: 0 };
    kvm.m.set(INSTALL_FLAG_KEY, '1');
    kc.m.set(KEY, expired());
    const a = launch(kvm, kc, net);
    const session = await settle(readSession(a.client.auth as any, a.storage, KEY));
    expect(session?.user?.id).toBe('u1');
    expect(kc.m.get(KEY)).toBeDefined();
    expect(a.events).not.toContain('SIGNED_OUT');
    // Back online: the same stored refresh token works and the session is renewed, still the same user.
    net.mode = 'ok';
    await jest.advanceTimersByTimeAsync(61_000); // supabase-js's failure cooldown for the same token
    const r = await settle(a.client.auth.refreshSession());
    expect(r.data.session?.access_token).toBe('at-new');
  });

  it('a refresh that fails because of the NETWORK keeps the session and does not sign out', async () => {
    const kvm = mem(), kc = keychain(), net: Net = { mode: 'ok', calls: 0 };
    kvm.m.set(INSTALL_FLAG_KEY, '1');
    kc.m.set(KEY, sessionJson());
    const a = launch(kvm, kc, net);
    await a.client.auth.getSession();
    net.mode = 'offline';
    const r = await settle(a.client.auth.refreshSession());
    expect(r.error?.name).toBe('AuthRetryableFetchError');
    expect(kc.m.get(KEY)).toBeDefined();
    expect(a.events).not.toContain('SIGNED_OUT');
  });

  it('a definitive invalid refresh token signs out cleanly: SIGNED_OUT, Keychain emptied', async () => {
    const kvm = mem(), kc = keychain(), net: Net = { mode: 'invalid-token', calls: 0 };
    kvm.m.set(INSTALL_FLAG_KEY, '1');
    kc.m.set(KEY, expired()); // the refresh token is the only credential left
    const a = launch(kvm, kc, net);
    await a.client.auth.getSession();
    expect(a.events).toContain('SIGNED_OUT');
    expect(kc.m.has(KEY)).toBe(false);
    expect((await a.client.auth.getSession()).data.session).toBeNull();
    expect(await readSession(a.client.auth as any, a.storage, KEY)).toBeNull();
  });

  it('a still-valid access token survives a rejected refresh token until it actually expires (proactive refresh)', async () => {
    const kvm = mem(), kc = keychain(), net: Net = { mode: 'invalid-token', calls: 0 };
    kvm.m.set(INSTALL_FLAG_KEY, '1');
    kc.m.set(KEY, sessionJson());
    const a = launch(kvm, kc, net);
    await a.client.auth.getSession();
    await a.client.auth.refreshSession();
    expect(a.events).not.toContain('SIGNED_OUT');
    expect(kc.m.has(KEY)).toBe(true);
  });

  it('explicit sign-out removes the stored session even offline (local scope)', async () => {
    const kvm = mem(), kc = keychain(), net: Net = { mode: 'ok', calls: 0 };
    kvm.m.set(INSTALL_FLAG_KEY, '1');
    kc.m.set(KEY, sessionJson());
    const a = launch(kvm, kc, net);
    await a.client.auth.getSession();
    net.mode = 'offline';
    const first = await settle(a.client.auth.signOut()); // global: the revoke call cannot reach the server
    if (first.error) await a.client.auth.signOut({ scope: 'local' }); // what auth.ts signOut does
    expect(kc.m.has(KEY)).toBe(false);
    expect(a.events).toContain('SIGNED_OUT');
  });
});

describe('nextSession (what the UI shows)', () => {
  const s: any = { user: { id: 'u1' } };
  it('keeps the session on a null that is not SIGNED_OUT (offline INITIAL_SESSION, failed refresh)', () => {
    expect(nextSession(s, 'INITIAL_SESSION', null)).toBe(s);
    expect(nextSession(s, 'TOKEN_REFRESHED', null)).toBe(s);
  });
  it('SIGNED_OUT empties it; a session replaces it', () => {
    expect(nextSession(s, 'SIGNED_OUT', null)).toBeNull();
    const n: any = { user: { id: 'u2' } };
    expect(nextSession(s, 'SIGNED_IN', n)).toBe(n);
  });
});

describe('wireAutoRefresh', () => {
  it('runs the refresh ticker only in the foreground and restarts it on return', () => {
    let cb: (s: string) => void = () => {};
    const remove = jest.fn();
    const auth = { startAutoRefresh: jest.fn(async () => {}), stopAutoRefresh: jest.fn(async () => {}) };
    const off = wireAutoRefresh(auth, { currentState: 'active', addEventListener: (_t, f) => ((cb = f), { remove }) });
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    cb('background');
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    cb('active');
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(2);
    off();
    expect(remove).toHaveBeenCalled();
  });
});
