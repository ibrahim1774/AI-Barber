import { describe, it, expect, vi } from 'vitest';
import { WEB_MARKUP_USD, createDomainCheckout, purchaseDomain, type WebPurchaseRow, type WebPurchasesRepo } from '../lib/webDomains.js';
import { fakeRegistrar } from './ios/fakeRegistrar.js';

const CONTACT = { firstName: 'A', lastName: 'B', email: 'a@b.co', phone: '+15555550100', address1: '1', city: 'c', state: 's', zip: 'z', country: 'US' };

describe('create-domain-checkout: price and project computed server-side', () => {
  const setup = (over: any = {}) => {
    const reg = fakeRegistrar({ now: () => 0, ...over });
    const createStripeSession = vi.fn(async (_p: URLSearchParams) => ({ ok: true, status: 200, data: { url: 'https://checkout.stripe.com/x' } }));
    return { reg, createStripeSession, deps: { vercel: reg.api, createStripeSession } };
  };

  it("ignores the client's vercelPrice and projectName", async () => {
    const { deps, createStripeSession } = setup();
    const r = await createDomainCheckout({ domain: 'FreshCuts.com', siteId: "Fresh Cuts!", vercelPrice: 0.01, projectName: 'someone-elses-project' }, 'https://aibarber.org', deps);
    expect(r).toEqual({ status: 200, body: { url: 'https://checkout.stripe.com/x' } });
    const p = createStripeSession.mock.calls[0][0];
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe(String(Math.round((11.25 + WEB_MARKUP_USD) * 100)));
    expect(p.get('metadata[projectName]')).toBe('fresh-cuts');
    expect(p.get('metadata[domain]')).toBe('freshcuts.com');
    expect(p.get('metadata[vercelPrice]')).toBe('11.25');
    expect(p.get('metadata[type]')).toBe('domain_purchase');
  });

  it('unavailable → 409; premium / string price → 409; nothing sent to Stripe', async () => {
    const a = setup({ taken: ['freshcuts.com'] });
    expect((await createDomainCheckout({ domain: 'freshcuts.com', siteId: 's' }, 'o', a.deps)).status).toBe(409);
    const b = setup({ prices: { 'gold.com': { purchasePrice: 5000, renewalPrice: 5000 }, 'str.com': { purchasePrice: '11', renewalPrice: 11 } } });
    expect((await createDomainCheckout({ domain: 'gold.com', siteId: 's' }, 'o', b.deps)).status).toBe(409);
    expect((await createDomainCheckout({ domain: 'str.com', siteId: 's' }, 'o', b.deps)).status).toBe(409);
    expect(a.createStripeSession).not.toHaveBeenCalled();
    expect(b.createStripeSession).not.toHaveBeenCalled();
  });

  it.each([[{ siteId: 's' }], [{ domain: 'x.com' }], [{ domain: 'not a domain', siteId: 's' }], [{ domain: 'x.com', siteId: '!!!' }]])('bad input %j → 400', async (body) => {
    expect((await createDomainCheckout(body, 'o', setup().deps)).status).toBe(400);
  });
});

function fakeWebRepo() {
  const rows = new Map<string, WebPurchaseRow>();
  const repo: WebPurchasesRepo = {
    insert: vi.fn(async (r) => {
      if (rows.has(r.stripe_session_id)) return 'conflict' as const;
      rows.set(r.stripe_session_id, { ...r, state: 'buying', order_id: null, error: null });
      return 'ok' as const;
    }),
    get: vi.fn(async (id) => rows.get(id) ?? null),
    update: vi.fn(async (id, from, patch) => {
      const cur = rows.get(id);
      if (!cur || cur.state !== from) return null;
      const next = { ...cur, ...patch };
      rows.set(id, next);
      return next;
    }),
  };
  return { rows, repo };
}

describe('purchase-domain: single use per paid session', () => {
  const SID = 'cs_live_abcdefghij';
  const session = (md: any = {}, paid = 'paid') => ({ ok: true, status: 200, data: { payment_status: paid, metadata: { type: 'domain_purchase', domain: 'freshcuts.com', projectName: 'fresh-cuts', vercelPrice: '11.25', ...md } } });
  const setup = (md: any = {}, over: any = {}) => {
    const reg = fakeRegistrar({ now: () => 0 });
    const { rows, repo } = fakeWebRepo();
    const deps = { getStripeSession: vi.fn(async () => session(md)), repo, vercel: reg.api, contact: CONTACT, testMode: false, ...over };
    return { reg, rows, deps };
  };

  it('buys once with expectedPrice + contact from the server, attaches, records the order', async () => {
    const { reg, rows, deps } = setup();
    const r = await purchaseDomain({ sessionId: SID }, deps);
    expect(r).toEqual({ status: 200, body: { success: true, domain: 'freshcuts.com', orderId: 'ord_1' } });
    expect((reg.api.buy as any).mock.calls[0]).toEqual(['freshcuts.com', { expectedPrice: 11.25, autoRenew: true, contact: CONTACT }]);
    expect(reg.api.addProjectDomain).toHaveBeenCalledWith('fresh-cuts', 'freshcuts.com');
    expect(rows.get(SID)).toMatchObject({ state: 'bought', order_id: 'ord_1' });
  });

  it('a replayed session id never buys again', async () => {
    const { reg, deps } = setup();
    await purchaseDomain({ sessionId: SID }, deps);
    const again = await purchaseDomain({ sessionId: SID }, deps);
    expect(again).toMatchObject({ status: 200, body: { success: true, alreadyProcessed: true, orderId: 'ord_1' } });
    expect(reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('two concurrent calls: only one buys', async () => {
    const { reg, deps } = setup();
    const [a, b] = await Promise.all([purchaseDomain({ sessionId: SID }, deps), purchaseDomain({ sessionId: SID }, deps)]);
    expect(reg.api.buy).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('an unknown buy outcome (timeout) stays "buying": a replay cannot buy again', async () => {
    const { reg, deps, rows } = setup();
    reg.queueBuy('network');
    expect((await purchaseDomain({ sessionId: SID }, deps)).status).toBe(400);
    expect(rows.get(SID)!.state).toBe('buying');
    expect((await purchaseDomain({ sessionId: SID }, deps)).status).toBe(409);
    expect(reg.api.buy).toHaveBeenCalledTimes(1);
  });

  it('a definite refusal (nothing bought) may be retried once more', async () => {
    const { reg, deps } = setup();
    reg.queueBuy({ code: 'too_many_requests_x', status: 400 });
    expect((await purchaseDomain({ sessionId: SID }, deps)).status).toBe(400);
    expect((await purchaseDomain({ sessionId: SID }, deps)).status).toBe(200);
    expect(reg.api.buy).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['unpaid', { getStripeSession: vi.fn(async () => session({}, 'unpaid')) }],
    ['not a domain session', { getStripeSession: vi.fn(async () => session({ type: 'site' })) }],
    ['no price in metadata', { getStripeSession: vi.fn(async () => session({ vercelPrice: '' })) }],
    ['premium price in metadata', { getStripeSession: vi.fn(async () => session({ vercelPrice: '900' })) }],
  ])('%s → 400, nothing bought', async (_n, over) => {
    const { reg, deps } = setup({}, over);
    expect((await purchaseDomain({ sessionId: SID }, deps)).status).toBe(400);
    expect(reg.api.buy).not.toHaveBeenCalled();
  });

  it('test mode never buys, still single-use', async () => {
    const { reg, deps } = setup({}, { testMode: true });
    expect((await purchaseDomain({ sessionId: SID }, deps)).status).toBe(200);
    expect((await purchaseDomain({ sessionId: SID }, deps)).body).toMatchObject({ alreadyProcessed: true });
    expect(reg.api.buy).not.toHaveBeenCalled();
  });

  it('bad session id → 400 before Stripe', async () => {
    const { deps } = setup();
    expect((await purchaseDomain({ sessionId: '../x' }, deps)).status).toBe(400);
    expect(deps.getStripeSession).not.toHaveBeenCalled();
  });
});
