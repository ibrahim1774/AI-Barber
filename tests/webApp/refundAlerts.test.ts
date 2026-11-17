import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ body: '', alert: vi.fn(async (..._a: any[]) => {}), send: vi.fn(async () => 'id'), stripe: vi.fn(), sb: vi.fn(async () => []) }));
vi.mock('../../lib/webApp/emails.js', () => ({ sendMail: st.send, welcomeEmail: vi.fn(), alertOwner: st.alert }));
vi.mock('../../lib/webApp/duplicates.js', () => ({ handleDuplicates: vi.fn(), liveDupDeps: () => ({}) }));
vi.mock('../../lib/webApp/stripeCore.js', async (orig) => ({ ...(await orig<any>()), verifyStripeSignature: () => true }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCheckoutOn: () => true, webAppEntitlementsOn: () => true,
  readRawBody: async () => st.body, stripeCall: st.stripe, sbRest: st.sb,
}));

import webhook from '../../api/web-app/webhook.js';
import { sweepIosOverlap, type IosOverlapDeps, type OverlapRow } from '../../lib/webApp/lapse.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const post = async () => { const r = res(); await webhook({ method: 'POST', headers: { 'stripe-signature': 't' } }, r); return r; };
const ev = (type: string, object: any) => JSON.stringify({ type, livemode: false, data: { object } });

beforeEach(() => {
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.stubEnv('STRIPE_WEBAPP_WEBHOOK_SECRET', 'whsec');
  st.alert.mockClear(); st.send.mockClear(); st.stripe.mockClear(); st.sb.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('webhook refunds and disputes', () => {
  it('switch on: a refund gives one alert and 200, no email, no Stripe call, no DB write', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.body = ev('charge.refunded', { id: 'ch_1', customer: 'cus_1', amount_refunded: 1999, currency: 'usd' });
    const r = await post();
    expect(r.code).toBe(200);
    expect(st.alert).toHaveBeenCalledTimes(1);
    expect((st.alert.mock.calls[0] as any)[1].join('\n')).toMatch(/cus_1[\s\S]*19\.99 USD/);
    expect(st.send).not.toHaveBeenCalled(); expect(st.stripe).not.toHaveBeenCalled(); expect(st.sb).not.toHaveBeenCalled();
  });
  it('switch on: a dispute gives one alert and 200', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.body = ev('charge.dispute.created', { id: 'dp_1', charge: 'ch_1', amount: 2000, currency: 'usd', reason: 'fraudulent' });
    const r = await post();
    expect(r.code).toBe(200);
    expect(st.alert).toHaveBeenCalledTimes(1);
    expect(st.send).not.toHaveBeenCalled();
  });
  it('switch on: an alert failure still answers 200', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.alert.mockRejectedValueOnce(new Error('mail down'));
    st.body = ev('charge.refunded', { id: 'ch_1', amount_refunded: 100, currency: 'usd' });
    expect((await post()).code).toBe(200);
  });
  it('switch OFF: both stay { ignored: true }, no alert', async () => {
    for (const t of ['charge.refunded', 'charge.dispute.created']) {
      st.body = ev(t, { id: 'x', amount: 1 });
      const r = await post();
      expect(r.code).toBe(200); expect(r.body).toEqual({ ignored: true });
    }
    expect(st.alert).not.toHaveBeenCalled();
  });
});

describe('sweepIosOverlap Apple holder alerts', () => {
  const row: OverlapRow = { stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: 'u1', tier: 'website', site_slug: 's' };
  function fakes(o: { holder?: boolean; live?: number } = {}) {
    const claimed = new Set<string>();
    const d = {
      candidates: vi.fn(async () => [row].filter((r) => !claimed.has(r.stripe_subscription_id))),
      stampChecked: vi.fn(async () => {}),
      appStoreState: vi.fn(async () => 'active' as const),
      claim: vi.fn(async (id: string) => { if (claimed.has(id)) return false; claimed.add(id); return true; }),
      release: vi.fn(async () => {}),
      mailCustomer: vi.fn(async () => true),
      mailOwner: vi.fn(async () => {}),
      holdsAppleAddress: vi.fn(async () => o.holder ?? false),
      liveApplePurchases: vi.fn(async () => o.live ?? 0),
      alert: vi.fn(async () => {}),
    };
    return d as typeof d & IosOverlapDeps;
  }
  it('switch on: Apple holder plus card plan gives one alert, no customer email, once only', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    const d = fakes({ holder: true, live: 1 });
    await sweepIosOverlap(d); await sweepIosOverlap(d);
    expect(d.alert).toHaveBeenCalledTimes(1);
    expect(d.mailCustomer).not.toHaveBeenCalled(); expect(d.mailOwner).not.toHaveBeenCalled();
  });
  it('switch on: two live Apple purchases gives its own alert', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    const d = fakes({ holder: false, live: 2 });
    await sweepIosOverlap(d);
    expect(d.alert).toHaveBeenCalledTimes(1);
    expect(d.mailCustomer).not.toHaveBeenCalled();
  });
  it('switch on, not an Apple account: today\'s path (customer emailed)', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    const d = fakes();
    await sweepIosOverlap(d);
    expect(d.alert).not.toHaveBeenCalled(); expect(d.mailCustomer).toHaveBeenCalledTimes(1);
  });
  it('switch OFF: Apple holder is handled exactly as today (customer emailed, no new lookups or alerts)', async () => {
    const d = fakes({ holder: true, live: 2 });
    await sweepIosOverlap(d);
    expect(d.holdsAppleAddress).not.toHaveBeenCalled(); expect(d.alert).not.toHaveBeenCalled();
    expect(d.mailCustomer).toHaveBeenCalledTimes(1);
  });
});
