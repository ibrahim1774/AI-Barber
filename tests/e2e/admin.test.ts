// E2E: admin site edits through the REAL /api/admin/sites handler and core, over the real GCS-backed
// site store (in-memory GCS with write-once history preconditions), the real publishSite, and the
// phone publish flow racing it. Plus /api/save-pending-site's refusal of app slugs.
vi.mock('@google-cloud/storage', async () => (await import('./harness/gcs.js')).storageModule);
vi.mock('../../lib/deploySite.js', async () => (await import('./harness/vercel.js')).deploySiteModule);
vi.mock('../../lib/siteSubpages.js', async (orig) => (await import('./harness/subpages.js')).subpagesModule(await orig()));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AI_BOOK, AI_SHOP, DAY, httpReq, httpRes, normHtml, resetBoundaries, siteData, siteWorld, type SiteWorld } from './harness/world.js';
import { PRODUCTS } from './harness/apple.js';
import { gcs, gcsJson, pendingOf, putJson } from './harness/gcs.js';
import { deferred, deploysOf, vercel } from './harness/vercel.js';
import { readPendingSite, renderPending } from '../../lib/publishSite.js';
import { savePendingSite } from '../../api/save-pending-site.js';

let w: SiteWorld;
let h: ReturnType<SiteWorld['adminHandler']>;
beforeEach(() => {
  resetBoundaries();
  w = siteWorld();
  h = w.adminHandler();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function call(req: { method?: string; body?: unknown; query?: Record<string, string>; token?: string | null; bodyThrows?: boolean }, handler = h) {
  const res = httpRes();
  const headers: Record<string, string> = req.token === null ? {} : { authorization: `Bearer ${req.token ?? 'admin-token'}` };
  await handler(httpReq({ method: req.method ?? 'POST', body: req.body, query: req.query, headers, bodyThrows: req.bodyThrows }), res);
  return res;
}

async function app(product: string = PRODUCTS.storeMonthly, sd = siteData()) {
  const p = w.apple.buy(product);
  const r = await w.publish(p.transactionId, sd);
  expect(r.status).toBe(200);
  return p;
}

// ---------------------------------------------------------------------------
describe('edit / replace / rollback through the handler', () => {
  it('find and get: by shop name, slug, email and transaction id; siteData has real image URLs', async () => {
    const { otid } = await app();
    await w.repo.setUser(otid, 'u1');
    w.emails.set('u1', 'mike@example.com');
    for (const q of ['fade', 'FADE-LAB', 'mike@', otid]) {
      const r = await call({ method: 'GET', query: { q } });
      expect(r.body.sites.map((s: any) => s.slug)).toEqual(['fade-lab']);
    }
    const one = await call({ method: 'GET', query: { slug: 'fade-lab' } });
    expect(one.body.site).toMatchObject({ slug: 'fade-lab', version: 1, editedBy: 'owner', tier: 'store', status: 'live', email: 'mike@example.com' });
    expect(one.body.site.siteData.hero.imageUrl).toBe('https://img.example/hero.jpg');
    expect((await call({ method: 'GET', query: { slug: 'nope' } })).statusCode).toBe(404);
  });

  it('update (set) → v2 by admin, history v1 kept, deployed to the same slug; the phone with baseVersion 1 gets 409 with the admin copy', async () => {
    const { transactionId } = await app();
    const r = await call({ body: { action: 'update', slug: 'fade-lab', set: { 'services.0.price': '$35' }, note: 'price change' } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ ok: true, version: 2, fromVersion: 1, deployed: true, deployedUrl: 'https://fade-lab.vercel.app' });
    expect(pendingOf('fade-lab')).toMatchObject({ version: 2, editedBy: 'admin', adminVersion: 2, note: 'price change' });
    expect(gcsJson('pending-sites-history/fade-lab/1.json').data.version).toBe(1);
    expect(normHtml(vercel.live.get('fade-lab'))).toBe(normHtml(renderPending(pendingOf('fade-lab'))));
    expect(w.audits.at(-1)).toMatchObject({ action: 'update', slug: 'fade-lab', ok: true, by: 'ibrahim3709@gmail.com', fromVersion: 1, toVersion: 2 });

    const stale = await w.publish(transactionId, siteData(), { baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect((stale.body as any).site).toMatchObject({ version: 2, editedBy: 'admin' });
    expect((stale.body as any).site.siteData.services[0].price).toBe('$35');
    // No baseVersion (app from before versioning) over an admin copy: also 409.
    expect((await w.publish(transactionId, siteData())).status).toBe(409);
    // Adopted: publishes, and the carried adminVersion keeps refusing stale phones.
    expect((await w.publish(transactionId, siteData(), { baseVersion: 2 })).status).toBe(200);
    expect((await w.publish(transactionId, siteData(), { baseVersion: 1 })).status).toBe(409);
    expect((await w.publish(transactionId, siteData(), { baseVersion: 3 })).status).toBe(200);
  });

  it('no baseVersion over an OWNER copy that adopted an admin edit is accepted (documented rule)', async () => {
    const { transactionId } = await app();
    await call({ body: { action: 'update', slug: 'fade-lab', set: { phone: '1' } } });
    await w.publish(transactionId, siteData({ phone: '1' }), { baseVersion: 2 });
    const legacy = await w.publish(transactionId, siteData({ phone: 'legacy' }));
    expect(legacy.status).toBe(200);
    expect(pendingOf('fade-lab')).toMatchObject({ version: 4, adminVersion: 2 });
  });

  it('a Website-plan purchase: admin replace with Book/Shop links stores and deploys without them (strippedLinks)', async () => {
    await app(PRODUCTS.websiteYearly);
    const r = await call({ body: { action: 'replace', slug: 'fade-lab', siteData: siteData({ bookingUrl: AI_BOOK, shopUrl: AI_SHOP } as any) } });
    expect(r.body).toMatchObject({ ok: true, strippedLinks: ['bookingUrl', 'shopUrl'] });
    expect(pendingOf('fade-lab').siteData).not.toHaveProperty('shopUrl');
  });

  it('rollback brings back an older copy as a NEW higher version; versions never go backwards', async () => {
    await app();
    await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'Two' } } });
    await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'Three' } } });
    const r = await call({ body: { action: 'rollback', slug: 'fade-lab', version: '1' } });
    expect(r.body).toMatchObject({ ok: true, version: 4, fromVersion: 3 });
    expect(pendingOf('fade-lab')).toMatchObject({ version: 4, note: 'rollback to v1' });
    expect(pendingOf('fade-lab').siteData.area).toBe('Austin');
    const hist = (await call({ method: 'GET', query: { slug: 'fade-lab' } })).body.site.history.map((x: any) => x.id);
    expect(hist).toEqual(['3', '2', '1']);
    expect((await call({ body: { action: 'rollback', slug: 'fade-lab', version: '9' } })).statusCode).toBe(404);
    expect((await call({ body: { action: 'rollback', slug: 'fade-lab', version: '../1' } })).statusCode).toBe(400);
    expect((await call({ body: { action: 'rollback', slug: 'fade-lab', version: '2', expectedVersion: 3 } })).statusCode).toBe(409);
  });

  it('history collision: the same version number kept twice with different content goes to "{v}-{ms}"; a retried identical edit reuses it', async () => {
    await app();
    await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'A' } } }); // history/1
    // The stored copy is put back to version 1 with other content (e.g. a racing writer reused the number).
    const cur = pendingOf('fade-lab');
    putJson('pending-sites/fade-lab.json', { siteId: 'fade-lab', savedAt: 0, data: { ...cur, version: 1, siteData: { ...cur.siteData, area: 'Other v1' } } });
    const r = await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'B' } } });
    expect(r.body).toMatchObject({ ok: true, version: 2 });
    const ids = [...gcs.objects.keys()].filter((k) => k.startsWith('pending-sites-history/fade-lab/')).sort();
    expect(ids).toHaveLength(2);
    expect(ids.some((k) => /\/1-\d+\.json$/.test(k))).toBe(true);
    const unique = ids.find((k) => /\/1-\d+\.json$/.test(k))!.match(/\/(1-\d+)\.json$/)![1];
    expect((await call({ body: { action: 'rollback', slug: 'fade-lab', version: unique } })).body).toMatchObject({ ok: true, version: 3 });
    expect(pendingOf('fade-lab').siteData.area).toBe('Other v1');
    // Write-once: history/1 still holds the first copy.
    expect(gcsJson('pending-sites-history/fade-lab/1.json').data.siteData.area).toBe('Austin');
  });

  it('a failed history write overwrites nothing (503 history-failed)', async () => {
    await app();
    gcs.failSave.set('pending-sites-history/fade-lab/1.json', new Error('gcs 500'));
    const r = await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'X' } } });
    expect(r).toMatchObject({ statusCode: 503, body: { error: 'history-failed' } });
    expect(pendingOf('fade-lab')).toMatchObject({ version: 1 });
  });

  it('expectedVersion as an integer is honoured (409 conflict on mismatch)', async () => {
    await app();
    const r = await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'X' }, expectedVersion: 7 } });
    expect(r).toMatchObject({ statusCode: 409, body: { error: 'conflict', version: 1 } });
  });

  it('M2 (fixed): expectedVersion sent as a string ("1") is refused, never a blind overwrite', async () => {
    await app();
    await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'Newer' } } }); // v2
    const r = await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'Stale tab' }, expectedVersion: '1' } });
    expect([400, 409]).toContain(r.statusCode);
  });

  it.each([['1'], [1.5], [-1], [true], [{}]])('setup (was: the write goes through as v3): expectedVersion %j is 400 and nothing is written', async (ev) => {
    await app();
    await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'Newer' } } });
    const r = await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'Stale tab' }, expectedVersion: ev } });
    expect(r).toMatchObject({ statusCode: 400, body: { error: 'bad-request' } });
    expect(pendingOf('fade-lab')).toMatchObject({ version: 2 });
    expect(pendingOf('fade-lab').siteData.area).toBe('Newer');
  });
});

// ---------------------------------------------------------------------------
describe('admin edits during Apple billing grace', () => {
  it.fails('BUG (minor): a site live in billing grace (stored expiry passed, Apple status 4) is treated as "expired": the edit is stored but not deployed', async () => {
    const { otid } = await app();
    w.clock.advance(31 * DAY);
    w.apple.setStatus(otid, 4);
    expect((await w.sweep()).stillActive).toEqual(['fade-lab']); // the sweep keeps it up
    const r = await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'Grace edit' } } });
    expect(r.body).toMatchObject({ ok: true, deployed: true });
  });

  it('setup: the same edit answers skipped site-offline (expired) while the old content stays live', async () => {
    const { otid } = await app();
    w.clock.advance(31 * DAY);
    w.apple.setStatus(otid, 4);
    await w.sweep();
    const r = await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'Grace edit' } } });
    expect(r.body).toMatchObject({ ok: true, deployed: false, skipped: 'site-offline', offline: 'expired' });
    expect(vercel.live.get('fade-lab')).not.toContain('Grace edit');
  });
});

// ---------------------------------------------------------------------------
describe('malformed admin input never writes', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['patch and set together', { action: 'update', slug: 'fade-lab', patch: { area: 'x' }, set: { area: 'y' } }],
    ['nothing to change', { action: 'update', slug: 'fade-lab' }],
    ['__proto__ key', { action: 'update', slug: 'fade-lab', patch: JSON.parse('{"__proto__":{"polluted":true}}') }],
    ['constructor path', { action: 'update', slug: 'fade-lab', set: { 'constructor.prototype.x': 1 } }],
    ['index past the end', { action: 'update', slug: 'fade-lab', set: { 'services.5.price': '$1' } }],
    ['list as object', { action: 'update', slug: 'fade-lab', set: { 'services.price': '$1' } }],
    ['remove shopName', { action: 'update', slug: 'fade-lab', patch: { shopName: null } }],
    ['about.description as a string', { action: 'update', slug: 'fade-lab', set: { 'about.description': 'one' } }],
    ['contact removed', { action: 'update', slug: 'fade-lab', patch: { contact: null } }],
    ['service without title', { action: 'update', slug: 'fade-lab', set: { 'services.0': { price: '$1' } } }],
    ['inline data: image', { action: 'update', slug: 'fade-lab', set: { 'hero.imageUrl': 'data:image/png;base64,AAAA' } }],
    ['replace null', { action: 'replace', slug: 'fade-lab', siteData: null }],
    ['replace array', { action: 'replace', slug: 'fade-lab', siteData: [] }],
    ['replace > 3 MB', { action: 'replace', slug: 'fade-lab', siteData: siteData({ area: 'x'.repeat(3 * 1024 * 1024) }) }],
    // (A title-less euphoria hero was unrenderable when this suite was written; the honest-sites
    // renderer work made it render, so it is no longer a bad input.)
    ['unknown action', { action: 'delete', slug: 'fade-lab' }],
    ['no slug', { action: 'update', set: { area: 'x' } }],
    ['slug wrong type', { action: 'update', slug: 42, set: { area: 'x' } }],
    ['republish-all real run without runId', { action: 'republish-all', dryRun: false }],
    ['republish-all bad runId', { action: 'republish-all', dryRun: false, runId: '../x' }],
    ['republish-all limit 0', { action: 'republish-all', limit: 0 }],
    ['republish-all limit "5"', { action: 'republish-all', limit: '5' }],
  ];
  it.each(bad)('%s → 400, stored copy untouched', async (_name, body) => {
    await app();
    const before = gcsJson('pending-sites/fade-lab.json');
    const r = await call({ body });
    expect(r.statusCode).toBe(400);
    expect(gcsJson('pending-sites/fade-lab.json')).toEqual(before);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('non-JSON, array and missing bodies are 400; PUT is 405; unknown slug is 404', async () => {
    await app();
    expect((await call({ bodyThrows: true })).statusCode).toBe(400);
    expect((await call({ body: '{not json' })).statusCode).toBe(400);
    expect((await call({ body: [] })).statusCode).toBe(400);
    expect((await call({ body: undefined })).statusCode).toBe(400);
    expect((await call({ method: 'PUT', body: {} })).statusCode).toBe(405);
    expect((await call({ body: { action: 'update', slug: 'nobody', set: { area: 'x' } } })).statusCode).toBe(404);
  });

  it('auth: no token 401, a valid non-admin user 403, a forged token 403 — and nothing is read', async () => {
    await app();
    gcs.log.length = 0;
    expect((await call({ method: 'GET', query: { q: '' }, token: null })).statusCode).toBe(401);
    expect((await call({ method: 'GET', query: { q: '' }, token: 'user-token' })).statusCode).toBe(403);
    expect((await call({ body: { action: 'republish-all' }, token: 'forged.jwt.value' })).statusCode).toBe(403);
    expect(gcs.log).toEqual([]);
  });

  it('rate limits: 30 writes and 120 reads a minute per admin, then 429', async () => {
    await app();
    for (let i = 0; i < 30; i++) expect((await call({ body: { action: 'republish-all' } })).statusCode).toBe(200);
    expect((await call({ body: { action: 'republish-all' } })).statusCode).toBe(429);
    for (let i = 0; i < 120; i++) await call({ method: 'GET', query: { slug: 'fade-lab' } });
    expect((await call({ method: 'GET', query: { slug: 'fade-lab' } })).statusCode).toBe(429);
  });

  it('a note longer than 500 characters is cut, not refused', async () => {
    await app();
    await call({ body: { action: 'update', slug: 'fade-lab', set: { area: 'x' }, note: 'n'.repeat(2000) } });
    expect(pendingOf('fade-lab').note).toHaveLength(500);
  });
});

// ---------------------------------------------------------------------------
describe('republish-all', () => {
  async function fleet() {
    const a = await app(PRODUCTS.storeMonthly, siteData({ shopName: 'Alpha', shopUrl: AI_SHOP } as any));
    const b = await app(PRODUCTS.websiteMonthly, siteData({ shopName: 'Bravo' }));
    const c = await app(PRODUCTS.bookingsMonthly, siteData({ shopName: 'Charlie' }));
    const d = await app(PRODUCTS.storeYearly, siteData({ shopName: 'Delta' }));
    w.db.row(d.otid)!.revoked_at = new Date().toISOString();
    // Bravo's stored copy still carries a Shop link from an older, higher plan.
    const bravo = pendingOf('bravo');
    putJson('pending-sites/bravo.json', { siteId: 'bravo', savedAt: 0, data: { ...bravo, siteData: { ...bravo.siteData, shopUrl: AI_SHOP } } });
    return { a, b, c, d };
  }

  it('dry run lists eligible, skipped (revoked) and links a deploy would strip; deploys nothing', async () => {
    await fleet();
    vercel.deploys.length = 0;
    const r = await call({ body: { action: 'republish-all' } });
    expect(r.body).toMatchObject({ ok: true, dryRun: true, eligible: ['alpha', 'bravo', 'charlie'], skipped: [{ slug: 'delta', reason: 'revoked' }], wouldStrip: [{ slug: 'bravo', links: ['shopUrl'] }] });
    expect(vercel.deploys).toHaveLength(0);
  });

  it('a real run in batches is resumable by runId, never redoes a site, and never changes stored content', async () => {
    await fleet();
    const before = Object.fromEntries(['alpha', 'bravo', 'charlie'].map((s) => [s, JSON.stringify(pendingOf(s))]));
    vercel.deploys.length = 0;
    vercel.fail = (dep) => (dep.siteId === 'charlie' ? new Error('vercel 500') : null);
    const r1 = await call({ body: { action: 'republish-all', dryRun: false, runId: 'run-1', limit: 2 } });
    expect(r1.body).toMatchObject({ done: false, remaining: 1, totals: { ok: 2, failed: 0 } });
    const r2 = await call({ body: { action: 'republish-all', dryRun: false, runId: 'run-1', limit: 2 } });
    expect(r2.body).toMatchObject({ done: true, remaining: 0, totals: { ok: 2, failed: 1 }, failed: [{ slug: 'charlie', error: 'publish-failed' }] });
    const r3 = await call({ body: { action: 'republish-all', dryRun: false, runId: 'run-1' } });
    expect(r3.body).toMatchObject({ done: true, results: [] });
    expect(vercel.deploys.map((d) => d.siteId).sort()).toEqual(['alpha', 'bravo', 'charlie']);
    for (const s of ['alpha', 'bravo', 'charlie']) expect(JSON.stringify(pendingOf(s))).toBe(before[s]);
    // Bravo's deploy left out the Shop link its Website plan doesn't cover; the stored copy still has it.
    expect(vercel.live.get('bravo')).not.toContain('/shop/fade-lab');
    expect(pendingOf('bravo').siteData.shopUrl).toBe(AI_SHOP);
  });

  it('I2 (fixed): a republish snapshot that finishes after a newer phone publish is followed by a redeploy of the newer copy', async () => {
    const { transactionId } = await app();
    const hold = deferred();
    vercel.gate = async (d) => { if (d.seq === 2) await hold.promise; };
    const run = call({ body: { action: 'republish', slug: 'fade-lab' } });
    await vi.waitFor(() => expect(deploysOf('fade-lab')).toHaveLength(2));
    const phone = await w.publish(transactionId, siteData({ area: 'Phone v2' }), { baseVersion: 1 });
    expect(phone.status).toBe(200);
    hold.resolve();
    await run;
    expect(normHtml(vercel.live.get('fade-lab'))).toBe(normHtml(renderPending(pendingOf('fade-lab'))));
  });

  it('setup (was: all claim version 2): 5 parallel admin edits all answer 200 ok with versions 2..6, each in history', async () => {
    await app();
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => call({ body: { action: 'update', slug: 'fade-lab', set: { 'services.0.subtitle': `edit ${i}` } } })));
    expect(rs.every((r) => r.statusCode === 200 && r.body.ok === true)).toBe(true);
    expect(rs.map((r) => r.body.version).sort()).toEqual([2, 3, 4, 5, 6]);
    expect((await w.adminDeps().store.listHistory('fade-lab')).map((h) => h.id).sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('I1: a parallel edit with expectedVersion that loses the race is a conflict, not an overwrite', async () => {
    await app();
    const rs = await Promise.all(Array.from({ length: 3 }, (_, i) => call({ body: { action: 'update', slug: 'fade-lab', expectedVersion: 1, set: { 'services.0.subtitle': `edit ${i}` } } })));
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.body.error === 'conflict')).toHaveLength(2);
    expect(pendingOf('fade-lab').version).toBe(2);
  });

  it('I1 (fixed): parallel admin edits each land on the newest copy; none vanishes', async () => {
    await app();
    await Promise.all(Array.from({ length: 5 }, (_, i) => call({ body: { action: 'update', slug: 'fade-lab', set: { 'services.0.subtitle': `edit ${i}` } } })));
    expect(pendingOf('fade-lab').version).toBe(6);
  });
});

// ---------------------------------------------------------------------------
describe('/api/save-pending-site never touches an app site', () => {
  const run = async (method: string, body: unknown, isAppSlug = (s: string) => w.repo.findBySlug(s).then((r) => r != null)) => {
    const res = httpRes();
    // isPublished (the deployedUrl stamp check) arrived with the deploy-auth hotfix.
    await savePendingSite(httpReq({ method, body }), res, { isAppSlug, isPublished: async (s) => !!(await readPendingSite(s))?.deployedUrl });
    return res;
  };

  it('POST and DELETE for a bound slug are refused 409 (any letter case); the stored copy is untouched', async () => {
    await app();
    const before = gcsJson('pending-sites/fade-lab.json');
    for (const siteId of ['fade-lab', 'FADE-LAB', 'Fade-Lab']) {
      expect((await run('POST', { siteId, data: siteData({ shopName: 'Hijack' }) })).statusCode).toBe(409);
      expect((await run('DELETE', { siteId })).statusCode).toBe(409);
    }
    expect(gcsJson('pending-sites/fade-lab.json')).toEqual(before);
  });

  it('a lookup failure refuses (503) rather than writing', async () => {
    const r = await run('POST', { siteId: 'web-shop', data: {} }, async () => { throw new Error('db down'); });
    expect(r.statusCode).toBe(503);
    expect(gcs.objects.has('pending-sites/web-shop.json')).toBe(false);
  });

  it('a web site saves, with the server-only version fields dropped; > 5 MB is 413; bad input 400', async () => {
    const r = await run('POST', { siteId: 'web-shop', data: { siteData: siteData(), version: 99, editedBy: 'admin', adminVersion: 99, note: 'x' } });
    expect(r.statusCode).toBe(200);
    expect(gcsJson('pending-sites/web-shop.json').data).not.toHaveProperty('version');
    expect(gcsJson('pending-sites/web-shop.json').data).not.toHaveProperty('adminVersion');
    expect((await run('POST', { siteId: 'web-shop', data: { blob: 'x'.repeat(5 * 1024 * 1024 + 10) } })).statusCode).toBe(413);
    expect((await run('POST', { siteId: '../../etc', data: {} })).statusCode).toBe(200);
    expect(gcs.objects.has('pending-sites/etc.json')).toBe(true); // sanitized into the prefix
    expect((await run('POST', { siteId: 42, data: {} })).statusCode).toBe(400);
    expect((await run('POST', { siteId: '!!!', data: {} })).statusCode).toBe(400);
    expect((await run('POST', { siteId: 'web-shop', data: [] })).statusCode).toBe(400);
    expect((await run('GET', {})).statusCode).toBe(405);
  });

  it('look-alike ids ("fade_lab", "fade-lab-") canonicalise to the app slug and are refused; the app copy is untouched', async () => {
    // Since the deploy-auth hotfix every key is the canonical slugify(), so the look-alikes are
    // the app slug itself (before, they were stored under their own keys).
    await app();
    const before = gcsJson('pending-sites/fade-lab.json');
    expect((await run('POST', { siteId: 'fade_lab', data: { siteData: siteData({ shopName: 'X' }) } })).statusCode).toBe(409);
    expect((await run('POST', { siteId: 'fade-lab-', data: { siteData: siteData({ shopName: 'X' }) } })).statusCode).toBe(409);
    expect(gcsJson('pending-sites/fade-lab.json')).toEqual(before);
  });
});
