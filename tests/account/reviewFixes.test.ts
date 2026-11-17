// Wave B review fixes: environment readings, lean owner-email check, gateRow soft failure, return base by kind, Free opens Bookings.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { accountKindReading, accountKind, readKind, type ApplePurchaseFact, type KindDeps } from '../../lib/account/kind.js';
import { accountPlan, defaultKindEnv, hasLivePlan, type PlanDeps } from '../../lib/account/plan.js';
import { fetchWebEntitlementOf, gateRow } from '../../lib/webApp/entitlementGate.js';
import { isWebShop, webReturnBaseOf } from '../../lib/webApp/ownerNotify.js';
import { ownerBookingsAllowed } from '../../lib/bookings/core.js';
import { entitlementActive } from '../../lib/ios/lapse.js';
import { ownerHasWebPlan } from '../../lib/webApp/ownerNotify.js';

const P = 'com.ibrahim1774.aibarber.';
const NOW = Date.parse('2026-11-17T12:00:00Z');
const FUT = '2099-01-01T00:00:00Z';
const ap = (o: Partial<ApplePurchaseFact> = {}): ApplePurchaseFact => ({ original_transaction_id: '1', product_id: `${P}bookings.monthly`, environment: 'Production', user_id: 'u1', site_slug: null, published_at: null, expires_at: FUT, revoked_at: null, taken_down_at: null, removed_at: null, last_notification: null, ...o });
const card = (status = 'active') => ({ stripe_subscription_id: 'sub_1', status, tier: 'bookings', billing_interval: 'month', created_at: '2026-10-01T00:00:00Z' });
const deps = (o: { apple?: ApplePurchaseFact[]; cards?: any[]; sites?: any[]; free?: boolean; fail?: Array<'apple' | 'cards' | 'free' | 'sites'> } = {}): PlanDeps & { legacyOwner: ReturnType<typeof vi.fn> } => {
  const f = o.fail ?? [];
  const boom = (k: string) => { if (f.includes(k as never)) throw new Error(`${k} read failed`); };
  return {
    applePurchases: async () => { boom('apple'); return o.apple ?? []; },
    entitlements: async () => { boom('cards'); return o.cards ?? []; },
    webSites: async () => { boom('sites'); return o.sites ?? []; },
    isFree: async () => { boom('free'); return !!o.free; },
    legacyOwner: vi.fn(async () => false),
    now: () => NOW,
  };
};

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('(a) the decision reading ignores Sandbox Apple rows in Production', () => {
  const sandboxAddress = ap({ environment: 'Sandbox', site_slug: 'rev-site', published_at: '2026-10-01T00:00:00Z' });
  it('Production: a Sandbox Apple address changes nothing; Sandbox env sees it (as appStoreGuard.counts)', async () => {
    const d = deps({ apple: [sandboxAddress] });
    expect((await accountKindReading('u1', 'Production', d)).kind).toBe('neither');
    expect((await accountKindReading('u1', 'Sandbox', d)).kind).toBe('apple');
  });
  it('Production: a web account with a Sandbox Apple address stays web, not mixed', async () => {
    const d = deps({ apple: [sandboxAddress], sites: [{ slug: 'w', published_at: '2026-10-02T00:00:00Z' }] });
    expect(await accountKind('u1', 'Production', d)).toBe('web');
    expect(await accountKind('u1', 'Sandbox', d)).toBe('mixed');
  });
  it('the paid reading still counts the Sandbox purchase', async () => {
    const p = await accountPlan('u1', 'Production', deps({ apple: [sandboxAddress] }));
    expect(p).toMatchObject({ kind: 'neither', source: 'apple', active: true, test: true, site: null });
  });
  it('readKind needs the env in its facts', () => {
    expect(readKind({ env: 'Production', webSites: [], applePurchases: [ap({ environment: 'Sandbox' })], entitlements: [], now: NOW }).liveApplePurchase).toBe(false);
  });
});

describe('(c) isWebShop with the lean check', () => {
  beforeEach(() => vi.stubEnv('GATE_ANY_SOURCE', '1'));
  const shop = { owner_id: 'u1', ios_otid: null };
  const check = (d: ReturnType<typeof deps>) => (uid: string) => hasLivePlan(uid, 'Production', d);
  it('is a superset of today: an entitled card plan on an unlinked shop is still true', async () => {
    expect(await isWebShop(shop, undefined, check(deps({ cards: [card()] })))).toBe(true);
    expect(await isWebShop(shop, undefined, check(deps({ cards: [card('past_due')] })))).toBe(true);
  });
  it('is a superset of the real ownerHasWebPlan over the same data (cards and Free)', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    const worlds: Array<{ cards: any[]; free: boolean }> = [
      { cards: [card('active')], free: false }, { cards: [card('trialing')], free: false }, { cards: [card('past_due')], free: false },
      { cards: [card('canceled')], free: false }, { cards: [], free: true }, { cards: [], free: false }, { cards: [card('canceled')], free: true },
    ];
    for (const w of worlds) {
      const rest = async (path: string) => (path.startsWith('web_app_entitlements?') ? w.cards.map((c) => ({ environment: 'test', status: c.status })) : [{ price_group: w.free ? 'free' : 'base' }]);
      const today = await ownerHasWebPlan('u1', rest as any);
      const lean = await hasLivePlan('u1', 'Sandbox', deps({ cards: w.cards, free: w.free }));
      if (today) expect(lean).toBe(true);
      expect(lean).toBe(today); // with no Apple rows the two agree exactly
    }
  });
  it('adds Apple live and Free; refuses ended and nothing', async () => {
    expect(await isWebShop({ ...shop, ios_otid: 'x' }, undefined, check(deps({ apple: [ap()] })))).toBe(true);
    expect(await isWebShop(shop, undefined, check(deps({ free: true })))).toBe(true);
    expect(await isWebShop(shop, undefined, check(deps({ cards: [card('canceled')], apple: [ap({ taken_down_at: '2026-11-01T00:00:00Z' })] })))).toBe(false);
    expect(await isWebShop(shop, undefined, check(deps()))).toBe(false);
  });
  it('never reads site_owners or the sites', async () => {
    const d = deps({ apple: [ap()], fail: ['sites'] });
    expect(await isWebShop(shop, undefined, check(d))).toBe(true);
    expect(d.legacyOwner).not.toHaveBeenCalled();
  });
  it('one failing irrelevant read does not drop the email', async () => {
    expect(await isWebShop(shop, undefined, check(deps({ apple: [ap()], fail: ['cards', 'free'] })))).toBe(true);
    expect(await isWebShop(shop, undefined, check(deps({ cards: [card()], fail: ['apple'] })))).toBe(true);
    expect(await isWebShop(shop, undefined, check(deps({ free: true, fail: ['apple', 'cards'] })))).toBe(true);
  });
  it('nothing live and a read failed: fails closed (false, logged)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await isWebShop(shop, undefined, check(deps({ fail: ['cards'] })))).toBe(false);
  });
});

describe('(f) gateRow soft failure', () => {
  const lapsed = { product_id: `${P}bookings.monthly`, environment: 'Production', expires_at: FUT, revoked_at: null, taken_down_at: '2026-11-01T00:00:00Z' };
  it('a failed web lookup returns the linked purchase and does not throw', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1'); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo = { purchase: async () => lapsed, webEntitlementOf: async () => { throw new Error('supabase down'); } };
    expect(await gateRow(repo, { ios_otid: 'o', owner_id: 'u1' })).toBe(lapsed);
    expect(err).toHaveBeenCalled();
  });
});

describe('(d) a lapsed Apple link plus Free opens Bookings but not Store, with the real web lookup', () => {
  // Minimal fake of the supabase query builder fetchWebEntitlementOf uses.
  const fakeDb = (o: { group?: string | null }) => ({
    from: (t: string) => {
      const rows = t === 'web_app_entitlements' ? [] : null;
      const b: any = { select: () => b, eq: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => ({ data: t === 'web_app_price_groups' && o.group ? { price_group: o.group } : null, error: null }),
        then: (res: any) => res({ data: rows, error: null }) };
      return b;
    },
  });
  const lapsed = { original_transaction_id: 'o', product_id: `${P}store.monthly`, environment: 'Production', expires_at: FUT, revoked_at: null, taken_down_at: '2026-11-01T00:00:00Z', site_slug: 'x', published_at: '2026-10-01T00:00:00Z' };
  const mk = (group: string | null) => ({ purchase: async () => lapsed as any, webEntitlementOf: (uid: string) => fetchWebEntitlementOf(fakeDb({ group }) as any, uid) as any });
  const shop = { ios_otid: 'o', owner_id: 'u1' };
  beforeEach(() => { vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); });
  it('switch on: Bookings open, Store closed', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    const repo = mk('free');
    expect(await ownerBookingsAllowed(repo, shop)).toBe(true);
    expect(entitlementActive(await gateRow(repo, shop), 'store')).toBe(false);
  });
  it('switch off: closed, as today', async () => {
    expect(await ownerBookingsAllowed(mk('free'), shop)).toBe(false);
  });
  it('switch on but no Free group: closed', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    expect(await ownerBookingsAllowed(mk(null), shop)).toBe(false);
  });
});

describe('webReturnBaseOf', () => {
  const noShop = async () => null;
  const stray = async () => 'lapsed-otid';
  it('off: today (a stray link means the iOS page; no kind read)', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    const kindOf = vi.fn(async () => 'web');
    expect(await webReturnBaseOf('u1', stray, async () => true, kindOf)).toBeNull();
    expect(kindOf).not.toHaveBeenCalled();
  });
  it('on: a web account returns to the web page even with a stray lapsed Apple link; others to the iOS page', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    expect(await webReturnBaseOf('u1', stray, async () => false, async () => 'web')).toMatch(/^https:/);
  });
  it('on: neither and mixed keep today: a web plan on an unlinked shop returns to the web page, no plan does not', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1'); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    for (const k of ['neither', 'mixed']) {
      expect(await webReturnBaseOf('u1', noShop, async () => true, async () => k)).toMatch(/^https:/);
      expect(await webReturnBaseOf('u1', noShop, async () => false, async () => k)).toBeNull();
      expect(await webReturnBaseOf('u1', stray, async () => true, async () => k)).toBeNull(); // a linked shop is not a web shop today
    }
  });
  it('on: apple goes to the iOS page whatever the web plan says', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1'); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    expect(await webReturnBaseOf('u1', noShop, async () => true, async () => 'apple')).toBeNull();
  });
  it('on: a kind lookup error falls back to the iOS page', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await webReturnBaseOf('u1', noShop, async () => true, async () => { throw new Error('x'); })).toBeNull();
  });
});

describe('defaultKindEnv', () => {
  it('maps the Stripe key, and throws when it is missing or unknown', () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x'); expect(defaultKindEnv()).toBe('Production');
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'rk_test_x'); expect(defaultKindEnv()).toBe('Sandbox');
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', ''); expect(() => defaultKindEnv()).toThrow();
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'garbage'); expect(() => defaultKindEnv()).toThrow();
  });
  it('accountPlan without a key throws instead of assuming Production', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', '');
    await expect(accountPlan('u1', undefined, deps())).rejects.toThrow();
  });
});
