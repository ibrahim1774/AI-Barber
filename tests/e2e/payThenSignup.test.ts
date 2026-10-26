// E2E: pay -> claim-start -> account -> publish (plan 2026-10-26-pay-then-signup-flow, tasks 1+2).
vi.mock('@google-cloud/storage', async () => (await import('./harness/gcs.js')).storageModule);
vi.mock('../../lib/deploySite.js', async () => (await import('./harness/vercel.js')).deploySiteModule);
vi.mock('../../lib/siteSubpages.js', async (orig) => (await import('./harness/subpages.js')).subpagesModule(await orig()));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DAY, USER_A, USER_B, resetBoundaries, siteData, siteWorld, type SiteWorld } from './harness/world.js';
import { PRODUCTS } from './harness/apple.js';
import { pendingOf } from './harness/gcs.js';
import { CLAIM_WINDOW_MS, runClaimStart } from '../../lib/ios/claimStart.js';
import { ALLOW_ACCOUNTLESS_PUBLISH_UNTIL_APP_SHIPS } from '../../lib/ios/publishFlow.js';

let w: SiteWorld;
const A = 'Bearer jwt-a';
const B = 'Bearer jwt-b';
beforeEach(() => {
  resetBoundaries();
  w = siteWorld();
  w.emails.set(USER_A, 'alice@gmail.com');
  w.emails.set(USER_B, 'bob@example.org');
  w.publishDeps.allowAccountlessPublish = false; // the strict, post-app-ship contract
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const claim = (transactionId: string, authorization?: string) =>
  runClaimStart({ transactionId }, { verify: (id) => w.apple.verify(id), repo: w.repo, userOf: w.publishDeps.userOf, now: w.clock.now }, { authorization });

describe('claim-start', () => {
  it('records a verified row: user_id null, no slug, no content, claim_expires_at = +30d', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    const t0 = w.clock.peek();
    const r = await claim(p.transactionId);
    expect(r.status).toBe(200);
    const row = w.row(p.otid)!;
    expect(row.user_id).toBeNull();
    expect(row.site_slug).toBeNull();
    expect(row.published_at).toBeNull();
    const exp = Date.parse(row.claim_expires_at!);
    expect(exp - t0).toBeGreaterThanOrEqual(CLAIM_WINDOW_MS);
    expect(exp - t0).toBeLessThan(CLAIM_WINDOW_MS + 60_000);
    expect(r.body).toMatchObject({ ok: true, state: 'unclaimed', claimExpiresAt: row.claim_expires_at });
    expect(pendingOf('fade-lab')).toBeNull();
  });

  it('is idempotent per otid: the second call returns the same deadline and does not extend it', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    const a = await claim(p.transactionId);
    w.clock.advance(5 * DAY);
    const b = await claim(p.transactionId);
    expect(b.status).toBe(200);
    expect((b.body as any).claimExpiresAt).toBe((a.body as any).claimExpiresAt);
    expect(w.db.rows.size).toBe(1);
  });

  it('a refunded / revoked purchase is 402 and creates no claim', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    w.apple.refund(p.otid);
    const r = await claim(p.transactionId);
    expect(r.status).toBe(402);
    expect(w.row(p.otid)?.claim_expires_at ?? null).toBeNull();
  });

  it('a revocation already stored by Apple notification is 402 too', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    expect((await claim(p.transactionId)).status).toBe(200);
    w.db.rows.get(p.otid)!.revoked_at = new Date(w.clock.now()).toISOString();
    // Apple still says active (refund-reversal race): the stored revoked_at older than the check is
    // cleared by upsertVerified, so force one newer than the check instead.
    w.db.rows.get(p.otid)!.revoked_at = new Date(w.clock.now() + 10 * DAY).toISOString();
    expect((await claim(p.transactionId)).status).toBe(402);
  });

  it('an expired subscription is 402', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    w.apple.lapse(p.otid);
    w.clock.advance(40 * DAY);
    expect((await claim(p.transactionId)).status).toBe(402);
  });

  it('after the account claims it, claim-start is 409 purchase-claimed for everybody but the owner (200)', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    await claim(p.transactionId);
    expect((await w.publish(p.transactionId, siteData(), {}, { authorization: A })).status).toBe(200);
    expect(await claim(p.transactionId)).toEqual({ status: 409, body: { error: 'purchase-claimed' } });
    expect(await claim(p.transactionId, B)).toEqual({ status: 409, body: { error: 'purchase-claimed' } });
    expect((await claim(p.transactionId, A)).status).toBe(200);
  });

  it('a malformed body is 400 and Apple is not asked', async () => {
    const calls = w.apple.state.calls;
    expect((await runClaimStart({}, { verify: (id) => w.apple.verify(id), repo: w.repo, now: w.clock.now })).status).toBe(400);
    expect(w.apple.state.calls).toBe(calls);
  });
});

describe('publish requires an account (strict contract)', () => {
  it('no Bearer on an unclaimed purchase is 401 and nothing is written', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    await claim(p.transactionId);
    const r = await w.publish(p.transactionId, siteData());
    expect(r).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(w.row(p.otid)!.site_slug).toBeNull();
    expect(w.row(p.otid)!.user_id).toBeNull();
    expect(pendingOf('fade-lab')).toBeNull();
  });

  it('a bad token is 401; an auth outage is 503; neither writes', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    expect((await w.publish(p.transactionId, siteData(), {}, { authorization: 'Bearer nope' })).status).toBe(401);
    w.publishDeps.userOf = async () => { throw new Error('auth down'); };
    expect((await w.publish(p.transactionId, siteData(), {}, { authorization: A })).status).toBe(503);
    expect(w.row(p.otid)!.site_slug ?? null).toBeNull();
  });

  it('with a Bearer: links, binds, writes and deploys in ONE request', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    await claim(p.transactionId);
    const r = await w.publish(p.transactionId, siteData(), {}, { authorization: A });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ siteId: 'fade-lab', republished: false });
    const row = w.row(p.otid)!;
    expect(row.user_id).toBe(USER_A);
    expect(row.site_slug).toBe('fade-lab');
    expect(row.published_at).not.toBeNull();
    expect(pendingOf('fade-lab')).toBeTruthy();
  });

  it('B on the same Apple ID is blocked after A claimed (409, nothing written)', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    await claim(p.transactionId);
    await w.publish(p.transactionId, siteData(), {}, { authorization: A });
    const before = JSON.stringify(pendingOf('fade-lab'));
    const r = await w.publish(p.transactionId, siteData({ shopName: 'Bobs' }), { baseVersion: 1 }, { authorization: B });
    expect(r).toEqual({ status: 409, body: { error: 'purchase-other-account', hint: 'a***@gmail.com' } });
    expect(JSON.stringify(pendingOf('fade-lab'))).toBe(before);
    expect(w.row(p.otid)!.user_id).toBe(USER_A);
  });

  it('two accounts racing for one unclaimed purchase: exactly one wins', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    await claim(p.transactionId);
    const [ra, rb] = await Promise.all([
      w.publish(p.transactionId, siteData(), {}, { authorization: A }),
      w.publish(p.transactionId, siteData(), {}, { authorization: B }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect([USER_A, USER_B]).toContain(w.row(p.otid)!.user_id);
  });

  it('account-has-site: an account that owns a different live site gets 409 before any write', async () => {
    const first = w.apple.buy(PRODUCTS.storeMonthly);
    expect((await w.publish(first.transactionId, siteData(), {}, { authorization: A })).status).toBe(200);
    const second = w.apple.buy(PRODUCTS.storeYearly);
    await claim(second.transactionId);
    const r = await w.publish(second.transactionId, siteData({ shopName: 'Second Shop' }), {}, { authorization: A });
    expect(r).toEqual({ status: 409, body: { error: 'account-has-site', slug: 'fade-lab' } });
    expect(w.row(second.otid)!.user_id).toBeNull();
    expect(w.row(second.otid)!.site_slug).toBeNull();
    expect(pendingOf('second-shop')).toBeNull();
  });

  it('account-has-site clears once the owner removed the first site (removed_at)', async () => {
    const first = w.apple.buy(PRODUCTS.storeMonthly);
    await w.publish(first.transactionId, siteData(), {}, { authorization: A });
    w.db.rows.get(first.otid)!.removed_at = new Date(w.clock.now()).toISOString();
    const second = w.apple.buy(PRODUCTS.storeYearly);
    expect((await w.publish(second.transactionId, siteData({ shopName: 'Second Shop' }), {}, { authorization: A })).status).toBe(200);
  });

  it('a failed link write fails closed: 503 and no site', async () => {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    vi.spyOn(w.repo, 'setUserIfUnlinked').mockRejectedValueOnce(new Error('db'));
    expect((await w.publish(p.transactionId, siteData(), {}, { authorization: A })).status).toBe(503);
    expect(w.row(p.otid)!.site_slug ?? null).toBeNull();
  });

  it('an expired unclaimed purchase can still be claimed (no auto-refund, no block)', async () => {
    const p = w.apple.buy(PRODUCTS.storeYearly);
    await claim(p.transactionId);
    w.clock.advance(CLAIM_WINDOW_MS + DAY);
    expect((await w.publish(p.transactionId, siteData(), {}, { authorization: A })).status).toBe(200);
  });

  it('deleting the account frees the purchase: user_id null, a NEW account can claim it; still never movable between live accounts', async () => {
    const p = w.apple.buy(PRODUCTS.storeYearly);
    await w.publish(p.transactionId, siteData(), {}, { authorization: A });
    // delete-account: the FK sets user_id null (ON DELETE SET NULL) and the removal stamps removed_at.
    const row = w.db.rows.get(p.otid)!;
    row.user_id = null;
    row.removed_at = new Date(w.clock.now()).toISOString();
    const r = await w.publish(p.transactionId, siteData(), { baseVersion: 1 }, { authorization: B });
    expect(r.status).toBe(200);
    expect(w.row(p.otid)!.user_id).toBe(USER_B);
    // ... and now A (or anyone else) cannot take it back.
    expect((await w.publish(p.transactionId, siteData(), { baseVersion: 2 }, { authorization: A })).status).toBe(409);
  });
});

describe('compat flag (old app builds)', () => {
  it('is on by default and named so it is removed after the app ships', () => {
    expect(ALLOW_ACCOUNTLESS_PUBLISH_UNTIL_APP_SHIPS).toBe(true);
  });

  it('with the flag on, a publish without a Bearer still fresh-binds as before', async () => {
    w.publishDeps.allowAccountlessPublish = undefined;
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    expect((await w.publish(p.transactionId, siteData())).status).toBe(200);
    expect(w.row(p.otid)!.user_id).toBeNull();
  });
});

describe('sweep logs expired unclaimed rows (log only)', () => {
  it('lists them in the summary, warns, and changes nothing', async () => {
    const warn = vi.spyOn(console, 'warn');
    const old = w.apple.buy(PRODUCTS.storeYearly);
    const fresh = w.apple.buy(PRODUCTS.storeMonthly);
    await claim(old.transactionId);
    w.clock.advance(31 * DAY);
    await claim(fresh.transactionId);
    const before = JSON.stringify([...w.db.rows.values()]);
    const s = await w.sweep();
    expect(s.expiredUnclaimed).toEqual([old.otid]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('EXPIRED UNCLAIMED') && String(c[0]).includes(old.otid))).toBe(true);
    expect(JSON.stringify([...w.db.rows.values()].map((r) => ({ ...r, lapse_checked_at: undefined })))).toBe(
      JSON.stringify(JSON.parse(before).map((r: any) => ({ ...r, lapse_checked_at: undefined }))));
    expect((await w.sweep()).expiredUnclaimed).toEqual([old.otid]); // still just logged, not consumed
  });

  it('a claimed row is no longer listed', async () => {
    const p = w.apple.buy(PRODUCTS.storeYearly);
    await claim(p.transactionId);
    w.clock.advance(31 * DAY);
    await w.publish(p.transactionId, siteData(), {}, { authorization: A });
    expect((await w.sweep()).expiredUnclaimed).toBeUndefined();
  });
});
