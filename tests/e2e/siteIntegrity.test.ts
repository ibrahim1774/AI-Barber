// E2E: data-loss and integrity paths of an app site's stored copy (GCS pending-sites/{slug}.json)
// and its live deploy, across the phone publish, admin edits, the web editor deploy, the sweep and
// account linking. Bugs are it.fails with a sibling `it` proving the setup reaches the bad state.
vi.mock('@google-cloud/storage', async () => (await import('./harness/gcs.js')).storageModule);
vi.mock('../../lib/deploySite.js', async () => (await import('./harness/vercel.js')).deploySiteModule);
vi.mock('../../lib/ios/webDeployGate.js', async (importOriginal) => {
  const real: any = await importOriginal();
  return { ...real, liveWebDeployDeps: () => (globalThis as any).__e2eWebDeployDeps() };
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AI_SHOP, normHtml, resetBoundaries, siteData, siteWorld, httpReq, httpRes, type SiteWorld } from './harness/world.js';
import { PRODUCTS } from './harness/apple.js';
import { gcs, pendingOf } from './harness/gcs.js';
import { deferred, deploysOf, vercel } from './harness/vercel.js';
import { readPendingSite, renderPending, writePendingSite } from '../../lib/publishSite.js';
import { updateSite, republish, getSite } from '../../lib/admin/sites.js';
import { deployRenderedSite } from '../../lib/deploySite.js';
import deploySiteHandler from '../../api/deploy-site.js';

let w: SiteWorld;
beforeEach(() => {
  resetBoundaries();
  w = siteWorld();
  (globalThis as any).__e2eWebDeployDeps = () => ({
    findBySlug: (s: string) => w.repo.findBySlug(s), deploy: deployRenderedSite, writePending: writePendingSite,
    readPending: readPendingSite, now: w.clock.now,
  });
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
  it('setup: the shop owner (user A) links the purchase through /api/shop/plan', async () => {
    const { otid, transactionId } = await published();
    const shop = { id: 'shop-a', ios_otid: null as string | null };
    const r = await w.refreshPlan('Bearer owner-jwt', { transactionId }, w.planDeps(shop, { id: USER_A }));
    expect(r.status).toBe(200);
    expect(w.row(otid)!.user_id).toBe(USER_A);
    // An unauthenticated publish naming user B (another app account on the same Apple ID) is accepted...
    const p = await w.publish(transactionId, siteData(), { userId: USER_B, baseVersion: 1 });
    expect(p.status).toBe(200);
    expect(w.row(otid)!.user_id).toBe(USER_B);
  });

  it.fails('BUG: after a publish names another userId, the real owner is locked out of /api/shop/plan (409 purchase-in-use)', async () => {
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

  it('setup: an admin edit lands between the phone read (v1) and the phone write; both write v2', async () => {
    const { transactionId } = await published();
    let admin: any;
    afterPhoneRead('fade-lab', async () => {
      admin = await updateSite('fade-lab', { set: { phone: '555-ADMIN' } }, w.adminDeps());
    });
    const phone = await w.publish(transactionId, siteData({ area: 'Phone edit' }), { baseVersion: 1 });
    expect(admin).toMatchObject({ ok: true, version: 2 });
    expect(phone.status).toBe(200);
    expect((phone.body as any).version).toBe(2);
    const stored = pendingOf('fade-lab');
    expect(stored).toMatchObject({ version: 2, editedBy: 'owner' });
    expect(stored.siteData.phone).toBe('555-0100');
  });

  it.fails('BUG: the admin edit is silently lost (not stored, not in history, no 409 to the phone)', async () => {
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
  it.fails('BUG: an older phone publish finishing after a newer admin edit leaves stale content live', async () => {
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

  it('setup: the live HTML is the phone v2 render while the stored copy is admin v3', async () => {
    const { transactionId } = await published();
    const hold = deferred();
    vercel.gate = async (d) => { if (d.seq === 2) await hold.promise; };
    const phone = w.publish(transactionId, siteData({ area: 'Phone v2' }), { baseVersion: 1 });
    await vi.waitFor(() => expect(deploysOf('fade-lab')).toHaveLength(2));
    await updateSite('fade-lab', { set: { area: 'Admin v3' } }, w.adminDeps());
    hold.resolve();
    await phone;
    expect(vercel.live.get('fade-lab')).toContain('Phone v2');
    expect(pendingOf('fade-lab').version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
describe('publish stores before it renders (admin dry-renders first; the phone path does not)', () => {
  const broken = () => ({ ...siteData(), contact: undefined }) as any;

  it('setup: a phone publish with no contact passes the shape check and replaces the good stored copy', async () => {
    const { transactionId } = await published();
    const good = pendingOf('fade-lab');
    const r = await w.publish(transactionId, broken(), { baseVersion: 1 });
    expect(r).toMatchObject({ status: 502, body: { error: 'publish-failed', reason: 'deploy-failed' } });
    expect(pendingOf('fade-lab').version).toBe(2);
    expect(pendingOf('fade-lab').siteData.contact).toBeUndefined();
    expect(good.siteData.contact).toBeDefined();
    // No history is kept for owner writes, and the admin republish now refuses the copy.
    expect(await republish('fade-lab', w.adminDeps())).toMatchObject({ ok: false, error: 'invalid-copy' });
  });

  it.fails('BUG: an unrenderable publish destroys the last good stored copy (400 expected before any write)', async () => {
    const { transactionId } = await published();
    const r = await w.publish(transactionId, broken(), { baseVersion: 1 });
    expect(r.status).toBe(400);
    expect(pendingOf('fade-lab').siteData.contact).toBeDefined();
  });

  it.fails('BUG: about.description sent as a string (old app build) breaks the stored copy the same way', async () => {
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
describe('/api/deploy-site (web editor deploy) reaching an app site', () => {
  it('setup: an unauthenticated POST naming an active app slug deploys arbitrary HTML and rewrites the stored copy', async () => {
    await published();
    await updateSite('fade-lab', { set: { phone: '555-ADMIN' } }, w.adminDeps()); // v2 by admin
    const res = httpRes();
    await deploySiteHandler(httpReq({ body: { siteId: 'fade-lab', html: '<h1>not the barber</h1>', siteData: siteData({ phone: '000' }) } }), res);
    expect(res.statusCode).toBe(200);
    expect(vercel.live.get('fade-lab')).toBe('<h1>not the barber</h1>');
    expect(pendingOf('fade-lab')).toMatchObject({ version: 3, editedBy: 'owner', adminVersion: 2 });
    expect(pendingOf('fade-lab').siteData.phone).toBe('000');
  });

  it.fails('BUG (security): an app site can be replaced without the Apple-verified purchase (expected 401/403)', async () => {
    await published();
    const res = httpRes();
    await deploySiteHandler(httpReq({ body: { siteId: 'fade-lab', html: '<h1>phish</h1>' } }), res);
    expect([401, 402, 403]).toContain(res.statusCode);
  });

  it.fails('BUG: a web deploy overwrites an admin edit with no baseVersion check (expected 409 site-updated)', async () => {
    await published();
    await updateSite('fade-lab', { set: { phone: '555-ADMIN' } }, w.adminDeps());
    const res = httpRes();
    await deploySiteHandler(httpReq({ body: { siteId: 'fade-lab', html: '<h1>x</h1>', siteData: siteData() } }), res);
    expect(res.statusCode).toBe(409);
  });

  it('deployedUrl retargets the deploy to whichever bound slug its label names', async () => {
    await published();
    const res = httpRes();
    await deploySiteHandler(httpReq({ body: { siteId: 'my-own-site', html: '<h1>x</h1>', deployedUrl: 'https://fade-lab.vercel.app' } }), res);
    expect(res.statusCode).toBe(200);
    expect(vercel.live.get('fade-lab')).toBe('<h1>x</h1>');
    expect(vercel.live.has('my-own-site')).toBe(false);
  });

  it('a taken-down or revoked app site is refused with 402', async () => {
    const { otid } = await published();
    w.db.row(otid)!.revoked_at = new Date().toISOString();
    const res = httpRes();
    await deploySiteHandler(httpReq({ body: { siteId: 'fade-lab', html: '<h1>x</h1>' } }), res);
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

  it.fails('BUG: a phone publish landing between the strip read and write is overwritten by the older copy', async () => {
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
  });
});
