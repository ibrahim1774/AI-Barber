// ACCOUNT_PLAN_V2 off: getPlan answers are exactly today's, whatever the account mix, and the new reader is never called.
// "Today's" is the real thing: fixtures/planFlow.main.ts is a verbatim copy of lib/ios/planFlow.ts from origin/main (ffa87cdf), imports
// repointed, and every mix is compared against its output.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPlan, type PlanDeps } from '../../lib/ios/planFlow.js';
import { getPlan as getPlanMain } from './fixtures/planFlow.main.js';
import type { PurchaseRow } from '../../lib/ios/purchases.js';

const P = 'com.ibrahim1774.aibarber.';
const NOW = 1_800_000_000_000;
const USER = '11111111-1111-4111-8111-111111111111';
const OTID = '2000000123456789';
const row = (o: Partial<PurchaseRow> = {}): PurchaseRow => ({
  original_transaction_id: OTID, product_id: `${P}bookings.monthly`, environment: 'Production', site_slug: 'fresh-cuts', user_id: USER,
  expires_at: '2027-01-01T00:00:00.000Z', revoked_at: null, last_notification: null, published_at: '2026-10-01T00:00:00.000Z',
  taken_down_at: null, lapse_checked_at: null, product_purchased_at: null, ...o,
});
const web = row({ original_transaction_id: 'web:sub_1', product_id: `${P}store.monthly`, site_slug: null, published_at: null });

type Mix = { shop: { id: string; ios_otid: string | null } | null; purchase?: PurchaseRow | null; own?: PurchaseRow[]; web?: PurchaseRow | null; memberProfile?: boolean };
const run = async (m: Mix, extra: Partial<PlanDeps> = {}, impl: typeof getPlan = getPlan) => {
  const deps: PlanDeps = {
    getUser: async () => ({ id: USER, email: null, fullName: null }),
    shopByOwner: async () => m.shop,
    purchase: async () => m.purchase ?? null,
    verify: async () => { throw new Error('no'); },
    upsertVerified: async () => { throw new Error('no'); },
    setShopOtid: async () => 'ok',
    setUserIfUnlinked: async () => true,
    purchasesOfUser: async () => m.own ?? [],
    webEntitlementOf: async () => m.web ?? null,
    memberProfileLive: m.memberProfile === undefined ? undefined : async () => m.memberProfile!,
    now: () => NOW,
    ...extra,
  };
  return impl('Bearer x', deps);
};

const MIXES: Record<string, Mix> = {
  'shop with live apple': { shop: { id: 's', ios_otid: OTID }, purchase: row(), memberProfile: true },
  'shop with lapsed apple': { shop: { id: 's', ios_otid: OTID }, purchase: row({ taken_down_at: '2026-11-01T00:00:00.000Z' }) },
  'shop with stray ios_otid and web plan': { shop: { id: 's', ios_otid: OTID }, purchase: null, web },
  'shop with no link and web plan': { shop: { id: 's', ios_otid: null }, web, memberProfile: false },
  'no shop, own apple': { shop: null, own: [row()], memberProfile: true },
  'no shop, nothing': { shop: null },
};

describe('getPlan with ACCOUNT_PLAN_V2 off is unchanged', () => {
  beforeEach(() => { vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('ACCOUNT_PLAN_V2', ''); });
  afterEach(() => vi.unstubAllEnvs());
  for (const [name, mix] of Object.entries(MIXES)) {
    it(name, async () => {
      const boom = vi.fn(async () => { throw new Error('must not be read'); });
      const plain = await run(mix);
      const withReader = await run(mix, { accountPlan: boom } as any);
      expect(JSON.stringify(withReader)).toBe(JSON.stringify(plain));
      expect(boom).not.toHaveBeenCalled();
      expect(JSON.stringify(plain)).toBe(JSON.stringify(await run(mix, {}, getPlanMain as any)));
    });
  }
});
