// POST /api/shop/stripe/onboard { client }: the starting client decides where Stripe returns to.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripeOnboard, type OwnerStripeDeps } from '../../lib/bookings/payments.js';

const saved = { ...process.env };
beforeEach(() => { process.env.STRIPE_CONNECT_SECRET_KEY = 'sk_test_connect'; process.env.WEB_APP_ORIGIN = 'https://www.primebarber.org'; });
afterEach(() => { process.env = { ...saved }; });

function run(client: unknown, webReturnBase?: (u: string) => Promise<string | null>) {
  const calls: URLSearchParams[] = [];
  const f = vi.fn(async (url: string, init: any) => { calls.push(new URLSearchParams(init.body ?? '')); return { ok: true, status: 200, json: async () => ({ url: 'https://connect.stripe.com/x' }) }; });
  const deps: OwnerStripeDeps = {
    getUser: async () => ({ id: 'u1', email: 'o@x.co' }), shopForOwner: async () => ({ id: 'shop-1', owner_id: 'u1', name: 'S', slug: 's', phone: null, stripe_account_id: 'acct_1' } as any),
    saveAccountId: async (_s, id) => id, setChargesEnabled: async () => {}, audit: async () => {}, stripe: { fetch: f as any }, webReturnBase,
  } as any;
  return { p: stripeOnboard('Bearer t', deps, client), calls, f };
}

describe('onboard client field', () => {
  it("'ios' returns to the iOS page even when today's rule says web", async () => {
    const t = run('ios', async () => 'https://www.primebarber.org');
    expect((await t.p).status).toBe(200);
    expect(t.calls[0].get('return_url')).toMatch(/^https:\/\/www\.aibarber\.org\/stripe-return\?shop=shop-1&state=return$/);
  });
  it("'web' returns to the web app even when today's rule says iOS", async () => {
    const t = run('web', async () => null);
    expect((await t.p).status).toBe(200);
    expect(t.calls[0].get('return_url')).toBe('https://www.primebarber.org/app/?stripe=return');
    expect(t.calls[0].get('refresh_url')).toBe('https://www.primebarber.org/app/?stripe=refresh');
  });
  it('absent: today\'s rule, unchanged (and null/undefined are the same as absent)', async () => {
    for (const c of [undefined, null]) {
      const t = run(c, async () => 'https://www.primebarber.org');
      await t.p;
      expect(t.calls[0].get('return_url')).toBe('https://www.primebarber.org/app/?stripe=return');
    }
    const i = run(undefined, async () => null); await i.p;
    expect(i.calls[0].get('return_url')).toMatch(/stripe-return\?shop=shop-1/);
  });
  it('only the two fixed values: anything else (including a URL) is 400 and Stripe is never called', async () => {
    for (const bad of ['https://evil.example', 'WEB', '', 5, {}, true]) {
      const t = run(bad, async () => null);
      expect(await t.p, JSON.stringify(bad)).toEqual({ status: 400, body: { error: 'bad-request' } });
      expect(t.f).not.toHaveBeenCalled();
    }
  });
});
