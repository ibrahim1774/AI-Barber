import { describe, it, expect } from 'vitest';
import { entitlementActive, isActiveRow, isLapsed, purchaseLive, sweepWatches, type GateFields } from '../../lib/ios/lapse';
import { DOMAIN_PRODUCT_ID, IOS_PRODUCT_IDS, entitlementsOf, grants, tierOf, type Entitlement } from '../../lib/ios/tiers';

// Golden answers for the iOS purchase gates. The web app work (docs: web-app plan) must never change
// what these return for an Apple purchase row: this file is recorded on untouched origin/main (aeb4c3b)
// and any later diff in the snapshot means shipped iOS users would see a different answer.
const NOW = Date.parse('2026-06-15T12:00:00.000Z');
const PAST = '2026-06-10T00:00:00.000Z';
const RECENT = '2026-06-15T11:30:00.000Z'; // inside the 1 hour grace
const FUTURE = '2026-07-15T00:00:00.000Z';

const PRODUCTS = [...IOS_PRODUCT_IDS, DOMAIN_PRODUCT_ID, null, 'com.other.app.monthly', 'stripe:sub_123'];
const ENTS: Entitlement[] = ['hosting', 'bookings', 'store'];

describe('golden: tiers', () => {
  it('product id to tier and entitlements', () => {
    const out = PRODUCTS.map((p) => ({ p, tier: tierOf(p), ents: [...entitlementsOf(p)].sort(), grants: ENTS.map((e) => grants(p, e)) }));
    expect(out).toMatchSnapshot();
  });
});

describe('golden: lapse prefilters', () => {
  const rows = [
    { expires_at: null, revoked_at: null },
    { expires_at: PAST, revoked_at: null },
    { expires_at: RECENT, revoked_at: null },
    { expires_at: FUTURE, revoked_at: null },
    { expires_at: FUTURE, revoked_at: PAST },
    { expires_at: null, revoked_at: PAST },
    { expires_at: 'not a date', revoked_at: null },
  ];
  it('isLapsed and isActiveRow', () => {
    expect(rows.map((r) => ({ r, lapsed: isLapsed(r, NOW), active: isActiveRow(r, NOW) }))).toMatchSnapshot();
  });
});

describe('golden: purchase gates', () => {
  const bindings = [
    { site_slug: null, published_at: null },
    { site_slug: 'shop-a', published_at: null },
    { site_slug: 'shop-a', published_at: PAST },
  ];
  const lifecycles = [
    { revoked_at: null, taken_down_at: null, expires_at: FUTURE },
    { revoked_at: null, taken_down_at: null, expires_at: PAST },
    { revoked_at: null, taken_down_at: null, expires_at: RECENT },
    { revoked_at: null, taken_down_at: null, expires_at: null },
    { revoked_at: PAST, taken_down_at: null, expires_at: FUTURE },
    { revoked_at: null, taken_down_at: PAST, expires_at: FUTURE },
  ];
  it('sweepWatches, purchaseLive and entitlementActive over the full matrix', () => {
    const out: unknown[] = [];
    for (const product_id of PRODUCTS) for (const b of bindings) for (const l of lifecycles) {
      const row: GateFields = { product_id, ...b, ...l, environment: 'Production' };
      out.push({ product_id, b, l, watches: sweepWatches(row), live: purchaseLive(row, NOW), ent: ENTS.map((e) => entitlementActive(row, e, NOW)) });
    }
    expect(out).toMatchSnapshot();
  });
  it('a missing row is never live', () => {
    expect([purchaseLive(null, NOW), purchaseLive(undefined, NOW), ...ENTS.map((e) => entitlementActive(null, e, NOW))]).toEqual([false, false, false, false, false]);
  });
});
