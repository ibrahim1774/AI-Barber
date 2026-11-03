import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  signOauthState, verifyOauthState, stripeConnectExisting, stripeOauthReturn, OAUTH_STATE_TTL_MS, oauthRedirectUri, type OauthDeps,
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

describe('oauth-return', () => {
  const state = () => signOauthState(base);
  const tok = { body: { stripe_user_id: 'acct_new' } };
  const status = (charges: boolean) => ({ body: { charges_enabled: charges, details_submitted: charges } });
  const go = (deps: OauthDeps, q: any = { code: 'ac_secret', state: state() }) => stripeOauthReturn(q, deps);
  const to = (v: string) => ({ redirect: `https://www.primebarber.org/app/?stripe=${v}` });

  it('bad or expired state: 400 text, no Stripe call', async () => {
    const { deps, calls } = mk();
    expect(await go(deps, { code: 'c', state: 'nope' })).toMatchObject({ status: 400 });
    expect(await go(deps, { code: 'c' })).toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });
  it('denied: redirects to refresh without exchanging', async () => {
    const { deps, calls } = mk();
    expect(await go(deps, { error: 'access_denied', state: state() })).toEqual(to('refresh'));
    expect(calls).toHaveLength(0);
  });
  it('success on a shop with no account', async () => {
    const { deps, calls } = mk({}, {}, [tok, status(true)]);
    expect(await go(deps)).toEqual(to('return'));
    expect(calls[0].url).toBe('https://connect.stripe.com/oauth/token');
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk_test_connect');
    const b = new URLSearchParams(calls[0].init.body);
    expect(b.get('grant_type')).toBe('authorization_code');
    expect(b.get('code')).toBe('ac_secret');
    expect(deps.saveAccountId).toHaveBeenCalledWith('shop-1', 'acct_new');
    expect(deps.setChargesEnabled).toHaveBeenCalledWith('shop-1', true);
    expect(deps.audit).toHaveBeenCalledWith('shop-1', 'stripe_oauth_connected', { account: 'acct_new' });
  });
  it('taken by another shop: nothing saved', async () => {
    const { deps } = mk({ shopIdByAccount: vi.fn(async () => 'shop-2') }, {}, [tok]);
    expect(await go(deps)).toEqual(to('taken'));
    expect(deps.saveAccountId).not.toHaveBeenCalled();
    expect(deps.replaceAccountId).not.toHaveBeenCalled();
  });
  it('replaces an unfinished different account', async () => {
    const { deps } = mk({}, { stripe_account_id: 'acct_old' }, [tok, status(false), status(true)]);
    expect(await go(deps)).toEqual(to('return'));
    expect(deps.replaceAccountId).toHaveBeenCalledWith('shop-1', 'acct_old', 'acct_new');
    expect(deps.setChargesEnabled).toHaveBeenCalledWith('shop-1', true);
  });
  it('lost the conditional replace race: taken', async () => {
    const { deps } = mk({ replaceAccountId: vi.fn(async () => false) }, { stripe_account_id: 'acct_old' }, [tok, status(false)]);
    expect(await go(deps)).toEqual(to('taken'));
    expect(deps.setChargesEnabled).not.toHaveBeenCalled();
  });
  it('refuses to replace a charges-enabled account', async () => {
    const { deps } = mk({}, { stripe_account_id: 'acct_old' }, [tok, status(true)]);
    expect(await go(deps)).toEqual(to('taken'));
    expect(deps.replaceAccountId).not.toHaveBeenCalled();
  });
  it('same account already stored: just refreshes status', async () => {
    const { deps } = mk({ shopIdByAccount: vi.fn(async () => 'shop-1') }, { stripe_account_id: 'acct_new' }, [tok, status(true)]);
    expect(await go(deps)).toEqual(to('return'));
    expect(deps.saveAccountId).not.toHaveBeenCalled();
    expect(deps.replaceAccountId).not.toHaveBeenCalled();
  });
  it('shop no longer matches the state: 400', async () => {
    const { deps } = mk({}, { id: 'shop-9' }, [tok]);
    expect(await go(deps)).toMatchObject({ status: 400 });
    expect(deps.saveAccountId).not.toHaveBeenCalled();
  });
  it('token exchange failure: refresh, and the code is never logged', async () => {
    const { deps } = mk({}, {}, [{ status: 400, body: { error: 'invalid_grant', error_description: 'code ac_secret used' } }]);
    expect(await go(deps)).toEqual(to('refresh'));
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain('ac_secret');
  });
});
