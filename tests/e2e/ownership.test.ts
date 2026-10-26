// E2E: Apple ID vs account ownership (plan 2026-10-26, DECIDED: a subscription is never movable).
// ios_purchases.user_id is the one account a purchase belongs to; /api/ios/site, /api/ios/publish and
// /api/shop/plan refuse any other account on the same Apple ID, and lapse / renewal act on the linked
// account only.
vi.mock('@google-cloud/storage', async () => (await import('./harness/gcs.js')).storageModule);
vi.mock('../../lib/deploySite.js', async () => (await import('./harness/vercel.js')).deploySiteModule);
vi.mock('../../lib/siteSubpages.js', async (orig) => (await import('./harness/subpages.js')).subpagesModule(await orig()));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DAY, USER_A, USER_B, resetBoundaries, siteData, siteWorld, type SiteWorld } from './harness/world.js';
import { PRODUCTS } from './harness/apple.js';
import { pendingOf } from './harness/gcs.js';
import { maskEmail } from '../../lib/ios/ownership.js';

let w: SiteWorld;
const A = 'Bearer jwt-a';
const B = 'Bearer jwt-b';
beforeEach(() => {
  resetBoundaries();
  w = siteWorld();
  w.emails.set(USER_A, 'Alice.Cuts@Gmail.com');
  w.emails.set(USER_B, 'bob@example.org');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A buys and publishes while signed in: the purchase links to A. */
async function aBuys(product: string = PRODUCTS.storeMonthly) {
  const p = w.apple.buy(product);
  const r = await w.publish(p.transactionId, siteData(), {}, { authorization: A });
  expect(r.status).toBe(200);
  expect(w.row(p.otid)!.user_id).toBe(USER_A);
  return p;
}

describe('masked hint', () => {
  it('first letter + *** + domain, lower-cased; null for anything that is not an email', () => {
    expect(maskEmail('alice@gmail.com')).toBe('a***@gmail.com');
    expect(maskEmail('  Alice.Cuts@Gmail.com ')).toBe('a***@gmail.com');
    expect(maskEmail('x@y.co')).toBe('x***@y.co');
    for (const bad of ['', 'nope', '@x.com', 'a@', null, undefined]) expect(maskEmail(bad as any)).toBeNull();
  });
});

describe('A buys and links; B on the same Apple ID is refused', () => {
  it('A signed in: the purchase links to A, lookup returns the site', async () => {
    const { transactionId } = await aBuys();
    const r = await w.lookup(transactionId, A);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ siteId: 'fade-lab', active: true });
  });

  it('B: site lookup is 409 purchase-other-account with the masked hint and NO site data', async () => {
    const { transactionId } = await aBuys();
    const r = await w.lookup(transactionId, B);
    expect(r).toEqual({ status: 409, body: { error: 'purchase-other-account', hint: 'a***@gmail.com', ownerHint: 'a***@gmail.com', hasLiveSite: true } });
    const wire = JSON.stringify(r.body);
    expect(wire).not.toMatch(/fade-lab|siteData|alice|Alice|deployedUrl/i);
    expect(wire).not.toContain(USER_A);
  });

  it('B: publish is 409, nothing is written (stored copy, version, slug, link all untouched)', async () => {
    const { otid, transactionId } = await aBuys();
    const before = JSON.stringify(pendingOf('fade-lab'));
    const bSite = siteData({ shopName: 'Bobs Barbers' });
    const r = await w.publish(transactionId, bSite, { baseVersion: 1 }, { authorization: B });
    expect(r).toEqual({ status: 409, body: { error: 'purchase-other-account', hint: 'a***@gmail.com', ownerHint: 'a***@gmail.com', hasLiveSite: true } });
    expect(JSON.stringify(pendingOf('fade-lab'))).toBe(before);
    expect(w.row(otid)!.user_id).toBe(USER_A);
    expect(w.row(otid)!.site_slug).toBe('fade-lab');
    // B cannot create a second site on the same purchase either.
    expect(w.db.rows.size).toBe(1);
  });

  it('B: Restore (POST /api/shop/plan) is 409 and links nothing; the hint is masked', async () => {
    const { otid, transactionId } = await aBuys();
    const shop = { id: 'shop-b', ios_otid: null as string | null };
    const r = await w.refreshPlan('Bearer owner-jwt', { transactionId }, w.planDeps(shop, { id: USER_B }, { emailOf: async (id) => w.emails.get(id) ?? null }));
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'purchase-in-use', reason: 'purchase-other-account', hint: 'a***@gmail.com', ownerHint: 'a***@gmail.com', hasLiveSite: true });
    expect(shop.ios_otid).toBeNull();
    expect(w.row(otid)!.user_id).toBe(USER_A);
  });

  it('GET plan: self for A; B (no shop) sees nothing of A\'s purchase and there is no ?otid probe', async () => {
    const { otid } = await aBuys();
    const shopA = { id: 'shop-a', ios_otid: otid as string | null };
    const asA = await w.getPlan('Bearer owner-jwt', w.planDeps(shopA, { id: USER_A }));
    expect(asA.body).toMatchObject({ linked: true, purchaseAccount: 'self' });
    const shopB = { id: 'shop-b', ios_otid: null as string | null };
    const asB = await w.getPlan('Bearer owner-jwt', w.planDeps(shopB, { id: USER_B }));
    expect(asB.body).toMatchObject({ linked: false, purchaseAccount: null, entitlements: { hosting: false, bookings: false, store: false } });
    // The shop of B points at A's purchase (stale link): nothing is granted, purchaseAccount is 'other'.
    const stale = await w.getPlan('Bearer owner-jwt', w.planDeps({ id: 'shop-b2', ios_otid: otid }, { id: USER_B }));
    expect(stale.body).toMatchObject({ purchaseAccount: 'other', active: false, entitlements: { hosting: false, bookings: false, store: false } });
  });

  it('A can still Restore and publish; a renewal under A keeps working (3.1.1)', async () => {
    const { otid, transactionId } = await aBuys();
    const shop = { id: 'shop-a', ios_otid: null as string | null };
    expect((await w.refreshPlan('Bearer owner-jwt', { transactionId }, w.planDeps(shop, { id: USER_A }))).status).toBe(200);
    expect((await w.lookup(transactionId, A)).status).toBe(200);
    w.clock.advance(31 * DAY);
    w.apple.renew(otid, { at: w.clock.now() });
    const r = await w.publish(transactionId, siteData(), { baseVersion: 1 }, { authorization: A });
    expect(r.status).toBe(200);
  });
});

describe('unauthenticated', () => {
  it('site lookup: no token asks Apple and answers auth-required (linked) or no-site (nothing bound); bad tokens stay unauthorized', async () => {
    const { transactionId } = await aBuys();
    const calls = w.apple.state.calls;
    for (const auth of [undefined, '']) {
      expect(await w.lookup(transactionId, auth as any)).toEqual({ status: 401, body: { error: 'auth-required' } });
    }
    expect(w.apple.state.calls).toBeGreaterThan(calls);
    const after = w.apple.state.calls;
    for (const auth of ['Bearer', 'Bearer nope', 'Basic jwt-a']) {
      expect(await w.lookup(transactionId, auth as any)).toEqual({ status: 401, body: { error: 'unauthorized' } });
    }
    expect(w.apple.state.calls).toBe(after);
  });

  it('publish to a linked purchase with no / invalid token is 401 (nothing written)', async () => {
    const { otid, transactionId } = await aBuys();
    const before = JSON.stringify(pendingOf('fade-lab'));
    for (const authorization of [undefined, 'Bearer nope']) {
      const r = await w.publish(transactionId, siteData(), { baseVersion: 1 }, { authorization });
      expect(r).toEqual({ status: 401, body: { error: 'unauthorized' } });
    }
    expect(JSON.stringify(pendingOf('fade-lab'))).toBe(before);
    expect(w.row(otid)!.user_id).toBe(USER_A);
  });

  it('a no-account first publish keeps the old fresh-bind behaviour and links nothing', async () => {
    const p = w.apple.buy(PRODUCTS.websiteMonthly);
    expect((await w.publish(p.transactionId)).status).toBe(200);
    expect(w.row(p.otid)!.user_id).toBeNull();
    expect(w.row(p.otid)!.site_slug).toBe('fade-lab');
  });
});

describe('legacy unlinked purchases', () => {
  async function legacy() {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    expect((await w.publish(p.transactionId)).status).toBe(200); // anonymous publish: bound, user_id null
    expect(w.row(p.otid)!.user_id).toBeNull();
    return p;
  }

  it('the account that owns the bound shop/site links it on lookup and gets the site', async () => {
    const { otid, transactionId } = await legacy();
    w.shopOwners.set(otid, USER_A);
    const r = await w.lookup(transactionId, A);
    expect(r.status).toBe(200);
    expect(w.row(otid)!.user_id).toBe(USER_A);
    // ...and from then on B is refused.
    expect((await w.lookup(transactionId, B)).status).toBe(409);
  });

  it('another account is 409 and does NOT link it (shop belongs to A)', async () => {
    const { otid, transactionId } = await legacy();
    w.shopOwners.set(otid, USER_A);
    const r = await w.lookup(transactionId, B);
    expect(r).toEqual({ status: 409, body: { error: 'purchase-other-account', hint: 'a***@gmail.com', ownerHint: 'a***@gmail.com', hasLiveSite: true } });
    expect(w.row(otid)!.user_id).toBeNull();
  });

  it('M2: a legacy accountless site (nobody attached) is linked by the first signed-in Restore, then B is refused', async () => {
    const { otid, transactionId } = await legacy();
    const r = await w.lookup(transactionId, A);
    expect(r.status).toBe(200);
    expect(w.row(otid)!.user_id).toBe(USER_A);
    expect((await w.lookup(transactionId, B)).status).toBe(409);
  });

  it('an unbound unlinked purchase has no site: 404 no-site, not linked by a lookup', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    await w.repo.upsertVerified(await w.apple.verify(p.transactionId));
    expect(await w.lookup(p.transactionId, A)).toEqual({ status: 404, body: { error: 'no-site' } });
    expect(w.row(p.otid)!.user_id).toBeNull();
  });

  it('publish: a signed-in caller claims an unclaimed legacy row; the shop owner wins over a stranger', async () => {
    const mine = await legacy();
    expect((await w.publish(mine.transactionId, siteData(), { baseVersion: 1 }, { authorization: A })).status).toBe(200);
    expect(w.row(mine.otid)!.user_id).toBe(USER_A); // nobody else owned it: first signed-in publish links

    const theirs = await legacy2();
    w.shopOwners.set(theirs.otid, USER_A);
    const r = await w.publish(theirs.transactionId, siteData({ shopName: 'Bobs' }), { baseVersion: 1 }, { authorization: B });
    expect(r.status).toBe(409);
    expect(w.row(theirs.otid)!.user_id).toBeNull();
  });
  async function legacy2() {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    await w.publish(p.transactionId, siteData({ shopName: 'Second Cuts' }));
    return p;
  }

  it('a lookup that finds the shop ownership ambiguous is 409 and links nobody', async () => {
    const { otid, transactionId } = await legacy();
    w.shopOwners.set(otid, 'ambiguous');
    expect(await w.lookup(transactionId, A)).toEqual({ status: 409, body: { error: 'purchase-other-account', hint: null, ownerHint: null, hasLiveSite: true } });
    expect(w.row(otid)!.user_id).toBeNull();
  });
});

describe('concurrent link race', () => {
  it('two accounts publish on the same unlinked purchase at once: exactly one links and wins, the other is 409', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    const [ra, rb] = await Promise.all([
      w.publish(p.transactionId, siteData(), {}, { authorization: A }),
      w.publish(p.transactionId, siteData({ shopName: 'Bobs Barbers' }), {}, { authorization: B }),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 409]);
    const owner = w.row(p.otid)!.user_id;
    expect([USER_A, USER_B]).toContain(owner);
    expect(owner).toBe(ra.status === 200 ? USER_A : USER_B);
    // The loser can never read it afterwards.
    expect((await w.lookup(p.transactionId, ra.status === 200 ? B : A)).status).toBe(409);
  });

  it('the same account racing itself (double tap) is fine: both succeed, one link', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    const rs = await Promise.all([1, 2, 3].map(() => w.publish(p.transactionId, siteData(), {}, { authorization: A })));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(w.row(p.otid)!.user_id).toBe(USER_A);
  });
});

describe('lapse, refund, revoke and renewal act on the linked account only', () => {
  it('lapse -> sweep takes the site down; B stays refused; renewal under A unlocks the same site', async () => {
    const { otid, transactionId } = await aBuys();
    w.clock.advance(31 * DAY);
    await w.notify(w.apple.notification('EXPIRED', otid));
    const s = await w.sweep();
    expect(s.takenDown).toEqual(['fade-lab']);
    expect(w.row(otid)!.taken_down_at).not.toBeNull();
    expect(w.row(otid)!.user_id).toBe(USER_A); // the sweep never re-points the link
    expect((await w.lookup(transactionId, A)).body).toMatchObject({ active: false });
    expect((await w.lookup(transactionId, B)).status).toBe(409);
    expect((await w.publish(transactionId, siteData(), { baseVersion: 1 }, { authorization: A })).body).toEqual({ error: 'subscription-inactive' });

    w.apple.renew(otid, { at: w.clock.now() }); // renewal / Restore under the SAME account
    const back = await w.publish(transactionId, siteData(), { baseVersion: 1 }, { authorization: A });
    expect(back.status).toBe(200);
    expect(w.row(otid)!.taken_down_at).toBeNull();
    expect((await w.lookup(transactionId, A)).body).toMatchObject({ siteId: 'fade-lab', active: true });
    expect((await w.lookup(transactionId, B)).status).toBe(409);
  });

  it('refund -> sweep takes it down for A; a second account cannot publish the site back', async () => {
    const { otid, transactionId } = await aBuys();
    w.apple.refund(otid);
    await w.notify(w.apple.notification('REFUND', otid));
    expect((await w.sweep()).takenDown).toEqual(['fade-lab']);
    expect((await w.lookup(transactionId, A)).body).toMatchObject({ active: false });
    const r = await w.publish(transactionId, siteData({ shopName: 'Bobs' }), { baseVersion: 1 }, { authorization: B });
    expect(r.status).toBe(402); // inactive is decided by Apple first; B never gets past it either way
    expect(w.row(otid)!.user_id).toBe(USER_A);
  });
});


describe('every writer of ios_purchases.user_id is one atomic conditional update (two accounts, one winner)', () => {
  it('source audit: the only code that writes user_id on ios_purchases is setUserIfUnlinked (WHERE user_id IS NULL)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        if (n === 'node_modules' || n.startsWith('.')) continue;
        const f = join(d, n);
        statSync(f).isDirectory() ? walk(f) : /\.ts$/.test(n) && files.push(f);
      }
    };
    walk('lib'); walk('api');
    const writers = files.filter((f) => /update\(\{[^}]*\buser_id\b/.test(readFileSync(f, 'utf8').replace(/\s+/g, ' ')) && /from\('ios_purchases'\)|TABLE = 'ios_purchases'/.test(readFileSync(f, 'utf8')));
    expect(writers).toEqual([join('lib', 'ios', 'purchases.ts')]);
    const src = readFileSync(join('lib', 'ios', 'purchases.ts'), 'utf8');
    expect(src).toMatch(/update\(\{ user_id: userId \}\)\s*\.eq\('original_transaction_id', otid\)\.is\('user_id', null\)/);
    // The one other writer is transferUser (POST /api/ios/transfer): a compare-and-set on the CURRENT owner, never a blind write.
    expect(src).toMatch(/update\(\{ user_id: toUserId \}\)\s*\.eq\('original_transaction_id', otid\)\.eq\('user_id', fromUserId\)/);
    expect((src.match(/update\(\{ user_id/g) ?? []).length).toBe(2);
    expect(src).not.toMatch(/\bsetUser\(/);
  });

  it('publish vs publish on an unlinked purchase: one winner, the other 409, link never re-pointed', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    const [ra, rb] = await Promise.all([
      w.publish(p.transactionId, siteData(), {}, { authorization: A }),
      w.publish(p.transactionId, siteData(), {}, { authorization: B }),
    ]);
    const owner = w.row(p.otid)!.user_id;
    expect([USER_A, USER_B]).toContain(owner);
    const [win, lose] = owner === USER_A ? [ra, rb] : [rb, ra];
    expect(win.status).toBe(200);
    expect(lose.status).toBe(409);
    expect((lose.body as any).error).toBe('purchase-other-account');
    expect(w.row(p.otid)!.user_id).toBe(owner);
  });

  it('plan POST vs publish: a plan POST that loses never overwrites, and its shop link is put back', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    const shopB = { id: 'shop-b', ios_otid: null as string | null };
    const real = w.repo.setUserIfUnlinked.bind(w.repo);
    // A's publish links the purchase between B's read of the row and B's link.
    const deps = w.planDeps(shopB, { id: USER_B }, {
      setUserIfUnlinked: async (otid, uid) => { await real(otid, USER_A); return real(otid, uid); },
    });
    const r = await w.refreshPlan('Bearer owner-jwt', { transactionId: p.transactionId }, deps);
    expect(r.status).toBe(409);
    expect(w.row(p.otid)!.user_id).toBe(USER_A);
    expect(shopB.ios_otid).toBeNull();
  });

  it('restore (lookup) vs publish: B cannot take a purchase A linked, whatever the order', async () => {
    const { transactionId } = await aBuys();
    expect((await w.lookup(transactionId, B)).status).toBe(409);
    expect((await w.publish(transactionId, siteData(), {}, { authorization: B })).status).toBe(409);
    expect(w.row((await w.apple.verify(transactionId)).originalTransactionId)!.user_id).toBe(USER_A);
  });

  it('M1: a publish with no account on an unlinked purchase whose slug belongs to an account is 401', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    expect((await w.publish(p.transactionId, siteData(), {}, {})).status).toBe(200); // true first publish: fresh bind
    w.publishDeps.bindingOwner = async () => USER_A;
    const r = await w.publish(p.transactionId, siteData(), {}, {});
    expect(r).toEqual({ status: 401, body: { error: 'unauthorized' } });
  });
});
