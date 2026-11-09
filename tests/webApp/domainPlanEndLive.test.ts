// The live wiring of the plan-end checks: iOS ownership and the other-plan check (DB, then Stripe).
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ cust: [] as any[], ent: [] as any[], ios: [] as any[], subs: [] as any[], calls: [] as string[] }));
vi.mock('../../lib/ios/domainsRepo.js', () => ({ supabaseDomains: () => ({}) }));
vi.mock('../../lib/bookings/repo.js', () => ({ serviceClient: () => ({}) }));
vi.mock('../../lib/ios/domainLive.js', () => ({ stripeSubscription: vi.fn() }));
vi.mock('../../lib/webApp/domainOneClickLive.js', () => ({ stripeSetRenewal: vi.fn() }));
vi.mock('../../lib/webApp/dunning.js', () => ({ contactFor: vi.fn() }));
vi.mock('../../lib/webApp/emails.js', () => ({ sendMail: vi.fn(), replyToAddress: () => undefined, esc: (x: string) => x }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  sbRest: async (path: string) => { h.calls.push(path); return path.startsWith('ios_purchases') ? h.ios : path.startsWith('web_app_customers') ? h.cust : path.startsWith('web_app_entitlements') ? h.ent : []; },
  stripeCall: async (path: string) => (path.startsWith('subscriptions?customer=') ? { data: h.subs } : { customer: 'cus_1' }),
}));

import { livePlanEndDeps } from '../../lib/webApp/domainPlanEnd.js';

describe('livePlanEndDeps checks', () => {
  it('iosOwnsSlug reads ios_purchases', async () => {
    const d = await livePlanEndDeps('live');
    h.ios = [{ original_transaction_id: 'x' }];
    expect(await d.iosOwnsSlug!('s')).toBe(true);
    h.ios = [];
    expect(await d.iosOwnsSlug!('s')).toBe(false);
  });
  it('hasOtherPlan: a DB row excluding the ending sub, else a Stripe-only replacement plan, else false', async () => {
    const d = await livePlanEndDeps('live');
    h.ent = [{ stripe_subscription_id: 'sub_2' }];
    expect(await d.hasOtherPlan!('u1', 'sub_1', 'cus_1')).toBe(true);
    expect(h.calls.at(-1)).toContain('stripe_subscription_id=neq.sub_1');
    h.ent = [];
    h.subs = [{ id: 'sub_1', status: 'active', metadata: { app: 'aibarber-app' } }, { id: 'sub_9', status: 'canceled', metadata: { app: 'aibarber-app' } }];
    expect(await d.hasOtherPlan!('u1', 'sub_1', 'cus_1')).toBe(false); // itself and an ended one do not count
    h.subs.push({ id: 'sub_3', status: 'active', metadata: { app: 'aibarber-app' } });
    expect(await d.hasOtherPlan!('u1', 'sub_1', undefined)).toBe(true); // customer looked up from the ending sub
  });

  it('customerOf: web_app_customers first, else the newest entitlement row, else null', async () => {
    const d = await livePlanEndDeps('live');
    h.cust = [{ stripe_customer_id: 'cus_a' }];
    expect(await d.customerOf('u1')).toBe('cus_a');
    h.cust = []; h.ent = [{ stripe_customer_id: 'cus_b' }];
    expect(await d.customerOf('u1')).toBe('cus_b');
    expect(h.calls.at(-1)).toContain('order=created_at.desc');
    h.ent = [];
    expect(await d.customerOf('u1')).toBeNull();
  });
});
