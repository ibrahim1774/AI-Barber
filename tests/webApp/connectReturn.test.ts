import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccountLink, liveOwnerStripeDeps, type StripeOpts } from '../../lib/bookings/payments';

function fakeFetch(captured: { body?: string }): StripeOpts {
  return { fetch: (async (_u: any, init: any) => { captured.body = String(init.body); return new Response(JSON.stringify({ url: 'https://connect.stripe.com/x' }), { status: 200 }); }) as any } as StripeOpts;
}
process.env.STRIPE_CONNECT_SECRET_KEY = 'sk_test_unit';
describe('createAccountLink return urls', () => {
  it('iOS owners keep the stripe-return page', async () => {
    const c: { body?: string } = {};
    await createAccountLink('shop1', 'acct_1', fakeFetch(c));
    expect(decodeURIComponent(c.body!)).toContain('/stripe-return?shop=shop1&state=return');
  });
  it('web-app owners return to the web app', async () => {
    const c: { body?: string } = {};
    await createAccountLink('shop1', 'acct_1', fakeFetch(c), 'https://www.aibarber.org');
    const b = decodeURIComponent(c.body!);
    expect(b).toContain('return_url=https://www.aibarber.org/app/?stripe=return');
    expect(b).not.toContain('stripe-return');
  });
});

// Fake Supabase client: just enough of the query builder for webReturnBase (ab_shops + web_app_entitlements).
type Ent = { user_id: string; environment: string; status: string };
function fakeDb(o: { shop?: { ios_otid: string | null } | null; shopError?: boolean; ents?: Ent[]; entError?: boolean }) {
  const calls: string[] = [];
  const db: any = {
    from(table: string) {
      calls.push(table);
      const filters: Array<[string, unknown]> = [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
        maybeSingle: async () => (o.shopError ? { data: null, error: { message: 'boom' } } : { data: o.shop ?? null, error: null }),
        then: (res: any, rej: any) => Promise.resolve(o.entError
          ? { data: null, error: { message: 'boom' } }
          : { data: (o.ents ?? []).filter((r: any) => filters.every(([c, v]) => r[c] === v)), error: null }).then(res, rej),
      };
      return q;
    },
  };
  return { db, calls };
}
describe('webReturnBase (Stripe Connect return origin) uses the web-shop predicate', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const on = () => { vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_unit'); vi.stubEnv('WEB_APP_ORIGIN', 'https://www.aibarber.org'); };
  const base = (o: Parameters<typeof fakeDb>[0]) => { const f = fakeDb(o); return { r: liveOwnerStripeDeps(f.db).webReturnBase!('u1'), calls: f.calls }; };
  it('no ios_otid and no entitlement row: iOS return page', async () => {
    on();
    expect(await base({ shop: { ios_otid: null }, ents: [] }).r).toBeNull();
  });
  it('active live entitlement: web app', async () => {
    on();
    expect(await base({ shop: { ios_otid: null }, ents: [{ user_id: 'u1', environment: 'live', status: 'active' }] }).r).toBe('https://www.aibarber.org');
  });
  it('test-mode row while the key is live: iOS return page', async () => {
    on();
    expect(await base({ shop: { ios_otid: null }, ents: [{ user_id: 'u1', environment: 'test', status: 'active' }] }).r).toBeNull();
  });
  it('canceled live row: iOS return page', async () => {
    on();
    expect(await base({ shop: { ios_otid: null }, ents: [{ user_id: 'u1', environment: 'live', status: 'canceled' }] }).r).toBeNull();
  });
  it('lookup error (shop or entitlements): iOS return page, never throws', async () => {
    on(); vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await base({ shopError: true, ents: [{ user_id: 'u1', environment: 'live', status: 'active' }] }).r).toBeNull();
    expect(await base({ shop: { ios_otid: null }, entError: true }).r).toBeNull();
  });
  it('ios_otid set: iOS return page, entitlements never read', async () => {
    on();
    const { r, calls } = base({ shop: { ios_otid: 'otid-1' }, ents: [{ user_id: 'u1', environment: 'live', status: 'active' }] });
    expect(await r).toBeNull();
    expect(calls).toEqual(['ab_shops']);
  });
  it('flag off: iOS return page, nothing read', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_unit');
    const { r, calls } = base({ shop: { ios_otid: null }, ents: [{ user_id: 'u1', environment: 'live', status: 'active' }] });
    expect(await r).toBeNull();
    expect(calls).toEqual([]);
  });
});
