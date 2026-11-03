import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  signLinkToken, verifyLinkToken, LINK_TTL_MS, signOauthState, verifyOauthState, stripeConnectExisting, stripeOauthReturn, stripeConnectConfirm, OAUTH_STATE_TTL_MS, oauthRedirectUri, type OauthDeps,
} from '../../lib/bookings/stripeOauth.js';

const saved = { ...process.env };
beforeEach(() => {
  process.env.STRIPE_CONNECT_SECRET_KEY = 'sk_test_connect';
  process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_test123';
  delete process.env.STRIPE_OAUTH_REDIRECT_ORIGIN;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); });

const base = { shopId: 'shop-1', userId: 'user-1', webBase: 'https://www.primebarber.org' };

describe('oauth state', () => {
  it('round-trips', () => {
    const s = verifyOauthState(signOauthState(base, 1000), 1000)!;
    expect(s).toMatchObject(base);
    expect(s.exp).toBe(1000 + OAUTH_STATE_TTL_MS);
    expect(s.nonce).toMatch(/^[0-9a-f]{24}$/);
  });
  it('rejects tampering, expiry, other keys and junk', () => {
    const t = signOauthState(base, 1000);
    const [p, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...base, shopId: 'shop-2', exp: 9e15, nonce: 'x' })).toString('base64url');
    expect(verifyOauthState(`${forged}.${sig}`, 1000)).toBeNull();
    expect(verifyOauthState(`${p}.${sig.slice(0, -2)}AA`, 1000)).toBeNull();
    expect(verifyOauthState(t, 1000 + OAUTH_STATE_TTL_MS + 1)).toBeNull();
    process.env.STRIPE_CONNECT_SECRET_KEY = 'sk_test_other';
    expect(verifyOauthState(t, 1000)).toBeNull();
    for (const j of [undefined, '', 'abc', 'a.b.c', 42]) expect(verifyOauthState(j as any)).toBeNull();
  });
});

const mkShop = (over: any = {}) => ({ id: 'shop-1', owner_id: 'user-1', name: 'Fade Factory', slug: 'ff', stripe_account_id: null as string | null, stripe_charges_enabled: false, platform_fee_bps: 200, ...over });

function mk(over: Partial<OauthDeps> = {}, shopOver: any = {}, responses: Array<{ status?: number; body: any }> = []) {
  const calls: Array<{ url: string; init: any }> = [];
  const f = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { body: {} };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  });
  const deps: OauthDeps = {
    getUser: vi.fn(async (jwt: string) => (jwt === 'good' ? { id: 'user-1', email: 'owner@example.com' } : null)),
    shopForOwner: vi.fn(async () => mkShop(shopOver)),
    saveAccountId: vi.fn(async (_s: string, id: string) => id),
    setChargesEnabled: vi.fn(async () => {}),
    audit: vi.fn(async () => {}),
    webReturnBase: vi.fn(async () => 'https://www.primebarber.org'),
    shopIdByAccount: vi.fn(async () => null),
    replaceAccountId: vi.fn(async () => true),
    hasCardHistory: vi.fn(async () => false),
    stripe: { fetch: f as any },
    ...over,
  };
  return { deps, calls };
}

describe('connect-existing', () => {
  it('builds the authorize URL', async () => {
    const { deps } = mk();
    const r = await stripeConnectExisting('Bearer good', deps);
    expect(r.status).toBe(200);
    const u = new URL((r.body as any).url);
    expect(u.origin + u.pathname).toBe('https://connect.stripe.com/oauth/authorize');
    const p = u.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe('ca_test123');
    expect(p.get('scope')).toBe('read_write');
    expect(p.get('redirect_uri')).toBe('https://www.aibarber.org/api/shop/stripe/oauth-return');
    expect(p.get('redirect_uri')).toBe(oauthRedirectUri());
    expect(p.get('stripe_landing')).toBe('login');
    expect(p.get('stripe_user[email]')).toBe('owner@example.com');
    expect(p.get('stripe_user[business_name]')).toBe('Fade Factory');
    expect(verifyOauthState(p.get('state'))).toMatchObject(base);
  });
  it('503 without client id, 401/404 auth, 403 for non-web owners', async () => {
    delete process.env.STRIPE_CONNECT_CLIENT_ID;
    expect(await stripeConnectExisting('Bearer good', mk().deps)).toEqual({ status: 503, body: { error: 'connect-existing-unavailable' } });
    process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_x';
    expect((await stripeConnectExisting(undefined, mk().deps)).status).toBe(401);
    expect((await stripeConnectExisting('Bearer bad', mk().deps)).status).toBe(401);
    expect((await stripeConnectExisting('Bearer good', mk({ shopForOwner: vi.fn(async () => null) }).deps)).status).toBe(404);
    expect((await stripeConnectExisting('Bearer good', mk({ webReturnBase: vi.fn(async () => null) }).deps)).status).toBe(403);
  });
});

describe('link token', () => {
  const l = { shopId: 'shop-1', userId: 'user-1', account: 'acct_new' };
  it('round-trips, expires, and is not interchangeable with state', () => {
    expect(verifyLinkToken(signLinkToken(l, 1000), 1000)).toMatchObject({ ...l, exp: 1000 + LINK_TTL_MS });
    expect(verifyLinkToken(signLinkToken(l, 1000), 1000 + LINK_TTL_MS + 1)).toBeNull();
    expect(verifyLinkToken(signOauthState(base))).toBeNull();
    expect(verifyOauthState(signLinkToken(l))).toBeNull();
    const [p, sig] = signLinkToken(l).split('.');
    const forged = Buffer.from(JSON.stringify({ ...l, userId: 'evil', exp: 9e15 })).toString('base64url');
    expect(verifyLinkToken(`${forged}.${sig}`)).toBeNull();
    expect(p).toBeTruthy();
  });
});

const tok = { body: { stripe_user_id: 'acct_new', livemode: false } };
const st = (charges: boolean) => ({ body: { charges_enabled: charges, details_submitted: charges } });
const deauthCalls = (calls: any[]) => calls.filter((c) => c.url === 'https://connect.stripe.com/oauth/deauthorize');

describe('oauth-return (unauthenticated: never writes the shop)', () => {
  const state = () => signOauthState(base);
  it('bad state: 400, no Stripe call', async () => {
    const { deps, calls } = mk();
    expect(await stripeOauthReturn({ code: 'c', state: 'nope' }, deps)).toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });
  it('denied: refresh without exchanging', async () => {
    const { deps, calls } = mk();
    expect(await stripeOauthReturn({ error: 'access_denied', state: state() }, deps)).toEqual({ redirect: 'https://www.primebarber.org/app/?stripe=refresh' });
    expect(calls).toHaveLength(0);
  });
  it('success: exchanges, redirects with a link token, writes nothing', async () => {
    const { deps, calls } = mk({}, {}, [tok]);
    const r: any = await stripeOauthReturn({ code: 'ac_secret', state: state() }, deps);
    const u = new URL(r.redirect);
    expect(u.origin + u.pathname).toBe('https://www.primebarber.org/app/');
    expect(verifyLinkToken(u.searchParams.get('stripe_link'))).toMatchObject({ shopId: 'shop-1', userId: 'user-1', account: 'acct_new' });
    expect(calls).toHaveLength(1);
    expect(new URLSearchParams(calls[0].init.body).get('code')).toBe('ac_secret');
    expect(deps.saveAccountId).not.toHaveBeenCalled();
    expect(deps.replaceAccountId).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
  });
  it('livemode mismatch: deauthorizes and sends refresh', async () => {
    const { deps, calls } = mk({}, {}, [{ body: { stripe_user_id: 'acct_new', livemode: true } }]);
    expect(await stripeOauthReturn({ code: 'c', state: state() }, deps)).toEqual({ redirect: 'https://www.primebarber.org/app/?stripe=refresh' });
    expect(deauthCalls(calls)).toHaveLength(1);
    expect(new URLSearchParams(deauthCalls(calls)[0].init.body).get('stripe_user_id')).toBe('acct_new');
  });
  it('token exchange failure: refresh, and the code is never logged', async () => {
    const { deps } = mk({}, {}, [{ status: 400, body: { error: 'invalid_grant', error_description: 'code ac_secret used' } }]);
    expect(await stripeOauthReturn({ code: 'ac_secret', state: state() }, deps)).toEqual({ redirect: 'https://www.primebarber.org/app/?stripe=refresh' });
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain('ac_secret');
  });
});

describe('confirm (owner JWT)', () => {
  const link = (over: any = {}) => signLinkToken({ shopId: 'shop-1', userId: 'user-1', account: 'acct_new', ...over });
  const go = (deps: OauthDeps, token: unknown = link(), auth = 'Bearer good') => stripeConnectExisting(auth, deps, { token });

  it('401 without a JWT; 400 for a bad or expired token', async () => {
    expect((await go(mk().deps, link(), 'Bearer bad')).status).toBe(401);
    expect(await go(mk().deps, 'junk')).toEqual({ status: 400, body: { error: 'invalid-link' } });
    expect((await stripeConnectConfirm('Bearer good', link(), mk().deps, Date.now() + LINK_TTL_MS + 5)).status).toBe(400);
  });
  it('wrong owner or shop: 403, deauthorizes the unlinked account, saves nothing', async () => {
    for (const t of [link({ userId: 'user-2' }), link({ shopId: 'shop-2' })]) {
      const { deps, calls } = mk({}, {}, []);
      expect(await go(deps, t)).toEqual({ status: 403, body: { error: 'wrong-owner' } });
      expect(deauthCalls(calls)).toHaveLength(1);
      expect(deps.saveAccountId).not.toHaveBeenCalled();
    }
  });
  it('wrong owner never deauthorizes an account stored on a shop', async () => {
    const { deps, calls } = mk({ shopIdByAccount: vi.fn(async () => 'shop-7') });
    await go(deps, link({ userId: 'user-2' }));
    expect(deauthCalls(calls)).toHaveLength(0);
  });
  it('success: saves, syncs status, audits', async () => {
    const { deps, calls } = mk({}, {}, [st(true)]);
    expect(await go(deps)).toEqual({ status: 200, body: { status: 'return', chargesEnabled: true } });
    expect(deps.saveAccountId).toHaveBeenCalledWith('shop-1', 'acct_new');
    expect(deps.setChargesEnabled).toHaveBeenCalledWith('shop-1', true);
    expect(deps.audit).toHaveBeenCalledWith('shop-1', 'stripe_oauth_connected', { account: 'acct_new' });
    expect(deauthCalls(calls)).toHaveLength(0);
  });
  it('same account to the same shop twice is a harmless no-op', async () => {
    const { deps } = mk({ shopIdByAccount: vi.fn(async () => 'shop-1') }, { stripe_account_id: 'acct_new' }, [st(true)]);
    expect(await go(deps)).toEqual({ status: 200, body: { status: 'return', chargesEnabled: true } });
    expect(deps.saveAccountId).not.toHaveBeenCalled();
    expect(deps.replaceAccountId).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
  });
  it('taken by another shop: no save, no deauthorize (it is stored)', async () => {
    const { deps, calls } = mk({ shopIdByAccount: vi.fn(async () => 'shop-2') });
    expect(await go(deps)).toEqual({ status: 200, body: { status: 'taken' } });
    expect(deps.saveAccountId).not.toHaveBeenCalled();
    expect(deauthCalls(calls)).toHaveLength(0);
  });
  it('replaces an unfinished account with no card history, auditing before the swap', async () => {
    const order: string[] = [];
    const { deps } = mk({
      audit: vi.fn(async () => { order.push('audit'); }),
      replaceAccountId: vi.fn(async () => { order.push('replace'); return true; }),
    }, { stripe_account_id: 'acct_old' }, [st(false), st(true)]);
    expect(await go(deps)).toEqual({ status: 200, body: { status: 'return', chargesEnabled: true } });
    expect(order.slice(0, 2)).toEqual(['audit', 'replace']);
    expect(deps.audit).toHaveBeenCalledWith('shop-1', 'stripe_oauth_replacing', { previous: 'acct_old', account: 'acct_new' });
  });
  it('refuses replacing a charges-enabled account, deauthorizing the new one', async () => {
    const { deps, calls } = mk({}, { stripe_account_id: 'acct_old' }, [st(true)]);
    expect(await go(deps)).toEqual({ status: 200, body: { status: 'taken' } });
    expect(deps.replaceAccountId).not.toHaveBeenCalled();
    expect(deauthCalls(calls)).toHaveLength(1);
  });
  it('refuses replacing an account with payment history even when restricted', async () => {
    const { deps, calls } = mk({ hasCardHistory: vi.fn(async () => true) }, { stripe_account_id: 'acct_old' }, [st(false)]);
    expect(await go(deps)).toEqual({ status: 200, body: { status: 'taken' } });
    expect(deps.replaceAccountId).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
    expect(deauthCalls(calls)).toHaveLength(1);
  });
  it('lost the conditional replace race: taken', async () => {
    const { deps } = mk({ replaceAccountId: vi.fn(async () => false) }, { stripe_account_id: 'acct_old' }, [st(false)]);
    expect(await go(deps)).toEqual({ status: 200, body: { status: 'taken' } });
  });
});
