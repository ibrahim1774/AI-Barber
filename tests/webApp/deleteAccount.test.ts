import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const rows: any[] = [];
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  sbRest: vi.fn(async () => rows),
  stripeCall: vi.fn(),
}));
vi.mock('../../lib/ios/deleteAccount.js', () => ({ liveDeleteDeps: vi.fn() }));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: vi.fn() }));

import { cancelWebSubscriptions, isWebSite } from '../../lib/webApp/deleteAccount.js';

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
  it('an unknown key mode throws', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', '');
    set([row('sub_a', 'active', 'live')]);
    await expect(cancelWebSubscriptions('u1', async () => {})).rejects.toThrow();
  });
});
