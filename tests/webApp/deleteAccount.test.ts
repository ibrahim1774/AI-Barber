import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/webApp/webAppServer.js', () => ({
  sbRest: vi.fn(async () => [
    { stripe_subscription_id: 'sub_active', status: 'active' },
    { stripe_subscription_id: 'sub_past_due', status: 'past_due' },
    { stripe_subscription_id: 'sub_old', status: 'canceled' },
  ]),
  stripeCall: vi.fn(),
}));
vi.mock('../../lib/ios/deleteAccount.js', () => ({ liveDeleteDeps: vi.fn() }));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: vi.fn() }));

import { cancelWebSubscriptions, isWebSite } from '../../lib/webApp/deleteAccount.js';

describe('web delete-account helpers', () => {
  it('tells web sites from iOS ones by the web: key', () => {
    expect(isWebSite({ original_transaction_id: 'web:sub_1' })).toBe(true);
    expect(isWebSite({ original_transaction_id: '2000000123456789' })).toBe(false);
  });
  it('cancels every still-paying subscription (active and past_due), never an ended one', async () => {
    const cancel = vi.fn(async () => {});
    expect(await cancelWebSubscriptions('u1', cancel)).toEqual(['sub_active', 'sub_past_due']);
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it('a failed cancel throws, so the deletion stops and the app can retry', async () => {
    await expect(cancelWebSubscriptions('u1', async () => { throw new Error('stripe down'); })).rejects.toThrow('stripe down');
  });
});
