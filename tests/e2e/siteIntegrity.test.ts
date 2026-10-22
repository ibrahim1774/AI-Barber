// E2E: data-loss and integrity paths of an app site's stored copy (GCS pending-sites/{slug}.json)
// and its live deploy, across the phone publish, admin edits, the web editor deploy, the sweep and
// account linking. Bugs are it.fails with a sibling `it` proving the setup reaches the bad state.
vi.mock('@google-cloud/storage', async () => (await import('./harness/gcs.js')).storageModule);
vi.mock('../../lib/deploySite.js', async () => (await import('./harness/vercel.js')).deploySiteModule);
vi.mock('../../lib/siteSubpages.js', async (orig) => (await import('./harness/subpages.js')).subpagesModule(await orig()));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AI_SHOP, normHtml, resetBoundaries, siteData, siteWorld, httpReq, httpRes, type SiteWorld } from './harness/world.js';
import { PRODUCTS } from './harness/apple.js';
import { gcs, pendingOf } from './harness/gcs.js';
import { deferred, deploysOf, vercel } from './harness/vercel.js';
import { readPendingSite, readPendingVersioned, renderPending, writePendingSite } from '../../lib/publishSite.js';
import { updateSite, republish, getSite } from '../../lib/admin/sites.js';
import { deployRenderedSite } from '../../lib/deploySite.js';
import { deploySite, type DeploySiteDeps } from '../../api/deploy-site.js';

let w: SiteWorld;
beforeEach(() => {
  resetBoundaries();
  w = siteWorld();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const USER_A = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
const USER_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

async function published(product: string = PRODUCTS.storeMonthly) {
  const p = w.apple.buy(product);
  const r = await w.publish(p.transactionId);
  expect(r.status).toBe(200);
  return p;
}

// ---------------------------------------------------------------------------
describe('account link: a publish body re-points ios_purchases.user_id', () => {
  it('setup (was: the publish re-points user_id to B): the owner links through /api/shop/plan; a publish naming user B (body) or signed in as B (bearer) leaves A', async () => {
    const { otid, transactionId } = await published();
    const shop = { id: 'shop-a', ios_otid: null as string | null };
    const r = await w.refreshPlan('Bearer owner-jwt', { transactionId }, w.planDeps(shop, { id: USER_A }));
    expect(r.status).toBe(200);
    expect(w.row(otid)!.user_id).toBe(USER_A);
    const p = await w.publish(transactionId, siteData(), { userId: USER_B, baseVersion: 1 });
    expect(p.status).toBe(200);
    expect(w.row(otid)!.user_id).toBe(USER_A);
    const signedInB = await w.publish(transactionId, siteData(), { baseVersion: 2 }, { authorization: 'Bearer jwt-b' });
    expect(signedInB.status).toBe(200);
    expect(w.row(otid)!.user_id).toBe(USER_A);
  });

  it('I6: a verified bearer links a purchase that has no account yet', async () => {
    const { otid, transactionId } = await published();
    expect(w.row(otid)!.user_id).toBeNull();
    await w.publish(transactionId, siteData(), { userId: USER_B, baseVersion: 1 }, { authorization: 'Bearer jwt-a' });
    expect(w.row(otid)!.user_id).toBe(USER_A);
  });

  it('I6 (fixed): after a publish names another userId, the real owner still refreshes /api/shop/plan', async () => {
    const { transactionId } = await published();
    const shop = { id: 'shop-a', ios_otid: null as string | null };
    await w.refreshPlan('Bearer owner-jwt', { transactionId }, w.planDeps(shop, { id: USER_A }));
    await w.publish(transactionId, siteData(), { userId: USER_B, baseVersion: 1 });
    const again = await w.refreshPlan('Bearer owner-jwt', { transactionId }, w.planDeps(shop, { id: USER_A }));
    expect(again.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('admin edit racing a phone publish (no compare-and-set on the stored copy)', () => {
  /** Runs `during` once, right after the phone publish has read the stored copy. */
  function afterPhoneRead(slug: string, during: () => Promise<unknown>) {
    let fired = false;
    gcs.afterDownload = async (path) => {
      if (fired || path !== `pending-sites/${slug}.json`) return;
      fired = true;
      await during();
    };
  }

  it('setup (was: both write v2 and the admin edit is lost): the phone\'s write loses the compare-and-set, re-reads admin v2 and answers 409 with it', async () => {
    const { transactionId } = await published();
    let admin: any;
    afterPhoneRead('fade-lab', async () => {
      admin = await updateSite('fade-lab', { set: { phone: '555-ADMIN' } }, w.adminDeps());
    });
    const phone = await w.publish(transactionId, siteData({ area: 'Phone edit' }), { baseVersion: 1 });
    expect(admin).toMatchObject({ ok: true, version: 2 });
    expect(phone).toMatchObject({ status: 409, body: { error: 'site-updated', site: { version: 2, editedBy: 'admin' } } });
    expect((phone.body as any).site.siteData.phone).toBe('555-ADMIN');
    const stored = pendingOf('fade-lab');
    expect(stored).toMatchObject({ version: 2, editedBy: 'admin' });
    expect(stored.siteData.phone).toBe('555-ADMIN');
  });

  it('I1 (fixed): the admin edit is never silently lost (stored, or the phone gets 409)', async () => {
    const { transactionId } = await published();
    afterPhoneRead('fade-lab', () => updateSite('fade-lab', { set: { phone: '555-ADMIN' } }, w.adminDeps()));
    const phone = await w.publish(transactionId, siteData({ area: 'Phone edit' }), { baseVersion: 1 });
    const history = await w.adminDeps().store.listHistory('fade-lab');
    const kept = await Promise.all(history.map((h) => w.adminDeps().store.readHistory('fade-lab', h.id)));
    const adminContentSurvives = pendingOf('fade-lab').siteData.phone === '555-ADMIN' || kept.some((k) => k?.siteData.phone === '555-ADMIN');
    expect(phone.status === 409 || adminContentSurvives).toBe(true);
  });

  it('a phone that synced the admin version first is accepted and the 409 rule holds without a race', async () => {
    const { transactionId } = await published();
    await updateSite('fade-lab', { set: { phone: '555-ADMIN' } }, w.adminDeps());
    expect((await w.publish(transactionId, siteData(), { baseVersion: 1 })).status).toBe(409);
    const ok = await w.publish(transactionId, siteData({ phone: '555-ADMIN' }), { baseVersion: 2 });
    expect(ok.status).toBe(200);
    expect(pendingOf('fade-lab')).toMatchObject({ version: 3, editedBy: 'owner', adminVersion: 2 });
  });
});

// ---------------------------------------------------------------------------
describe('two deploys of one slug in flight: the one that FINISHES last is live', () => {
  it('I2 (fixed): an older phone publish finishing after a newer admin edit redeploys the newer copy', async () => {
    const { transactionId } = await published();
    const hold = deferred();
    vercel.gate = async (d) => { if (d.seq === 2) await hold.promise; };
    const phone = w.publish(transactionId, siteData({ area: 'Phone v2' }), { baseVersion: 1 });
    await vi.waitFor(() => expect(deploysOf('fade-lab')).toHaveLength(2));
    const admin = await updateSite('fade-lab', { set: { area: 'Admin v3' } }, w.adminDeps());
    expect(admin).toMatchObject({ ok: true, version: 3, deployed: true });
    hold.resolve();
    expect((await phone).status).toBe(200);
    const stored = pendingOf('fade-lab');
    expect(stored.siteData.area).toBe('Admin v3');
    expect(normHtml(vercel.live.get('fade-lab'))).toBe(normHtml(renderPending(stored)));
  });

  it('setup (was: the live HTML stays the phone v2 render): the late phone deploy is followed by a redeploy of admin v3, and the stamp lands on v3', async () => {
    const { transactionId } = await published();
    const hold = deferred();
    vercel.gate = async (d) => { if (d.seq === 2) await hold.promise; };
    const phone = w.publish(transactionId, siteData({ area: 'Phone v2' }), { baseVersion: 1 });
    await vi.waitFor(() => expect(deploysOf('fade-lab')).toHaveLength(2));
    await updateSite('fade-lab', { set: { area: 'Admin v3' } }, w.adminDeps());
    hold.resolve();
    await phone;
    // 1: first publish, 2: phone v2 (held), 3: admin v3, 4: the phone's redeploy of v3.
    expect(deploysOf('fade-lab').map((d) => d.html.includes('Admin v3'))).toEqual([false, false, true, true]);
    expect(vercel.live.get('fade-lab')).toContain('Admin v3');
    expect(pendingOf('fade-lab')).toMatchObject({ version: 3, deployedUrl: 'https://fade-lab.vercel.app' });
  });
});

// ---------------------------------------------------------------------------
describe('I3: the phone publish dry-renders before it stores (like admin saves)', () => {
  const broken = () => ({ ...siteData(), contact: undefined }) as any;

  it('setup (was: a phone publish with no contact replaces the good copy, then 502): refused 400 before Apple is asked; the good copy stays and republishes', async () => {
    const { transactionId } = await published();
    const good = JSON.stringify(pendingOf('fade-lab'));
    const lookups = w.apple.state.lookups.length;
    const r = await w.publish(transactionId, broken(), { baseVersion: 1 });
    expect(r).toMatchObject({ status: 400, body: { error: 'bad-request' } });
    expect(w.apple.state.lookups.length).toBe(lookups);
    expect(JSON.stringify(pendingOf('fade-lab'))).toBe(good);
    expect(await republish('fade-lab', w.adminDeps())).toMatchObject({ ok: true });
  });

  it('I3 (fixed): an unrenderable publish never destroys the last good stored copy (400 before any write)', async () => {
    const { transactionId } = await published();
    const r = await w.publish(transactionId, broken(), { baseVersion: 1 });
    expect(r.status).toBe(400);
    expect(pendingOf('fade-lab').siteData.contact).toBeDefined();
  });

  it('I3 (fixed): about.description sent as a string (old app build) is refused the same way', async () => {
    const { transactionId } = await published();
    const r = await w.publish(transactionId, siteData({ about: { heading: 'A', description: 'one paragraph' as any, imageUrl: '' } }), { baseVersion: 1 });
    expect(r.status).toBe(400);
    expect(Array.isArray(pendingOf('fade-lab').siteData.about.description)).toBe(true);
  });

  it('the admin path refuses the same data before writing anything', async () => {
    await published();
    const r = await updateSite('fade-lab', { replace: broken() }, w.adminDeps());
    expect(r).toMatchObject({ ok: false, error: 'bad-request' });
    expect(pendingOf('fade-lab').version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C1 (fixed by the deploy-auth hotfix, PR #243): /api/deploy-site now authorises every deploy
// (lib/deployAuth.ts). Driven through the real handler with in-process auth deps: tokens map to
// users, the purchase lookups read the same ios_purchases rows, Stripe has no sessions.
describe('/api/deploy-site (web editor deploy) reaching an app site', () => {
  const tokens: Record<string, { id: string; email: string | null }> = {
    'owner-a': { id: USER_A, email: 'a@example.com' },
    'owner-b': { id: USER_B, email: 'b@example.com' },
  };
  const deploy = async (body: Record<string, unknown>, token?: string) => {
    const res = httpRes();
    const deps: DeploySiteDeps = {
      auth: {
        userOf: async (t) => tokens[t] ?? null,
        findBySlug: (s) => w.repo.findBySlug(s),
        checkoutSession: async () => null,
        webClaimants: async () => [],
        storedStamp: async (s) => (await readPendingSite(s))?.deployedUrl || null,
        projectExists: async (s) => vercel.live.has(s) || vercel.projects.has(s),
        now: w.clock.now,
      },
      deploy: {
        deploy: deployRenderedSite, writePending: writePendingSite, readPending: readPendingSite, readPendingVersioned, now: w.clock.now,
      },
      limiter: { allow: async () => true },
    };
    await deploySite(httpReq({ body, headers: token ? { authorization: `Bearer ${token}` } : {} }), res, deps);
    return res;
  };
  const ownedBy = async (user: string) => {
    const p = await published();
    w.db.row(p.otid)!.user_id = user;
    return p;
  };

  it('setup: the Apple-bound owner (signed in) deploys and refreshes the stored copy as an owner write', async () => {
    await ownedBy(USER_A);
    await updateSite('fade-lab', { set: { phone: '555-ADMIN' } }, w.adminDeps()); // v2 by admin
    const res = await deploy({ siteId: 'fade-lab', html: '<h1>owner edit</h1>', siteData: siteData({ phone: '000' }) }, 'owner-a');
    expect(res.statusCode).toBe(200);
    expect(vercel.live.get('fade-lab')).toBe('<h1>owner edit</h1>');
    expect(pendingOf('fade-lab')).toMatchObject({ version: 3, editedBy: 'owner', adminVersion: 2 });
    expect(pendingOf('fade-lab').siteData.phone).toBe('000');
  });

  it('I1: an admin edit landing between the owner web edit\'s read and write is not given the same version (compare-and-set)', async () => {
    await ownedBy(USER_A);
    let fired = false;
    gcs.afterDownload = async (path) => {
      if (fired || path !== 'pending-sites/fade-lab.json') return;
      fired = true;
      gcs.afterDownload = null;
      await updateSite('fade-lab', { set: { phone: '555-ADMIN' } }, w.adminDeps()); // admin v2
    };
    const res = await deploy({ siteId: 'fade-lab', html: '<h1>owner edit</h1>', siteData: siteData({ phone: '000' }) }, 'owner-a');
    expect(res.statusCode).toBe(200);
    expect(pendingOf('fade-lab')).toMatchObject({ version: 3, editedBy: 'owner', adminVersion: 2 });
    const history = await w.adminDeps().store.listHistory('fade-lab');
    expect(history.map((h) => h.id)).toEqual(['1']);
  });

  it('C1 (fixed): an app site can not be replaced without the Apple-bound owner (401 / 403)', async () => {
    await ownedBy(USER_A);
    const anon = await deploy({ siteId: 'fade-lab', html: '<h1>phish</h1>' });
    expect(anon.statusCode).toBe(401);
    const other = await deploy({ siteId: 'fade-lab', html: '<h1>phish</h1>' }, 'owner-b');
    expect(other.statusCode).toBe(403);
    expect(vercel.live.get('fade-lab')).not.toContain('phish');
  });

  it.fails('BUG (parked, not in round 2): the owner\'s web deploy overwrites an admin edit with no baseVersion check (expected 409 site-updated)', async () => {
    await ownedBy(USER_A);
    await updateSite('fade-lab', { set: { phone: '555-ADMIN' } }, w.adminDeps());
    const res = await deploy({ siteId: 'fade-lab', html: '<h1>x</h1>', siteData: siteData() }, 'owner-a');
    expect(res.statusCode).toBe(409);
  });

  it('deployedUrl retargets only for the bound slug\'s owner; anyone else is refused', async () => {
    await ownedBy(USER_A);
    expect((await deploy({ siteId: 'my-own-site', html: '<h1>x</h1>', deployedUrl: 'https://fade-lab.vercel.app' }, 'owner-b')).statusCode).toBe(403);
    expect(vercel.live.get('fade-lab')).not.toBe('<h1>x</h1>');
    const res = await deploy({ siteId: 'my-own-site', html: '<h1>x</h1>', deployedUrl: 'https://fade-lab.vercel.app' }, 'owner-a');
    expect(res.statusCode).toBe(200);
    expect(vercel.live.get('fade-lab')).toBe('<h1>x</h1>');
    expect(vercel.live.has('my-own-site')).toBe(false);
  });

  it('a taken-down or revoked app site is refused with 402, even for its owner', async () => {
    const { otid } = await ownedBy(USER_A);
    w.db.row(otid)!.revoked_at = new Date().toISOString();
    const res = await deploy({ siteId: 'fade-lab', html: '<h1>x</h1>' }, 'owner-a');
    expect(res).toMatchObject({ statusCode: 402, body: { error: 'subscription-inactive' } });
  });
});

// ---------------------------------------------------------------------------
describe('sweep restore strips links with a read-modify-write of the stored copy', () => {
  async function takenDownAfterDowngrade() {
    const p = w.apple.buy(PRODUCTS.storeMonthly);
    await w.publish(p.transactionId, siteData({ shopUrl: AI_SHOP } as any));
    // Downgrade to Website at renewal, but the subscription lapses and the sweep takes it down.
    w.clock.advance(31 * 86_400_000);
    await w.notify(w.apple.notification('EXPIRED', p.otid));
    const s1 = await w.sweep();
    expect(s1.takenDown).toEqual(['fade-lab']);
    // Resubscribe on Website (same otid).
    w.apple.renew(p.otid, { productId: PRODUCTS.websiteMonthly, at: w.clock.peek() });
    await w.notify(w.apple.notification('SUBSCRIBED', p.otid));
    return p;
  }

  it('setup: restore drops the Shop link the Website plan does not cover and brings the site back', async () => {
    await takenDownAfterDowngrade();
    const s = await w.sweep();
    expect(s.restored).toEqual(['fade-lab']);
    expect('shopUrl' in pendingOf('fade-lab').siteData).toBe(false);
    expect(vercel.live.get('fade-lab')).not.toContain('Website unavailable');
  });

  it('I1 (fixed): a phone publish landing between the strip read and write survives (the strip re-applies on the fresh copy)', async () => {
    const p = await takenDownAfterDowngrade();
    let fired = false;
    gcs.afterDownload = async (path) => {
      if (fired || path !== 'pending-sites/fade-lab.json') return;
      fired = true;
      gcs.afterDownload = null;
      const r = await w.publish(p.transactionId, siteData({ area: 'Fresh phone edit' }), { baseVersion: 1 });
      expect(r.status).toBe(200);
    };
    await w.sweep();
    expect(pendingOf('fade-lab').siteData.area).toBe('Fresh phone edit');
    expect(pendingOf('fade-lab').version).toBe(2); // never backwards
    expect('shopUrl' in pendingOf('fade-lab').siteData).toBe(false);
  });
});
