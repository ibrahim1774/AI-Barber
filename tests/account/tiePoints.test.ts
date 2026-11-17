// Every place that ties an Apple purchase to an account or a shop asks `tie` first, and on a refusal writes nothing to
// ios_purchases.user_id or ab_shops.ios_otid. The flows take `tie` as an optional dep (absent = today's behaviour; the live wiring
// passes liveTie, which reads ONE_SITE_GUARD).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runIosPublish, runIosSiteLookup, type PublishDeps } from '../../lib/ios/publishFlow.js';
import { refreshPlan, type PlanDeps } from '../../lib/ios/planFlow.js';
import { setupShop } from '../../lib/bookings/ownerFlow.js';
import { makePurchaseVerifier } from '../../lib/bookings/live.js';
import { runTransfer, type TransferDeps } from '../../lib/ios/transfer.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';
import type { PurchaseRow } from '../../lib/ios/purchases.js';
import type { VerifiedTx } from '../../lib/ios/appleVerify.js';
import type { TieCheck, TieDecision } from '../../lib/account/mayTake.js';
import { fakePurchasesDb } from '../ios/fakePurchasesDb.js';
import { world } from '../bookings/fakeRepo.js';

const NOW = 1_800_000_000_000;
const OTID = '2000000123';
const WEB_USER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
const OWNER = 'aaaaaaaa-1111-4111-8111-111111111111';
const PRODUCT = 'com.ibrahim1774.aibarber.hosting.monthly';
const EXPIRES = '2027-01-01T00:00:00.000Z';
const base = { original_transaction_id: OTID, product_id: PRODUCT, environment: 'Production', site_slug: null, user_id: null, expires_at: EXPIRES, revoked_at: null, last_notification: null, published_at: null, taken_down_at: null, lapse_checked_at: null, removed_at: null };
const TX: VerifiedTx = { originalTransactionId: OTID, transactionId: '2000000555', latestTransactionId: '2000000555', productId: PRODUCT, environment: 'Production', expiresAt: Date.parse(EXPIRES), revoked: false, status: 1, productPurchasedAt: NOW - 1000 };

const refuse = (reason: 'web-account' | 'other-apple-id' | 'mixed' = 'web-account', slug = 'web-site'): TieDecision => ({ action: 'refuse', reason, slug });
const tieOf = (d: TieDecision) => vi.fn(async (_u: string, _o: string, _w: string) => d) as unknown as TieCheck & ReturnType<typeof vi.fn>;
const userWrites = (log: { op: string; payload?: any }[]) => log.filter((l) => l.payload && 'user_id' in l.payload);

const siteData = () => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn', phone: '555-0100',
  hero: { heading: 'H', tagline: 'T', imageUrl: 'https://img.example/hero.jpg' },
  about: { heading: 'A', description: ['d'], imageUrl: '' },
  services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: '' }], gallery: [], craftImages: [], staff: [],
  contact: { address: '1 Main St', email: 'a@b.co' },
}) as any;

function iosPublish(rows: any[], tie?: TieCheck) {
  const db = fakePurchasesDb(rows);
  const repo = supabasePurchases(db.client);
  const deps: PublishDeps = {
    verify: vi.fn(async () => TX), repo, isTaken: vi.fn(async () => false), writePending: vi.fn(async () => {}),
    publish: vi.fn(async (slug: string) => ({ ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app`, alreadyLive: false }) as any),
    readPending: vi.fn(async () => null),
    userOf: vi.fn(async (t: string) => (t === 'tok' ? { id: WEB_USER } : null)),
    now: () => NOW, tie,
  };
  return { db, deps };
}
const pub = (deps: PublishDeps) => runIosPublish({ transactionId: '2000000555', siteData: siteData() } as any, deps, { authorization: 'Bearer tok' });

describe('iOS publish (lib/ios/publishFlow.ts, the unlinked + signed-in tie)', () => {
  it('a refusal answers 409 account-has-site with the account\'s address and ties nothing', async () => {
    const tie = tieOf(refuse());
    const { db, deps } = iosPublish([{ ...base }], tie);
    expect(await pub(deps)).toEqual({ status: 409, body: { error: 'account-has-site', slug: 'web-site', reason: 'web-account' } });
    expect(tie).toHaveBeenCalledWith(WEB_USER, OTID, 'ios/publish');
    expect(userWrites(db.log)).toEqual([]);
    expect(db.row(OTID)!.user_id).toBeNull();
    expect(db.row(OTID)!.site_slug).toBeNull();
    expect(deps.writePending).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });
  it('undecidable (enforce, unreadable): 503, nothing tied', async () => {
    const { db, deps } = iosPublish([{ ...base }], tieOf({ action: 'unavailable' }));
    expect((await pub(deps)).status).toBe(503);
    expect(userWrites(db.log)).toEqual([]);
  });
  it('allowed: ties and publishes as before', async () => {
    const tie = tieOf({ action: 'allow' });
    const { db, deps } = iosPublish([{ ...base }], tie);
    expect((await pub(deps)).status).toBe(200);
    expect(db.row(OTID)!.user_id).toBe(WEB_USER);
  });
  it('a republish by an already-linked purchase never reaches the check', async () => {
    const tie = tieOf(refuse());
    const { deps } = iosPublish([{ ...base, user_id: WEB_USER, site_slug: 'fresh-cuts', published_at: '2026-10-01T00:00:00Z' }], tie);
    expect((await pub(deps)).status).toBe(200);
    expect(tie).not.toHaveBeenCalled();
  });
  it('an accountless compat publish (no bearer) never asks: it ties nothing', async () => {
    const tie = tieOf(refuse());
    const { deps } = iosPublish([{ ...base }], tie);
    const r = await runIosPublish({ transactionId: '2000000555', siteData: siteData() } as any, { ...deps, allowAccountlessPublish: true }, {});
    expect(r.status).toBe(200);
    expect(tie).not.toHaveBeenCalled();
  });
  it('today\'s refusals still win: another account\'s binding answers before the check', async () => {
    const tie = tieOf(refuse());
    const { deps } = iosPublish([{ ...base, site_slug: 'theirs' }], tie);
    deps.bindingOwner = async () => OWNER;
    expect((await pub(deps)).status).toBe(409);
    expect(tie).not.toHaveBeenCalled();
  });
});

describe('Restore (runIosSiteLookup, the unlinked tie)', () => {
  const lookup = (rows: any[], tie: TieCheck) => {
    const { db, deps } = iosPublish(rows, tie);
    deps.bindingOwner = async () => null;
    return { db, run: () => runIosSiteLookup('2000000555', deps, { authorization: 'Bearer tok' }) };
  };
  it('a refusal answers 404 no-site and ties nothing', async () => {
    const tie = tieOf(refuse());
    const { db, run } = lookup([{ ...base, site_slug: 'old-site' }], tie);
    expect(await run()).toEqual({ status: 404, body: { error: 'no-site' } });
    expect(tie).toHaveBeenCalledWith(WEB_USER, OTID, 'ios/site');
    expect(userWrites(db.log)).toEqual([]);
  });
  it('undecidable: 503, nothing tied', async () => {
    const { db, run } = lookup([{ ...base, site_slug: 'old-site' }], tieOf({ action: 'unavailable' }));
    expect((await run()).status).toBe(503);
    expect(userWrites(db.log)).toEqual([]);
  });
  it('allowed: links as before', async () => {
    const { db, run } = lookup([{ ...base, site_slug: 'old-site' }], tieOf({ action: 'allow' }));
    expect((await run()).status).toBe(200);
    expect(db.row(OTID)!.user_id).toBe(WEB_USER);
  });
});

describe('plan check (lib/ios/planFlow.ts refreshPlan)', () => {
  const SHOP = '33333333-3333-4333-8333-333333333333';
  function plan(o: { shopOtid?: string | null; hasShop?: boolean; rows?: Record<string, PurchaseRow>; tie?: TieCheck }) {
    const shop = { id: SHOP, ios_otid: o.shopOtid ?? null };
    const rows: Record<string, PurchaseRow> = o.rows ?? { [OTID]: { ...base } as any };
    const deps: PlanDeps = {
      getUser: vi.fn(async () => ({ id: WEB_USER, email: null, fullName: null })),
      shopByOwner: vi.fn(async () => (o.hasShop === false ? null : { ...shop })),
      purchase: vi.fn(async (otid: string) => (rows[otid] ? { ...rows[otid] } : null)),
      verify: vi.fn(async () => TX),
      upsertVerified: vi.fn(async () => ({ ...rows[OTID] })),
      setShopOtid: vi.fn(async (_id: string, otid: string | null) => { shop.ios_otid = otid; return 'ok' as const; }),
      setUserIfUnlinked: vi.fn(async (otid: string, uid: string) => { if (rows[otid].user_id) return false; rows[otid].user_id = uid; return true; }),
      now: () => NOW, tie: o.tie,
    };
    return { deps, shop, rows };
  }
  it('with a shop: a refusal ties nothing (no shop link, no account link) and answers 200 with the current plan', async () => {
    const tie = tieOf(refuse());
    const { deps, shop, rows } = plan({ tie });
    const r = await refreshPlan('Bearer x', { transactionId: '2000000555' }, deps);
    expect(r.status).toBe(200);
    expect((r.body as any).linked).toBe(false);
    expect(tie).toHaveBeenCalledWith(WEB_USER, OTID, 'shop/plan');
    expect(deps.setShopOtid).not.toHaveBeenCalled();
    expect(deps.setUserIfUnlinked).not.toHaveBeenCalled();
    expect(shop.ios_otid).toBeNull();
    expect(rows[OTID].user_id).toBeNull();
  });
  it('with a shop: allowed links both, as before', async () => {
    const { deps, shop, rows } = plan({ tie: tieOf({ action: 'allow' }) });
    const r = await refreshPlan('Bearer x', { transactionId: '2000000555' }, deps);
    expect((r.body as any).linked).toBe(true);
    expect(shop.ios_otid).toBe(OTID);
    expect(rows[OTID].user_id).toBe(WEB_USER);
  });
  it('with a shop that already points at an already-linked purchase: nothing is tied, so it is never asked', async () => {
    const tie = tieOf(refuse());
    const { deps } = plan({ shopOtid: OTID, rows: { [OTID]: { ...base, user_id: WEB_USER } as any }, tie });
    expect((await refreshPlan('Bearer x', { transactionId: '2000000555' }, deps)).status).toBe(200);
    expect(tie).not.toHaveBeenCalled();
  });
  it('undecidable answers 503 (a new Apple payer is not shown "no plan") and ties nothing; no shop too', async () => {
    const { deps } = plan({ tie: tieOf({ action: 'unavailable' }) });
    expect((await refreshPlan('Bearer x', { transactionId: '2000000555' }, deps)).status).toBe(503);
    expect((await refreshPlan('Bearer x', { transactionId: '2000000555' }, plan({ hasShop: false, tie: tieOf({ action: 'unavailable' }) }).deps)).status).toBe(503);
    expect(deps.setShopOtid).not.toHaveBeenCalled();
    expect(deps.setUserIfUnlinked).not.toHaveBeenCalled();
  });
  it('no shop (refreshNoShop): a refusal links nothing', async () => {
    const tie = tieOf(refuse());
    const { deps, rows } = plan({ hasShop: false, tie });
    const r = await refreshPlan('Bearer x', { transactionId: '2000000555' }, deps);
    expect(r.status).toBe(200);
    expect(tie).toHaveBeenCalledWith(WEB_USER, OTID, 'shop/plan (no shop)');
    expect(deps.setUserIfUnlinked).not.toHaveBeenCalled();
    expect(rows[OTID].user_id).toBeNull();
  });
  it('no shop: allowed links as before', async () => {
    const { deps, rows } = plan({ hasShop: false, tie: tieOf({ action: 'allow' }) });
    await refreshPlan('Bearer x', { transactionId: '2000000555' }, deps);
    expect(rows[OTID].user_id).toBe(WEB_USER);
  });
});

describe('shop setup (lib/bookings/ownerFlow.ts) and bookings/live', () => {
  const NEW_USER = '22222222-2222-4222-8222-222222222222';
  const SITE = '33333333-3333-4333-8333-333333333333';
  const NEW_OTID = '2000000901';
  const body = { siteId: SITE, name: 'Kings Cuts', timezone: 'America/Chicago', address: '9 Elm', phone: '555-0100', transactionId: '2000000555', services: [{ name: 'Haircut', priceCents: 3500, durationMin: 30 }] };
  function fresh(tie?: TieCheck) {
    const w = world();
    w.users['new-jwt'] = { id: NEW_USER, email: 'k@example.com', fullName: 'King Kong' };
    w.state.purchases[NEW_OTID] = { user_id: null, product_id: PRODUCT, revoked_at: null, taken_down_at: null, site_slug: null } as any;
    (w.deps.purchases!.verify as any).mockResolvedValue({ originalTransactionId: NEW_OTID });
    w.deps.tie = tie;
    return w;
  }
  it('a refusal sets the shop up but links no purchase and sets no shop link', async () => {
    const tie = tieOf(refuse());
    const w = fresh(tie);
    const r = await setupShop('Bearer new-jwt', body, w.deps);
    expect(r.status).toBe(200);
    expect((r.body as any).shop.purchaseLinked).toBe(false);
    expect(tie).toHaveBeenCalledWith(NEW_USER, NEW_OTID, 'shop/setup');
    expect(w.state.purchases[NEW_OTID].user_id).toBeNull();
    expect(w.state.shops.some((s: any) => s.ios_otid === NEW_OTID)).toBe(false);
    expect(w.deps.purchases!.linkUserIfUnlinked).not.toHaveBeenCalled();
  });
  it('undecidable answers 503 BEFORE any write: no shop, member or service is created either (B8)', async () => {
    const w = fresh(tieOf({ action: 'unavailable' }));
    const shops = w.state.shops.length;
    expect((await setupShop('Bearer new-jwt', body, w.deps)).status).toBe(503);
    expect(w.state.purchases[NEW_OTID].user_id).toBeNull();
    expect(w.state.shops).toHaveLength(shops);
  });
  it('the verifier\'s second ask can never leave "shop linked, account not": the shop link is put back (B8)', async () => {
    const w = fresh(tieOf({ action: 'allow' }));
    (w.deps.purchases!.linkUserIfUnlinked as any).mockResolvedValueOnce(false); // declined by the verifier\'s own check
    const r = await setupShop('Bearer new-jwt', body, w.deps);
    expect(r.status).toBe(200);
    expect(w.state.shops.some((s: any) => s.ios_otid === NEW_OTID)).toBe(false);
    expect(w.state.purchases[NEW_OTID].user_id).toBeNull();
  });
  it('allowed links both as before', async () => {
    const w = fresh(tieOf({ action: 'allow' }));
    expect((await setupShop('Bearer new-jwt', body, w.deps)).status).toBe(200);
    expect(w.state.purchases[NEW_OTID].user_id).toBe(NEW_USER);
  });
  it('bookings/live: the verifier\'s own link asks too, and a refusal links nothing', async () => {
    const setUserIfUnlinked = vi.fn(async () => true);
    const tie = tieOf(refuse());
    const v = makePurchaseVerifier(async () => ({ verify: async () => TX, repo: { upsertVerified: async () => ({}) as any, setUserIfUnlinked } }), () => NOW, tie);
    expect(await v.linkUserIfUnlinked(OTID, WEB_USER)).toBe(false);
    expect(tie).toHaveBeenCalledWith(WEB_USER, OTID, 'bookings/live link');
    expect(setUserIfUnlinked).not.toHaveBeenCalled();
    const open = makePurchaseVerifier(async () => ({ verify: async () => TX, repo: { upsertVerified: async () => ({}) as any, setUserIfUnlinked } }), () => NOW);
    expect(await open.linkUserIfUnlinked(OTID, WEB_USER)).toBe(true);
  });
});

describe('transfer (lib/ios/transfer.ts, the unlinked link and the confirmed move)', () => {
  const A = 'bbbbbbbb-2222-4222-8222-222222222222';
  const BUNDLE = 'com.ibrahim1774.aibarber';
  function setup(rows: any[], tie?: TieCheck) {
    const db = fakePurchasesDb(rows);
    const repo = supabasePurchases(db.client);
    const moves: string[] = [];
    const deps: TransferDeps = {
      verify: async () => TX, repo, userOf: async () => ({ id: A }), allow: async () => true, now: () => NOW,
      shopSummary: async () => ({ hasShop: false }), shopOf: async () => null,
      intents: { begin: async (i: any) => { moves.push(`intent:${i.otid}`); }, find: async () => null, pendingFor: async () => [], pendingFrom: async () => [], pendingForOtid: async () => [], finish: async () => {}, cancel: async () => {} } as any,
      moveBusiness: async (o) => { moves.push(`move:${o}`); },
      decodeProof: async () => ({}) as any, bundleId: BUNDLE, requireProof: false, ownerToken: (o, t) => `tok:${o}:${t}`, tie,
    };
    return { db, deps, moves };
  }
  const go = (deps: TransferDeps, b: any = { transactionId: '1' }) => runTransfer(b, deps, { authorization: 'Bearer ta' });
  it('the unlinked link: a web account is refused with the existing move-blocked body and nothing is linked', async () => {
    const tie = tieOf(refuse('web-account'));
    const { db, deps } = setup([{ ...base }], tie);
    const r = await go(deps);
    expect(r).toMatchObject({ status: 409, body: { error: 'move-blocked-web-account' } });
    expect(tie).toHaveBeenCalledWith(A, OTID, 'ios/transfer link');
    expect(userWrites(db.log)).toEqual([]);
  });
  it('the unlinked link: a different Apple ID answers account-has-site with the address', async () => {
    const { db, deps } = setup([{ ...base }], tieOf(refuse('other-apple-id', 'apple-site')));
    expect(await go(deps)).toEqual({ status: 409, body: { error: 'account-has-site', slug: 'apple-site', reason: 'site' } });
    expect(userWrites(db.log)).toEqual([]);
  });
  it('the confirmed move: refused before the intent is recorded or the owner changes (transferUser never runs)', async () => {
    const { db, deps, moves } = setup([{ ...base, user_id: OWNER }], tieOf(refuse('mixed')));
    const r = await go(deps, { transactionId: '1', confirm: true, ownerToken: `tok:${OWNER}:${OTID}` });
    expect(r.status).toBe(409);
    expect(moves).toEqual([]);
    expect(db.row(OTID)!.user_id).toBe(OWNER);
    expect(userWrites(db.log)).toEqual([]);
  });
  it('undecidable: 503, nothing moved or linked', async () => {
    const { db, deps } = setup([{ ...base }], tieOf({ action: 'unavailable' }));
    expect((await go(deps)).status).toBe(503);
    expect(userWrites(db.log)).toEqual([]);
  });
  it('allowed: links as before', async () => {
    const { db, deps } = setup([{ ...base }], tieOf({ action: 'allow' }));
    expect(await go(deps)).toEqual({ status: 200, body: { moved: false, linked: true } });
    expect(db.row(OTID)!.user_id).toBe(A);
  });
  it('GATE_ANY_SOURCE kind lookups use the purchase\'s own environment, never the Stripe key (B6)', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    const kindOf = vi.fn(async () => ({ kind: 'neither' as const, holdsWebAddress: false, holdsAppleAddress: false }));
    const { db, deps } = setup([{ ...base }], tieOf({ action: 'allow' }));
    expect(await go({ ...deps, kindOf })).toEqual({ status: 200, body: { moved: false, linked: true } });
    expect(kindOf).toHaveBeenCalledWith(A, 'Production');
    expect(db.row(OTID)!.user_id).toBe(A);
    vi.unstubAllEnvs();
  });
});

describe('what the app is told about a refused tie (accountEmail, blockedPurchase)', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('iOS publish 409 carries the caller\'s OWN email, and only the caller\'s', async () => {
    const emailOf = vi.fn(async (id: string) => (id === WEB_USER ? 'me@example.com' : 'someone-else@example.com'));
    const { deps } = iosPublish([{ ...base }], tieOf(refuse('web-account', '')));
    const r: any = await pub({ ...deps, emailOf });
    expect(r).toEqual({ status: 409, body: { error: 'account-has-site', slug: '', reason: 'web-account', accountEmail: 'me@example.com' } });
    expect(emailOf.mock.calls).toEqual([[WEB_USER]]);
  });
  it('no email known or a failing lookup: the body is as before (no accountEmail)', async () => {
    const a: any = await pub({ ...iosPublish([{ ...base }], tieOf(refuse())).deps, emailOf: async () => null });
    expect('accountEmail' in a.body).toBe(false);
    const b: any = await pub({ ...iosPublish([{ ...base }], tieOf(refuse())).deps, emailOf: async () => { throw new Error('x'); } });
    expect(b.status).toBe(409); expect('accountEmail' in b.body).toBe(false);
  });
  const SHOP = '33333333-3333-4333-8333-333333333333';
  const planDeps = (hasShop: boolean, tie: TieCheck): PlanDeps => {
    const rows: Record<string, PurchaseRow> = { [OTID]: { ...base } as any };
    return {
      getUser: async () => ({ id: WEB_USER, email: 'me@example.com', fullName: null }),
      shopByOwner: async () => (hasShop ? { id: SHOP, ios_otid: null } : null), purchase: async (o: string) => ({ ...rows[o] }),
      verify: async () => TX, upsertVerified: async () => ({ ...rows[OTID] }), setShopOtid: async () => 'ok', setUserIfUnlinked: async () => true, now: () => NOW, tie,
    } as any;
  };
  for (const hasShop of [true, false]) {
    it(`plan check refused (${hasShop ? 'shop' : 'no shop'}): ONE_SITE_GUARD=1 adds blockedPurchase with the caller's own email; otherwise nothing is added`, async () => {
      const mk = () => planDeps(hasShop, tieOf(refuse('other-apple-id', 'x')));
      vi.stubEnv('ONE_SITE_GUARD', '1');
      const on: any = await refreshPlan('Bearer x', { transactionId: '2000000555' }, mk());
      expect(on.status).toBe(200);
      expect(on.body.blockedPurchase).toEqual({ reason: 'other-apple-id', accountEmail: 'me@example.com' });
      for (const v of ['alert', '']) {
        vi.stubEnv('ONE_SITE_GUARD', v);
        const off: any = await refreshPlan('Bearer x', { transactionId: '2000000555' }, mk());
        expect('blockedPurchase' in off.body).toBe(false);
      }
    });
  }
  it('an allowed tie never carries blockedPurchase', async () => {
    vi.stubEnv('ONE_SITE_GUARD', '1');
    const r: any = await refreshPlan('Bearer x', { transactionId: '2000000555' }, planDeps(true, tieOf({ action: 'allow' })));
    expect('blockedPurchase' in r.body).toBe(false);
  });

  it('a SANDBOX purchase never carries accountEmail (409) or blockedPurchase (plan check)', async () => {
    const SBX: VerifiedTx = { ...TX, environment: 'Sandbox' };
    const emailOf = vi.fn(async () => 'me@example.com');
    const p = iosPublish([{ ...base, environment: 'Sandbox' }], tieOf(refuse('web-account', '')));
    p.deps.verify = vi.fn(async () => SBX);
    const r: any = await pub({ ...p.deps, emailOf });
    expect(r.status).toBe(409);
    expect('accountEmail' in r.body).toBe(false);
    expect(emailOf).not.toHaveBeenCalled();
    vi.stubEnv('ONE_SITE_GUARD', '1');
    for (const hasShop of [true, false]) {
      const d = planDeps(hasShop, tieOf(refuse('web-account', 'x')));
      d.verify = vi.fn(async () => SBX);
      const pr: any = await refreshPlan('Bearer x', { transactionId: '2000000555' }, d);
      expect(pr.status).toBe(200);
      expect('blockedPurchase' in pr.body).toBe(false);
    }
  });
  it('planLive false travels on the 409 (next to accountEmail) and on blockedPurchase; absent when not given', async () => {
    const t = tieOf({ action: 'refuse', reason: 'web-account', slug: '', planLive: false });
    const r: any = await pub({ ...iosPublish([{ ...base }], t).deps, emailOf: async () => 'me@example.com' });
    expect(r.body).toEqual({ error: 'account-has-site', slug: '', reason: 'web-account', accountEmail: 'me@example.com', planLive: false });
    vi.stubEnv('ONE_SITE_GUARD', '1');
    const pr: any = await refreshPlan('Bearer x', { transactionId: '2000000555' }, planDeps(true, t));
    expect(pr.body.blockedPurchase).toEqual({ reason: 'web-account', accountEmail: 'me@example.com', planLive: false });
    const none: any = await pub(iosPublish([{ ...base }], tieOf(refuse())).deps);
    expect('planLive' in none.body).toBe(false);
  });
});

