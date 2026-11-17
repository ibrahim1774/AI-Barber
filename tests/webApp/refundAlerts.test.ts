import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ body: '', alert: vi.fn(async (..._a: any[]) => {}), send: vi.fn(async () => 'id'), stripe: vi.fn(), sb: vi.fn(async (..._a: any[]): Promise<any> => []) }));
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
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

const plan = (app: string | undefined, over: any = {}, chargeOver: any = {}) => async (path: string) => {
  if (path.startsWith('invoices/')) return { id: 'in_1', subscription: 'sub_9', subscription_details: app === undefined ? {} : { metadata: { app } }, ...over };
  if (path.startsWith('subscriptions/')) return { id: 'sub_9', metadata: app === undefined ? {} : { app } };
  if (path.startsWith('charges/')) return { id: 'ch_1', customer: 'cus_1', invoice: 'in_1', amount_refunded: 1999, currency: 'usd', ...chargeOver };
  throw new Error(`unexpected ${path}`);
};

describe('webhook refunds and disputes', () => {
  beforeEach(() => { st.stripe.mockImplementation(plan('aibarber-app')); });
  it('switch on: a web-plan refund gives one alert and 200, no email, no DB write; says (none) when absent', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.stripe.mockImplementation(plan('aibarber-app', { subscription: null }));
    st.body = ev('charge.refunded', { id: 'ch_1', customer: 'cus_1', invoice: 'in_1', amount_refunded: 1999, currency: 'usd' });
    const r = await post();
    expect(r.code).toBe(200);
    expect(st.alert).toHaveBeenCalledTimes(1);
    const text = (st.alert.mock.calls[0] as any)[1].join('\n');
    expect(text).toMatch(/cus_1[\s\S]*19\.99 USD/);
    expect(text).toMatch(/subscription: \(none\)/);
    expect(st.send).not.toHaveBeenCalled(); expect(st.sb).not.toHaveBeenCalled();
  });
  it('switch on: a dispute on a web-plan charge gives one alert (charge is looked up)', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.body = ev('charge.dispute.created', { id: 'dp_1', charge: 'ch_1', amount: 2000, currency: 'usd', reason: 'fraudulent' });
    const r = await post();
    expect(r.code).toBe(200);
    expect(st.alert).toHaveBeenCalledTimes(1);
    expect(st.stripe.mock.calls.some((c: any[]) => String(c[0]).startsWith('charges/ch_1'))).toBe(true);
    expect(st.send).not.toHaveBeenCalled();
  });
  it('switch on: a NON-web-app refund (other plan, or no invoice such as a booking/Connect charge) gives no alert', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.stripe.mockImplementation(plan('somethingelse'));
    st.body = ev('charge.refunded', { id: 'ch_1', invoice: 'in_1', amount_refunded: 100, currency: 'usd' });
    expect((await post()).body).toEqual({ ignored: true });
    st.stripe.mockImplementation(plan('aibarber-app', {}, { invoice: null }));
    st.body = ev('charge.refunded', { id: 'ch_2', amount_refunded: 100, currency: 'usd' });
    expect((await post()).body).toEqual({ ignored: true });
    st.stripe.mockImplementation(plan(undefined, { subscription: null }));
    st.body = ev('charge.refunded', { id: 'ch_3', invoice: 'in_1', amount_refunded: 100, currency: 'usd' });
    expect((await post()).body).toEqual({ ignored: true });
    expect(st.alert).not.toHaveBeenCalled();
  });
  it('refund: the payload has NO invoice field but the fetched charge does -> alert (the event body is not trusted)', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.body = ev('charge.refunded', { id: 'ch_1', amount_refunded: 1999, currency: 'usd' });
    const r = await post();
    expect(r.body).toEqual({ alerted: true });
    expect(st.alert).toHaveBeenCalledTimes(1);
    expect(st.stripe.mock.calls[0][0]).toMatch(/^charges\/ch_1/);
  });
  it('dispute with a failing charge GET: one "could not check" alert and a truthful answer', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.stripe.mockRejectedValue(new Error('stripe 500'));
    st.body = ev('charge.dispute.created', { id: 'dp_1', charge: 'ch_1', amount: 2000, currency: 'usd', reason: 'fraudulent' });
    const r = await post();
    expect(st.alert).toHaveBeenCalledTimes(1);
    expect((st.alert.mock.calls[0] as any)[1].join('\n')).toMatch(/could not be asked whether this is a website plan/);
    expect(r.body).toEqual({ alerted: true });
  });
  it('when the alert itself fails the answer says so (never alerted:true) but is still 200', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.alert.mockRejectedValueOnce(new Error('mail down'));
    st.body = ev('charge.refunded', { id: 'ch_1', amount_refunded: 100, currency: 'usd' });
    const r = await post();
    expect(r.code).toBe(200); expect(r.body).toEqual({ alerted: false, error: 'alert-failed' });
  });
  it('a Connect event is ignored with zero Stripe calls', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.body = JSON.stringify({ type: 'charge.refunded', livemode: false, account: 'acct_123', data: { object: { id: 'ch_1', invoice: 'in_1' } } });
    expect((await post()).body).toEqual({ ignored: true });
    expect(st.stripe).not.toHaveBeenCalled(); expect(st.alert).not.toHaveBeenCalled();
  });
  it('a Stripe GET that never answers times out after 8 s and alerts with the "could not check" line', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    vi.useFakeTimers();
    st.stripe.mockImplementation(() => new Promise(() => {}));
    st.body = ev('charge.refunded', { id: 'ch_1', amount_refunded: 100, currency: 'usd' });
    const p = post();
    await vi.advanceTimersByTimeAsync(8100);
    const r = await p;
    vi.useRealTimers();
    expect(r.body).toEqual({ alerted: true });
    expect((st.alert.mock.calls[0] as any)[1].join('\n')).toMatch(/could not be asked/);
  });
  it('switch on: Stripe lookup failure over-alerts and says it could not check', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.stripe.mockRejectedValue(new Error('stripe down'));
    st.body = ev('charge.refunded', { id: 'ch_1', invoice: 'in_1', amount_refunded: 100, currency: 'usd' });
    expect((await post()).code).toBe(200);
    expect(st.alert).toHaveBeenCalledTimes(1);
    expect((st.alert.mock.calls[0] as any)[1].join('\n')).toMatch(/could not be asked/);
  });
  it('switch on: an alert failure still answers 200', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    st.alert.mockRejectedValueOnce(new Error('mail down'));
    st.body = ev('charge.refunded', { id: 'ch_1', invoice: 'in_1', amount_refunded: 100, currency: 'usd' });
    expect((await post()).code).toBe(200);
  });
  it('switch OFF: both stay { ignored: true }, no alert, no Stripe call', async () => {
    for (const t of ['charge.refunded', 'charge.dispute.created']) {
      st.body = ev(t, { id: 'x', amount: 1, invoice: 'in_1' });
      const r = await post();
      expect(r.code).toBe(200); expect(r.body).toEqual({ ignored: true });
    }
    expect(st.alert).not.toHaveBeenCalled(); expect(st.stripe).not.toHaveBeenCalled();
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
  it('switch on: holder with two live purchases is ONE alert; if it fails the claim is released and nothing was sent', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    const d = fakes({ holder: true, live: 2 });
    d.alert.mockRejectedValueOnce(new Error('mail down'));
    const r = await sweepIosOverlap(d);
    expect(d.alert).toHaveBeenCalledTimes(1);
    expect(d.release).toHaveBeenCalledTimes(1);
    expect(r.mailFailed).toEqual(['sub_1']);
  });
  it('switch on: holder with two live purchases sends exactly one combined alert when it works', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    const d = fakes({ holder: true, live: 2 });
    await sweepIosOverlap(d); await sweepIosOverlap(d);
    expect(d.alert).toHaveBeenCalledTimes(1);
    expect((d.alert.mock.calls[0] as any)[1].join('\n')).toMatch(/two live Apple purchases/);
  });
});

describe('liveIosOverlapDeps.holdsAppleAddress counts only this mode\'s environment', () => {
  it('a Sandbox Apple row does not count in live mode (so the live customer is still emailed), Production does', async () => {
    const { liveIosOverlapDeps } = await import('../../lib/webApp/lapse.js');
    const rows = [{ environment: 'Sandbox' }];
    st.sb.mockImplementation((async (p: string) => {
      const m = /environment=eq\.(\w+)/.exec(p);
      return m ? rows.filter((r) => r.environment === m[1]) : rows;
    }) as any);
    expect(await liveIosOverlapDeps('live').holdsAppleAddress!('u1')).toBe(false);
    expect(await liveIosOverlapDeps('test').holdsAppleAddress!('u1')).toBe(true);
    rows.push({ environment: 'Production' });
    expect(await liveIosOverlapDeps('live').holdsAppleAddress!('u1')).toBe(true);
  });
});
