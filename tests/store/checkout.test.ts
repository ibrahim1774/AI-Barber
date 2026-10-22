import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { closeCheckoutSession } from '../../lib/store/checkout.js';

const shop = { id: 's1', stripe_account_id: 'acct_1', platform_fee_bps: 200 };

/** A fetch that answers each call in turn: [ok, json]. */
function fetchSeq(...answers: ([boolean, any] | Error)[]) {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const f = vi.fn(async (url: string, init: any) => {
    calls.push({ url, method: init.method, headers: init.headers });
    const a = answers.shift();
    if (!a || a instanceof Error) throw a ?? new Error('no answer');
    return { ok: a[0], status: a[0] ? 200 : 400, json: async () => a[1] };
  });
  return { f, calls };
}

beforeAll(() => { process.env.STRIPE_CONNECT_SECRET_KEY = 'sk_test_x'; });
afterAll(() => { delete process.env.STRIPE_CONNECT_SECRET_KEY; });

describe('closeCheckoutSession', () => {
  it('expire succeeds: expired (POST .../expire on the connected account)', async () => {
    const { f, calls } = fetchSeq([true, { id: 'cs_1', status: 'expired' }]);
    expect(await closeCheckoutSession(shop, 'cs_1', { fetch: f })).toBe('expired');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/checkout/sessions/cs_1/expire', method: 'POST' });
    expect(calls[0].headers['Stripe-Account']).toBe('acct_1');
  });

  it('expire refused because the session is complete: reads it and reports complete', async () => {
    const { f, calls } = fetchSeq([false, { error: { message: 'Only Checkout Sessions with a status of open can be expired.' } }], [true, { status: 'complete' }]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await closeCheckoutSession(shop, 'cs_1', { fetch: f })).toBe('complete');
    expect(calls[1]).toMatchObject({ url: 'https://api.stripe.com/v1/checkout/sessions/cs_1', method: 'GET' });
  });

  it('expire refused because it already expired: expired', async () => {
    const { f } = fetchSeq([false, { error: {} }], [true, { status: 'expired' }]);
    expect(await closeCheckoutSession(shop, 'cs_1', { fetch: f })).toBe('expired');
  });

  it('network errors on both calls, or a still-open session: unknown (never throws)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await closeCheckoutSession(shop, 'cs_1', { fetch: fetchSeq(new Error('timeout'), new Error('timeout')).f })).toBe('unknown');
    expect(await closeCheckoutSession(shop, 'cs_1', { fetch: fetchSeq(new Error('timeout'), [true, { status: 'open' }]).f })).toBe('unknown');
    expect(await closeCheckoutSession({ ...shop, stripe_account_id: null }, 'cs_1')).toBe('unknown');
  });
});
