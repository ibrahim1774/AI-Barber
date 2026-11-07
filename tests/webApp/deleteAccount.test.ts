import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const rows: any[] = [];
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  sbRest: vi.fn(async () => rows),
  stripeCall: vi.fn(),
}));
vi.mock('../../lib/ios/deleteAccount.js', () => ({ liveDeleteDeps: vi.fn() }));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: vi.fn() }));

import { sbRest } from '../../lib/webApp/webAppServer.js';
import { cancelThenForgetCustomers, cancelWebSubscriptions, isWebSite } from '../../lib/webApp/deleteAccount.js';

const set = (r: any[]) => { rows.length = 0; rows.push(...r); };
const row = (id: string, status: string, environment: 'live' | 'test') => ({ stripe_subscription_id: id, status, environment });

describe('web delete-account helpers', () => {
  beforeEach(() => { vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x'); });
  afterEach(() => vi.unstubAllEnvs());

  it('tells web sites from iOS ones by the web: key', () => {
    expect(isWebSite({ original_transaction_id: 'web:sub_1' })).toBe(true);
    expect(isWebSite({ original_transaction_id: '2000000123456789' })).toBe(false);
  });
  it('cancels every still-paying subscription (active and past_due), never an ended one', async () => {
    set([row('sub_active', 'active', 'live'), row('sub_past_due', 'past_due', 'live'), row('sub_old', 'canceled', 'live')]);
    const cancel = vi.fn(async () => {});
    expect(await cancelWebSubscriptions('u1', cancel)).toEqual(['sub_active', 'sub_past_due']);
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it('a failed cancel throws, so the deletion stops and the app can retry', async () => {
    set([row('sub_active', 'active', 'live')]);
    await expect(cancelWebSubscriptions('u1', async () => { throw new Error('stripe down'); })).rejects.toThrow('stripe down');
  });
  it('live key: cancels the live row and leaves a test row alone, no throw', async () => {
    set([row('sub_live', 'active', 'live'), row('sub_test', 'active', 'test')]);
    const cancel = vi.fn(async () => {});
    expect(await cancelWebSubscriptions('u1', cancel)).toEqual(['sub_live']);
    expect(cancel).toHaveBeenCalledWith('sub_live');
    expect(cancel).not.toHaveBeenCalledWith('sub_test');
  });
  it('test key: an entitled LIVE row refuses the delete BEFORE anything is cancelled', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    set([row('sub_test', 'active', 'test'), row('sub_live', 'active', 'live')]);
    const cancel = vi.fn(async () => {});
    await expect(cancelWebSubscriptions('u1', cancel)).rejects.toThrow('live-subscription-elsewhere');
    expect(cancel).not.toHaveBeenCalled();
  });
  it('test key: a canceled live row does not block', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    set([row('sub_test', 'active', 'test'), row('sub_live', 'canceled', 'live')]);
    expect(await cancelWebSubscriptions('u1', async () => {})).toEqual(['sub_test']);
  });
  it('a Stripe 404 / resource_missing counts as done; a 500 throws', async () => {
    set([row('sub_a', 'active', 'live')]);
    expect(await cancelWebSubscriptions('u1', async () => { throw Object.assign(new Error('gone'), { status: 404 }); })).toEqual(['sub_a']);
    expect(await cancelWebSubscriptions('u1', async () => { throw Object.assign(new Error('gone'), { status: 400, code: 'resource_missing' }); })).toEqual(['sub_a']);
    await expect(cancelWebSubscriptions('u1', async () => { throw Object.assign(new Error('boom'), { status: 500 }); })).rejects.toThrow('boom');
  });
  it('S4: also cancels a tagged entitled subscription that has no row yet (listed from the stored customer), same mode only', async () => {
    set([row('sub_live', 'active', 'live')]);
    rows[0].stripe_customer_id = 'cus_1';
    const list = vi.fn(async () => [
      { id: 'sub_live', status: 'active', metadata: { app: 'aibarber-app' } },
      { id: 'sub_unrecorded', status: 'active', metadata: { app: 'aibarber-app' } },
      { id: 'sub_old', status: 'canceled', metadata: { app: 'aibarber-app' } },
      { id: 'sub_other_flow', status: 'active', metadata: {} },
    ]);
    const cancel = vi.fn(async () => {});
    expect(await cancelWebSubscriptions('u1', cancel, undefined, list)).toEqual(['sub_live', 'sub_unrecorded']);
    expect(list).toHaveBeenCalledWith('cus_1');
  });
  it('S4 (domain): a one-click domain_purchase subscription on the user\'s customer is cancelled with the account; an unrelated one is not', async () => {
    set([row('sub_plan', 'active', 'live')]);
    rows[0].stripe_customer_id = 'cus_1';
    const list = vi.fn(async () => [
      { id: 'sub_plan', status: 'active', metadata: { app: 'aibarber-app' } },
      { id: 'sub_domain', status: 'active', metadata: { type: 'domain_purchase', app: 'aibarber-domain', domain: 'a.com', siteId: 's' } },
      { id: 'sub_domain_old', status: 'canceled', metadata: { type: 'domain_purchase', app: 'aibarber-domain' } },
      { id: 'sub_foreign', status: 'active', metadata: { type: 'domain_purchase', app: 'something-else' } },
    ]);
    const cancel = vi.fn(async () => {});
    expect(await cancelWebSubscriptions('u1', cancel, undefined, list)).toEqual(['sub_plan', 'sub_domain']);
  });
  it('S4: a test key still refuses before listing or cancelling anything when a live row is entitled', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    set([row('sub_live', 'active', 'live')]);
    const list = vi.fn(async () => []); const cancel = vi.fn(async () => {});
    await expect(cancelWebSubscriptions('u1', cancel, undefined, list)).rejects.toThrow('live-subscription-elsewhere');
    expect(cancel).not.toHaveBeenCalled();
  });
  it('S4: a cancel error with any code is fine when Stripe says the subscription is already canceled', async () => {
    set([row('sub_a', 'active', 'live')]);
    const boom = async () => { throw Object.assign(new Error('whatever'), { status: 400, code: 'something_unexpected' }); };
    expect(await cancelWebSubscriptions('u1', boom, async () => 'canceled', async () => [])).toEqual(['sub_a']);
    await expect(cancelWebSubscriptions('u1', boom, async () => 'active', async () => [])).rejects.toThrow('whatever');
  });
  it('N6: web_app_customers rows are deleted only AFTER the subscriptions were cancelled', async () => {
    set([row('sub_a', 'active', 'live')]);
    (sbRest as any).mockClear();
    await cancelThenForgetCustomers('u1', async () => {});
    const calls = (sbRest as any).mock.calls;
    expect(calls.at(-1)[0]).toMatch(/^web_app_customers\?user_id=eq\.u1/);
    expect(calls.at(-1)[1]).toMatchObject({ method: 'DELETE' });
  });
  it('N6: a failed cancel deletes nothing', async () => {
    set([row('sub_a', 'active', 'live')]);
    (sbRest as any).mockClear();
    await expect(cancelThenForgetCustomers('u1', async () => { throw Object.assign(new Error('boom'), { status: 500 }); })).rejects.toThrow();
    expect((sbRest as any).mock.calls.some((c: any[]) => c[1]?.method === 'DELETE')).toBe(false);
  });
  it('an unknown key mode throws', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', '');
    set([row('sub_a', 'active', 'live')]);
    await expect(cancelWebSubscriptions('u1', async () => {})).rejects.toThrow();
  });
});
