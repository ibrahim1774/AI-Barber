import { siteModeFromKind } from '../../lib/account/siteMode.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { accountKind, readKind, stripeModeOf, kindEnvOf, type ApplePurchaseFact, type EntitlementFact, type WebSiteFact } from '../../lib/account/kind.js';
import { accountPlan, planFromFacts, type PlanDeps, type PlanFacts } from '../../lib/account/plan.js';
import { getPlan, type PlanDeps as ShopPlanDeps } from '../../lib/ios/planFlow.js';

const P = 'com.ibrahim1774.aibarber.';
const NOW = Date.parse('2026-11-17T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const UID = '11111111-1111-4111-8111-111111111111';

const apple = (o: Partial<ApplePurchaseFact> = {}): ApplePurchaseFact => ({
  original_transaction_id: '2000000000001', product_id: `${P}bookings.monthly`, environment: 'Production', user_id: UID,
  site_slug: null, published_at: null, expires_at: iso(NOW + 20 * DAY), revoked_at: null, taken_down_at: null, removed_at: null, last_notification: null, ...o,
});
const appleSite = (o: Partial<ApplePurchaseFact> = {}) => apple({ site_slug: 'fresh-cuts', published_at: iso(NOW - 30 * DAY), ...o });
const card = (status: string, o: Partial<EntitlementFact> = {}): EntitlementFact => ({
  stripe_subscription_id: 'sub_1', status, tier: 'bookings', billing_interval: 'month', current_period_end: iso(NOW + 10 * DAY), created_at: iso(NOW - 40 * DAY), ...o,
});
const webSite = (o: Partial<WebSiteFact> = {}): WebSiteFact => ({ slug: 'web-cuts', published_at: iso(NOW - 10 * DAY), removed_at: null, taken_down_at: null, ...o });

interface Mix { name: string; apple?: ApplePurchaseFact[]; cards?: EntitlementFact[]; sites?: WebSiteFact[]; free?: boolean; legacy?: boolean }
interface Want { kind: string; source: string | null; active: boolean; extra?: Record<string, unknown> }

const TABLE: Array<[Mix, Want]> = [
  [{ name: 'apple live, with address', apple: [appleSite()] }, { kind: 'apple', source: 'apple', active: true, extra: { status: 'active', tier: 'bookings', holderPurchaseEnded: false, appleGrace: false } }],
  [{ name: 'apple live, no address yet', apple: [apple()] }, { kind: 'apple', source: 'apple', active: true, extra: { site: null } }],
  [{ name: 'apple lapsed, with address', apple: [appleSite({ taken_down_at: iso(NOW - DAY), expires_at: iso(NOW - 3 * DAY) })] }, { kind: 'apple', source: 'apple', active: false, extra: { status: 'expired', holderPurchaseEnded: true } }],
  [{ name: 'apple lapsed, no address (unwatched and expired)', apple: [apple({ expires_at: iso(NOW - 3 * DAY) })] }, { kind: 'neither', source: 'apple', active: false, extra: { status: 'expired', holderPurchaseEnded: false } }],
  [{ name: 'apple grace (watched, expiry passed, not taken down)', apple: [appleSite({ expires_at: iso(NOW - DAY) })] }, { kind: 'apple', source: 'apple', active: true, extra: { status: 'grace', appleGrace: true, paymentProblem: true } }],
  [{ name: 'apple retry (DID_FAIL_TO_RENEW, taken down)', apple: [appleSite({ taken_down_at: iso(NOW - DAY), expires_at: iso(NOW - 3 * DAY), last_notification: 'DID_FAIL_TO_RENEW' })] }, { kind: 'apple', source: 'apple', active: false, extra: { appleRetry: true, paymentProblem: true } }],
  [{ name: 'apple revoked', apple: [appleSite({ revoked_at: iso(NOW - DAY) })] }, { kind: 'apple', source: 'apple', active: false, extra: { status: 'revoked', holderPurchaseEnded: true } }],
  [{ name: 'apple sandbox counts as paid (source, active) but never decides the kind in production', apple: [appleSite({ environment: 'Sandbox' })] }, { kind: 'neither', source: 'apple', active: true, extra: { test: true, site: null, holderPurchaseEnded: false } }],
  [{ name: 'stripe live, published', cards: [card('active')], sites: [webSite()] }, { kind: 'web', source: 'stripe', active: true, extra: { status: 'active', paymentProblem: false, tier: 'bookings' } }],
  [{ name: 'stripe live, never published', cards: [card('trialing')] }, { kind: 'web', source: 'stripe', active: true, extra: { status: 'trialing' } }],
  [{ name: 'stripe past due', cards: [card('past_due')], sites: [webSite()] }, { kind: 'web', source: 'stripe', active: true, extra: { paymentProblem: true, status: 'past_due' } }],
  [{ name: 'stripe ended, published once', cards: [card('canceled')], sites: [webSite({ removed_at: iso(NOW - DAY) })] }, { kind: 'web', source: 'stripe', active: false, extra: { status: 'canceled' } }],
  [{ name: 'stripe ended, never published', cards: [card('canceled')] }, { kind: 'neither', source: 'stripe', active: false }],
  [{ name: 'free, never published', free: true }, { kind: 'neither', source: 'free', active: true, extra: { tier: 'bookings', status: 'active' } }],
  [{ name: 'free, published', free: true, sites: [webSite()] }, { kind: 'web', source: 'free', active: true }],
  [{ name: 'free row in memory (free:<uid>) is never a card plan', free: true, cards: [card('active', { stripe_subscription_id: 'free:abc' })] }, { kind: 'neither', source: 'free', active: true }],
  [{ name: 'legacy customer, paid web', cards: [card('active')], sites: [webSite()], legacy: true }, { kind: 'web', source: 'stripe', active: true, extra: { legacy: true } }],
  [{ name: 'none', }, { kind: 'neither', source: null, active: false, extra: { tier: null, status: null, site: null } }],
  [{ name: 'apple holder plus live card plan reads apple', apple: [appleSite()], cards: [card('active')] }, { kind: 'apple', source: 'apple', active: true, extra: { appleAlsoPaysCard: true } }],
  [{ name: 'apple holder (lapsed) plus live card plan reads apple, plan is the card', apple: [appleSite({ taken_down_at: iso(NOW - DAY) })], cards: [card('active')] }, { kind: 'apple', source: 'stripe', active: true, extra: { holderPurchaseEnded: true, appleAlsoPaysCard: true } }],
  [{ name: 'web address plus apple address is mixed', apple: [appleSite()], sites: [webSite()], cards: [card('active')] }, { kind: 'mixed', source: 'apple', active: true, extra: { site: { slug: 'fresh-cuts', url: 'https://fresh-cuts.vercel.app', holder: 'apple' }, webSite: { slug: 'web-cuts', url: 'https://web-cuts.vercel.app', holder: 'web' } } }],
  [{ name: 'web address only (a stray shop ios_otid is not a fact here)', sites: [webSite()], cards: [card('active')] }, { kind: 'web', source: 'stripe', active: true, extra: { site: { slug: 'web-cuts', url: 'https://web-cuts.vercel.app', holder: 'web' }, webSite: null } }],
  [{ name: 'live apple purchase without address plus published web address is web', apple: [apple()], sites: [webSite()] }, { kind: 'web', source: 'apple', active: true }],
  [{ name: 'live apple purchase without address plus card plan, nothing published, reads web (the card plan decides)', apple: [apple()], cards: [card('active')] }, { kind: 'web', source: 'apple', active: true, extra: { appleAlsoPaysCard: false } }],
  [{ name: 'unpublished web slug alone is not an address', sites: [webSite({ published_at: null })] }, { kind: 'neither', source: null, active: false }],
  [{ name: 'removed web address still counts', sites: [webSite({ removed_at: iso(NOW - DAY) })] }, { kind: 'web', source: null, active: false }],
  [{ name: 'removed apple address still counts', apple: [appleSite({ removed_at: iso(NOW - DAY), taken_down_at: iso(NOW - DAY) })] }, { kind: 'apple', source: 'apple', active: false, extra: { holderPurchaseEnded: true } }],
  [{ name: 'free floor lifts a hosting-only card to bookings', free: true, cards: [card('active', { tier: 'website' })] }, { kind: 'web', source: 'stripe', active: true, extra: { tier: 'bookings' } }],
];

const facts = (m: Mix): PlanFacts => ({ env: 'Production', webSites: m.sites ?? [], applePurchases: m.apple ?? [], entitlements: m.cards ?? [], now: NOW, mode: 'live', free: !!m.free, legacy: !!m.legacy });
const deps = (m: Mix): PlanDeps => ({
  webSites: vi.fn(async () => m.sites ?? []), applePurchases: vi.fn(async () => m.apple ?? []), entitlements: vi.fn(async () => m.cards ?? []),
  isFree: vi.fn(async () => !!m.free), legacyOwner: vi.fn(async () => !!m.legacy), now: () => NOW,
});

describe('account kind and plan, every mix', () => {
  for (const [mix, want] of TABLE) {
    it(mix.name, async () => {
      const p = planFromFacts(facts(mix));
      expect(p.kind).toBe(want.kind);
      expect(p.source).toBe(want.source);
      expect(p.active).toBe(want.active);
      expect(p).toMatchObject(want.extra ?? {});
      // The live path gives the same answer, and the kind function agrees.
      const d = deps(mix);
      expect(await accountPlan(UID, 'Production', d)).toEqual({ ...p, siteMode: siteModeFromKind(p.kind, UID) }); // only siteMode differs: it follows the kind and ACCOUNT_DRAFTS_IOS
      expect(await accountKind(UID, 'Production', d)).toBe(want.kind);
      expect(readKind(facts(mix)).kind).toBe(want.kind);
    });
  }
  it('Free is never read as a Stripe plan, and the pure kind never looks at the price group', () => {
    const p = planFromFacts(facts({ name: 'x', free: true }));
    expect(p.source).toBe('free');
    expect(p.source).not.toBe('stripe');
  });
  it('the environment is mapped Production -> live, Sandbox -> test for the web tables only', async () => {
    const d = deps({ name: 'x' });
    await accountKind(UID, 'Sandbox', d);
    expect(d.webSites).toHaveBeenCalledWith(UID, 'test');
    expect(d.entitlements).toHaveBeenCalledWith(UID, 'test');
    expect(d.applePurchases).toHaveBeenCalledWith(UID);
    await accountKind(UID, 'Production', d);
    expect(d.webSites).toHaveBeenLastCalledWith(UID, 'live');
    expect([stripeModeOf('Production'), stripeModeOf('Sandbox'), kindEnvOf('live'), kindEnvOf('test')]).toEqual(['live', 'test', 'Production', 'Sandbox']);
  });
  it('the pure planFromFacts leaves siteMode at device (accountPlan sets it, see siteMode.test.ts)', () => {
    for (const [m] of TABLE) expect(planFromFacts(facts(m)).siteMode).toBe('device');
  });
});

describe('getPlan with ACCOUNT_PLAN_V2 on', () => {
  beforeEach(() => vi.stubEnv('ACCOUNT_PLAN_V2', '1'));
  afterEach(() => vi.unstubAllEnvs());
  const base = (over: Partial<ShopPlanDeps> = {}): ShopPlanDeps => ({
    getUser: async () => ({ id: UID, email: null, fullName: null }),
    shopByOwner: async () => ({ id: 's', ios_otid: '2000000000001' }),
    purchase: async () => ({ ...apple(), site_slug: 'fresh-cuts', published_at: iso(NOW - DAY), lapse_checked_at: null, last_notification: null } as any),
    verify: async () => { throw new Error('no'); }, upsertVerified: async () => { throw new Error('no'); },
    setShopOtid: async () => 'ok', setUserIfUnlinked: async () => true, now: () => NOW, ...over,
  });
  it('adds the new fields and leaves the old ones as they were', async () => {
    const off = await (async () => { vi.stubEnv('ACCOUNT_PLAN_V2', ''); const r = await getPlan('Bearer x', base()); vi.stubEnv('ACCOUNT_PLAN_V2', '1'); return r; })();
    const plan = planFromFacts(facts({ name: 'x', apple: [appleSite()] }));
    const on: any = await getPlan('Bearer x', base({ accountPlan: async () => plan }));
    expect(on.status).toBe(200);
    for (const k of Object.keys(off.body)) expect(on.body[k]).toEqual((off.body as any)[k]);
    expect(on.body).toMatchObject({ source: 'apple', status: 'active', kind: 'apple', legacy: false, holderPurchaseEnded: false, site: { slug: 'fresh-cuts', holder: 'apple' }, capabilities: { siteMode: 'device' } });
  });
  it('keeps memberProfile next to siteMode', async () => {
    const plan = planFromFacts(facts({ name: 'x' }));
    const on: any = await getPlan('Bearer x', base({ accountPlan: async () => plan, memberProfileLive: async () => true }));
    expect(on.body.capabilities).toEqual({ memberProfile: true, siteMode: 'device' });
  });
  it('a failing lookup answers exactly as the switch off would', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: any = await getPlan('Bearer x', base({ accountPlan: async () => { throw new Error('db down'); } }));
    vi.stubEnv('ACCOUNT_PLAN_V2', '');
    const off: any = await getPlan('Bearer x', base());
    expect(JSON.stringify(bad)).toBe(JSON.stringify(off));
    err.mockRestore();
  });
  it('a stray ios_otid on a web account still reads web', async () => {
    const plan = planFromFacts(facts({ name: 'x', sites: [webSite()], cards: [card('active')] }));
    const on: any = await getPlan('Bearer x', base({ purchase: async () => null, accountPlan: async () => plan }));
    expect(on.body).toMatchObject({ kind: 'web', source: 'stripe', linked: true, active: false });
  });
});
