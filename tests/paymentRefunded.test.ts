import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { paymentRefundedCents } from '../lib/bookings/payments.js';

// e2e I5: the refund check made when a payment is recorded.
const shop = { stripe_account_id: 'acct_1' } as any;
const reply = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 300, status, json: async () => body }));

beforeEach(() => { vi.stubEnv('STRIPE_CONNECT_SECRET_KEY', 'sk_test_x'); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('paymentRefundedCents', () => {
  it('sums amount_refunded over the payment intent\'s charges, on the connected account, version-independent (no latest_charge)', async () => {
    const f = reply(200, { data: [{ amount_refunded: 1000 }, { amount_refunded: 250 }] });
    expect(await paymentRefundedCents(shop, 'pi_1', { fetch: f as any })).toBe(1250);
    const [url, init] = (f.mock.calls[0] as any[]);
    expect(url).toBe('https://api.stripe.com/v1/charges?payment_intent=pi_1&limit=10');
    expect(init.headers['Stripe-Account']).toBe('acct_1');
  });

  it('a 4xx (other than 429) reads as 0 so the payment still confirms; 5xx, 429 and network errors throw (the webhook retries)', async () => {
    expect(await paymentRefundedCents(shop, 'pi_1', { fetch: reply(400, { error: { code: 'parameter_unknown' } }) as any })).toBe(0);
    expect(await paymentRefundedCents(shop, 'pi_1', { fetch: reply(404, { error: {} }) as any })).toBe(0);
    await expect(paymentRefundedCents(shop, 'pi_1', { fetch: reply(500, { error: {} }) as any })).rejects.toThrow();
    await expect(paymentRefundedCents(shop, 'pi_1', { fetch: reply(429, { error: {} }) as any })).rejects.toThrow();
    await expect(paymentRefundedCents(shop, 'pi_1', { fetch: vi.fn(async () => { throw new Error('ECONNRESET'); }) as any })).rejects.toThrow();
    expect(await paymentRefundedCents({ stripe_account_id: null } as any, 'pi_1')).toBe(0);
  });
});

describe('stripeRefundedTotal (fix 13 follow-up)', () => {
  it('sums succeeded / pending refunds on the payment intent across pages; failed and canceled ones do not count', async () => {
    const { stripeRefundedTotal } = await import('../lib/bookings/payments.js');
    const pages = [
      { data: [{ id: 're_1', amount: 1000, status: 'succeeded' }, { id: 're_2', amount: 500, status: 'failed' }], has_more: true },
      { data: [{ id: 're_3', amount: 300, status: 'pending' }, { id: 're_4', amount: 200, status: 'canceled' }], has_more: false },
    ];
    const urls: string[] = [];
    const f = vi.fn(async (url: string) => { urls.push(url); return { ok: true, status: 200, json: async () => pages[urls.length - 1] }; });
    expect(await stripeRefundedTotal(shop, 'pi_1', { fetch: f as any })).toBe(1300);
    expect(urls).toEqual([
      'https://api.stripe.com/v1/refunds?payment_intent=pi_1&limit=100',
      'https://api.stripe.com/v1/refunds?payment_intent=pi_1&limit=100&starting_after=re_2',
    ]);
    await expect(stripeRefundedTotal(shop, 'pi_1', { fetch: reply(400, { error: {} }) as any })).rejects.toThrow();
  });
});
