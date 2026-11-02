import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/webApp/webAppServer.js', () => ({ sbRest: vi.fn(async () => []), stripeCall: vi.fn() }));
vi.mock('../../lib/ios/deleteAccount.js', () => ({ liveDeleteDeps: vi.fn() }));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: vi.fn() }));

import { stripeCall } from '../../lib/webApp/webAppServer.js';
import { cancelWebSubscriptions, sessionsOfUser } from '../../lib/webApp/deleteAccount.js';
import { userExists } from '../../lib/webApp/userExists.js';

const mk = (over: any) => ({ metadata: { app: 'aibarber-app', user_id: 'u1' }, ...over });
const listing = () => ({ data: [
  mk({ id: 'cs_paid', status: 'complete', customer: 'cus_new' }),
  mk({ id: 'cs_open', status: 'open' }),
  mk({ id: 'cs_other_user', status: 'complete', customer: 'cus_x', metadata: { app: 'aibarber-app', user_id: 'u2' } }),
  mk({ id: 'cs_untagged', status: 'open', metadata: {} }),
  mk({ id: 'cs_exp', status: 'expired' }),
] });

beforeEach(() => { vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); (stripeCall as any).mockReset(); (stripeCall as any).mockImplementation(async (p: string) => p.startsWith('checkout/sessions?') ? listing() : { data: [] }); });
afterEach(() => vi.unstubAllEnvs());

describe('delete account for a first-time payer (no stored customer, no entitlement row)', () => {
  it('sessionsOfUser: completed sessions give the customer, open ones are listed, other users/untagged ignored', async () => {
    expect(await sessionsOfUser('u1', async () => 'a@example.com')).toEqual({ customers: ['cus_new'], open: ['cs_open'] });
  });
  it('no email: nothing to look up and Stripe is not called', async () => {
    expect(await sessionsOfUser('u1', async () => null)).toEqual({ customers: [], open: [] });
    expect(stripeCall).not.toHaveBeenCalled();
  });
  it('cancels the subscription found through the paid session and expires the open session first', async () => {
    const cancel = vi.fn(async () => {}); const expire = vi.fn(async () => ({}));
    const list = async (c: string) => c === 'cus_new' ? [{ id: 'sub_paid', status: 'active', metadata: { app: 'aibarber-app' } }, { id: 'sub_foreign', status: 'active', metadata: {} }] : [];
    const discover = (id: string) => sessionsOfUser(id, async () => 'a@example.com');
    expect(await cancelWebSubscriptions('u1', cancel, undefined, list, discover, expire)).toEqual(['sub_paid']);
    expect(cancel).toHaveBeenCalledWith('sub_paid');
    expect(expire).toHaveBeenCalledWith('cs_open');
    expect(expire.mock.invocationCallOrder[0]).toBeLessThan(cancel.mock.invocationCallOrder[0]);
  });
  it('a failed expire does not stop the cancel', async () => {
    const cancel = vi.fn(async () => {});
    const list = async () => [{ id: 'sub_paid', status: 'active', metadata: { app: 'aibarber-app' } }];
    const discover = (id: string) => sessionsOfUser(id, async () => 'a@example.com');
    expect(await cancelWebSubscriptions('u1', cancel, undefined, list, discover, async () => { throw new Error('boom'); })).toEqual(['sub_paid']);
  });
  it('a Stripe error in the session lookup throws, so the delete retries instead of orphaning billing', async () => {
    (stripeCall as any).mockRejectedValue(new Error('stripe down'));
    await expect(sessionsOfUser('u1', async () => 'a@example.com')).rejects.toThrow('stripe down');
  });
});

describe('userExists', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('false only on a 404 from Supabase; true when unconfigured, on errors or on success', async () => {
    expect(await userExists('u1')).toBe(true); // no SUPABASE_URL
    vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    expect(await userExists('u1')).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    expect(await userExists('u1')).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    expect(await userExists('u1')).toBe(true);
  });
});
