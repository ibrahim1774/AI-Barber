import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findSites, getSite, updateSite, republish, republishAll, rollback } from '../../lib/admin/sites.js';
import type { PublishOutcome } from '../../lib/publishSite.js';
import { DAY, NOW, P, fakes, iso, purchase, site, stored } from './fakeDeps.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('findSites', () => {
  const many = () => fakes({
    rows: [
      purchase('fade-lab'),
      purchase('elite-cuts', { original_transaction_id: '2000001234', revoked_at: iso(NOW - DAY) }),
      purchase('sharp-x7k2', { taken_down_at: iso(NOW - DAY) }),
    ],
    pending: {
      'fade-lab': stored('fade-lab', site(), { version: 2, editedBy: 'admin', editedAt: iso(NOW) }),
      'elite-cuts': stored('elite-cuts', site({ shopName: 'Elite Cuts', template: 'prime' })),
      'sharp-x7k2': stored('sharp-x7k2', site({ shopName: 'The Sharp Edge' })),
    },
  });

  it('empty query lists every app site with its join', async () => {
    const { deps } = many();
    const rows = await findSites('', deps);
    expect(rows.map((r) => r.slug).sort()).toEqual(['elite-cuts', 'fade-lab', 'sharp-x7k2']);
    const fade = rows.find((r) => r.slug === 'fade-lab')!;
    expect(fade).toMatchObject({
      shopName: 'Fade Lab', email: 'fade-lab@mail.test', deployedUrl: 'https://fade-lab.vercel.app', template: 'luxe',
      tier: 'store', status: 'live', active: true, version: 2, editedBy: 'admin', transactionId: 'otid-fade-lab',
    });
    expect(rows.find((r) => r.slug === 'elite-cuts')).toMatchObject({ status: 'revoked', active: false, template: 'prime', version: 0 });
    expect(rows.find((r) => r.slug === 'sharp-x7k2')).toMatchObject({ status: 'taken-down', active: false });
  });

  it('matches shop name (renamed shops too), slug, email and transaction id, case-insensitively', async () => {
    const { deps } = many();
    expect((await findSites('sharp edge', deps)).map((r) => r.slug)).toEqual(['sharp-x7k2']);
    expect((await findSites('FADE-LAB', deps)).map((r) => r.slug)).toEqual(['fade-lab']);
    expect((await findSites('elite-cuts@mail', deps)).map((r) => r.slug)).toEqual(['elite-cuts']);
    expect((await findSites('2000001234', deps)).map((r) => r.slug)).toEqual(['elite-cuts']);
    expect(await findSites('nobody', deps)).toEqual([]);
  });

  it('a bound row without a stored copy still lists (shopName null)', async () => {
    const { deps } = fakes({ rows: [purchase('ghost')], pending: {} });
    expect(await findSites('ghost', deps)).toMatchObject([{ slug: 'ghost', shopName: null, version: 0 }]);
  });
});

describe('getSite', () => {
  it('returns the stored siteData with real image URLs, version and history', async () => {
    const f = fakes();
    const r = await getSite('fade-lab', f.deps);
    expect(r.ok).toBe(true);
    expect(r.site!.siteData!.hero.imageUrl).toBe('https://img.example/hero.jpg');
    expect(r.site).toMatchObject({ slug: 'fade-lab', version: 3, editedBy: 'owner', deployedUrl: 'https://fade-lab.vercel.app', tier: 'store' });
    expect(r.site!.history).toEqual([]);
  });

  it('unknown slug → not-found', async () => {
    const f = fakes();
    expect(await getSite('nope', f.deps)).toMatchObject({ ok: false, error: 'not-found' });
  });
});

describe('updateSite', () => {
  it('patch: keeps history first, writes version + 1 by admin, deploys the same slug, audits', async () => {
    const f = fakes();
    const r = await updateSite('fade-lab', { patch: { phone: '555-9999', contact: { address: '2 Oak' } }, note: 'fix phone' }, f.deps);
    expect(r).toMatchObject({ ok: true, slug: 'fade-lab', fromVersion: 3, version: 4, deployed: true, deployedUrl: 'https://fade-lab.vercel.app' });
    // history copy is the previous stored copy, written before the overwrite
    expect(f.history.get('fade-lab/3')).toMatchObject({ version: 3, editedBy: 'owner' });
    const order = (fn: any) => fn.mock.invocationCallOrder[0];
    expect(order(f.store.writeHistory)).toBeLessThan(order(f.store.writePending));
    expect(order(f.store.writePending)).toBeLessThan(order(f.deps.publish));
    const now = f.pending.get('fade-lab')!;
    expect(now).toMatchObject({ version: 4, editedBy: 'admin', editedAt: iso(NOW), adminVersion: 4, note: 'fix phone', deployedUrl: 'https://fade-lab.vercel.app' });
    expect(now.siteData.phone).toBe('555-9999');
    expect(now.siteData.contact).toEqual({ address: '2 Oak', email: '' });
    // stored in the pending shape: image markers, URLs in the map
    expect(now.siteData.hero.imageUrl).toBe('uploaded');
    expect(now.imageUrlMap).toMatchObject({ hero: 'https://img.example/hero.jpg', gallery0: 'https://img.example/g0.jpg' });
    expect(f.deps.publish).toHaveBeenCalledWith('fade-lab', { force: true });
    expect(f.events).toEqual([expect.objectContaining({ action: 'update', slug: 'fade-lab', fromVersion: 3, toVersion: 4, note: 'fix phone' })]);
  });

  it('set: dotted paths', async () => {
    const f = fakes();
    const r = await updateSite('fade-lab', { set: { 'services.0.price': '$35', 'hero.heading': 'Fresh' } }, f.deps);
    expect(r.ok).toBe(true);
    expect(f.pending.get('fade-lab')!.siteData.services[0].price).toBe('$35');
    expect(f.pending.get('fade-lab')!.siteData.hero.heading).toBe('Fresh');
  });

  it('replace: the whole siteData; an unversioned copy is history v0 and becomes v1', async () => {
    const f = fakes({ pending: { 'fade-lab': stored('fade-lab') } });
    const r = await updateSite('fade-lab', { replace: site({ shopName: 'Fade Lab II', gallery: [] }) }, f.deps);
    expect(r).toMatchObject({ ok: true, fromVersion: 0, version: 1 });
    expect(f.history.has('fade-lab/0')).toBe(true);
    expect(f.pending.get('fade-lab')!.siteData.shopName).toBe('Fade Lab II');
    expect(f.pending.get('fade-lab')!.imageUrlMap).toEqual({ hero: 'https://img.example/hero.jpg' });
  });

  it('applies the tier link rules for the purchase product (AI Barber Book link needs bookings, Shop link needs store)', async () => {
    const f = fakes({ rows: [purchase('fade-lab', { product_id: `${P}hosting.monthly` })] });
    const r = await updateSite('fade-lab', {
      patch: { bookingUrl: 'https://aibarber.org/book/fade-lab', shopUrl: 'https://aibarber.org/shop/fade-lab' },
    }, f.deps);
    expect(r.ok).toBe(true);
    expect(r.strippedLinks).toEqual(['bookingUrl', 'shopUrl']);
    const sd: any = f.pending.get('fade-lab')!.siteData;
    expect(sd.bookingUrl).toBeUndefined();
    expect(sd.shopUrl).toBeUndefined();
    // a Booksy link is never touched
    await updateSite('fade-lab', { patch: { bookingUrl: 'https://booksy.com/x' } }, f.deps);
    expect((f.pending.get('fade-lab')!.siteData as any).bookingUrl).toBe('https://booksy.com/x');
  });

  it.each([
    ['missing shopName', { replace: { ...site(), shopName: '' } }],
    ['missing services', { set: { services: null } }],
    ['inline data: image', { set: { 'hero.imageUrl': 'data:image/png;base64,AAAA' } }],
    ['too large', { set: { 'about.description': ['x'.repeat(3 * 1024 * 1024 + 1)] } }],
    ['bad path', { set: { '__proto__.x': 1 } }],
    ['two operations', { patch: { phone: '1' }, set: { phone: '2' } }],
    ['no operation', {}],
  ])('rejects %s with bad-request; nothing written or deployed', async (_n, input) => {
    const f = fakes();
    const r = await updateSite('fade-lab', input as any, f.deps);
    expect(r).toMatchObject({ ok: false, error: 'bad-request' });
    expect(r.detail).toBeTruthy();
    expect(f.store.writeHistory).not.toHaveBeenCalled();
    expect(f.store.writePending).not.toHaveBeenCalled();
    expect(f.deps.publish).not.toHaveBeenCalled();
  });

  it('expectedVersion that is not the stored version → conflict (two admin tabs)', async () => {
    const f = fakes();
    const r = await updateSite('fade-lab', { patch: { phone: '1' }, expectedVersion: 2 }, f.deps);
    expect(r).toMatchObject({ ok: false, error: 'conflict', version: 3 });
    expect(f.store.writePending).not.toHaveBeenCalled();
  });

  it('a failed history write stops the edit: nothing overwritten', async () => {
    const f = fakes();
    (f.store.writeHistory as any).mockRejectedValueOnce(new Error('gcs down'));
    const r = await updateSite('fade-lab', { patch: { phone: '1' } }, f.deps);
    expect(r).toMatchObject({ ok: false, error: 'history-failed' });
    expect(f.store.writePending).not.toHaveBeenCalled();
    expect(f.deps.publish).not.toHaveBeenCalled();
  });

  it('taken-down or revoked site: the edit is saved (comes back on restore) but not deployed', async () => {
    for (const over of [{ taken_down_at: iso(NOW - DAY) }, { revoked_at: iso(NOW - DAY) }]) {
      const f = fakes({ rows: [purchase('fade-lab', over)] });
      const r = await updateSite('fade-lab', { patch: { phone: '1' } }, f.deps);
      expect(r).toMatchObject({ ok: true, version: 4, deployed: false, skipped: 'site-offline' });
      expect(f.pending.get('fade-lab')!.siteData.phone).toBe('1');
      expect(f.deps.publish).not.toHaveBeenCalled();
    }
  });

  it('deploy failure: content and version are saved, result says publish-failed', async () => {
    const f = fakes({ outcome: (s) => ({ ok: false, siteId: s, reason: 'deploy-failed', error: 'vercel 500' }) });
    const r = await updateSite('fade-lab', { patch: { phone: '1' } }, f.deps);
    expect(r).toMatchObject({ ok: false, error: 'publish-failed', version: 4, saved: true });
    expect(f.pending.get('fade-lab')!.version).toBe(4);
  });

  it('unknown slug → not-found; patch with no stored copy → no-copy', async () => {
    expect(await updateSite('nope', { patch: { phone: '1' } }, fakes().deps)).toMatchObject({ ok: false, error: 'not-found' });
    const f = fakes({ pending: {} });
    expect(await updateSite('fade-lab', { patch: { phone: '1' } }, f.deps)).toMatchObject({ ok: false, error: 'no-copy' });
    // replace works without a stored copy
    expect(await updateSite('fade-lab', { replace: site() }, f.deps)).toMatchObject({ ok: true, version: 1 });
  });

  it('audit failure never fails the edit', async () => {
    const f = fakes();
    (f.deps.audit as any).mockRejectedValueOnce(new Error('db down'));
    expect(await updateSite('fade-lab', { patch: { phone: '1' } }, f.deps)).toMatchObject({ ok: true });
  });
});

describe('rollback', () => {
  it('restores a history copy as a NEW higher version (never goes backwards)', async () => {
    const f = fakes();
    await updateSite('fade-lab', { patch: { phone: '555-1111' } }, f.deps); // 3 → 4
    await updateSite('fade-lab', { patch: { phone: '555-2222' } }, f.deps); // 4 → 5
    const r = await rollback('fade-lab', 3, f.deps);
    expect(r).toMatchObject({ ok: true, fromVersion: 5, version: 6 });
    const now = f.pending.get('fade-lab')!;
    expect(now.siteData.phone).toBe('555-0100');
    expect(now).toMatchObject({ editedBy: 'admin', note: 'rollback to v3' });
    expect(now.imageUrlMap!.hero).toBe('https://img.example/hero.jpg');
    expect(f.history.has('fade-lab/5')).toBe(true);
    expect(f.events.at(-1)).toMatchObject({ action: 'rollback', toVersion: 6 });
  });

  it('unknown version → no-history', async () => {
    expect(await rollback('fade-lab', 1, fakes().deps)).toMatchObject({ ok: false, error: 'no-history' });
  });
});

describe('republish', () => {
  it('redeploys the stored copy without changing content or version', async () => {
    const f = fakes();
    const r = await republish('fade-lab', f.deps);
    expect(r).toMatchObject({ ok: true, slug: 'fade-lab', deployedUrl: 'https://fade-lab.vercel.app' });
    expect(f.deps.publish).toHaveBeenCalledWith('fade-lab', { force: true });
    expect(f.store.writePending).not.toHaveBeenCalled();
    expect(f.pending.get('fade-lab')!.version).toBe(3);
  });

  it('strips links the current tier lost (same rule as a publish) before deploying', async () => {
    const f = fakes({
      rows: [purchase('fade-lab', { product_id: `${P}hosting.yearly` })],
      pending: { 'fade-lab': stored('fade-lab', site({ bookingUrl: 'https://aibarber.org/book/fade-lab' }), { version: 3 }) },
    });
    const r = await republish('fade-lab', f.deps);
    expect(r.ok).toBe(true);
    expect((f.pending.get('fade-lab')!.siteData as any).bookingUrl).toBeUndefined();
    expect(f.pending.get('fade-lab')!.version).toBe(3);
  });

  it('refuses taken-down and revoked sites; no copy → no-copy; publish failure → publish-failed', async () => {
    expect(await republish('fade-lab', fakes({ rows: [purchase('fade-lab', { taken_down_at: iso(NOW) })] }).deps))
      .toMatchObject({ ok: false, error: 'site-offline' });
    expect(await republish('fade-lab', fakes({ pending: {} }).deps)).toMatchObject({ ok: false, error: 'no-copy' });
    const f = fakes({ outcome: (s) => ({ ok: false, siteId: s, reason: 'deploy-failed', error: 'x' }) });
    expect(await republish('fade-lab', f.deps)).toMatchObject({ ok: false, error: 'publish-failed' });
  });
});

describe('republishAll', () => {
  const fleet = (outcome?: (s: string) => PublishOutcome) => fakes({
    rows: [
      purchase('c-site'), purchase('a-site'), purchase('b-site'),
      purchase('d-revoked', { revoked_at: iso(NOW) }),
      purchase('e-down', { taken_down_at: iso(NOW) }),
      purchase('f-unpublished', { published_at: null }),
      purchase('g-nocopy'),
    ],
    pending: {
      'a-site': stored('a-site', site(), { version: 1 }), 'b-site': stored('b-site'), 'c-site': stored('c-site'),
      'd-revoked': stored('d-revoked'), 'e-down': stored('e-down'),
    },
    outcome,
  });

  it('dry run lists what would be republished and what is skipped, and deploys nothing', async () => {
    const f = fleet();
    const r = await republishAll({ dryRun: true }, f.deps);
    expect(r.dryRun).toBe(true);
    expect(r.eligible).toEqual(['a-site', 'b-site', 'c-site']);
    expect(r.skipped).toEqual([
      { slug: 'd-revoked', reason: 'revoked' },
      { slug: 'e-down', reason: 'taken-down' },
      { slug: 'f-unpublished', reason: 'unpublished' },
      { slug: 'g-nocopy', reason: 'no-copy' },
    ]);
    expect(f.deps.publish).not.toHaveBeenCalled();
    expect(f.store.writeRun).not.toHaveBeenCalled();
  });

  it('batched + resumable: each call does `limit` sites of the same run, in slug order, until done', async () => {
    const f = fleet();
    const r1 = await republishAll({ dryRun: false, runId: 'run-1', limit: 2 }, f.deps);
    expect(r1.results.map((x) => x.slug)).toEqual(['a-site', 'b-site']);
    expect(r1).toMatchObject({ runId: 'run-1', remaining: 1, done: false });
    const r2 = await republishAll({ dryRun: false, runId: 'run-1', limit: 2 }, f.deps);
    expect(r2.results.map((x) => x.slug)).toEqual(['c-site']);
    expect(r2).toMatchObject({ remaining: 0, done: true });
    expect(r2.totals).toEqual({ ok: 3, failed: 0 });
    // idempotent: the finished run deploys nothing more
    const r3 = await republishAll({ dryRun: false, runId: 'run-1', limit: 2 }, f.deps);
    expect(r3.results).toEqual([]);
    expect(r3.done).toBe(true);
    expect(f.deps.publish).toHaveBeenCalledTimes(3);
    // content and versions untouched
    expect(f.pending.get('a-site')!.version).toBe(1);
  });

  it('a failed site is recorded once and not retried within the run; others continue', async () => {
    const f = fleet((s) => (s === 'b-site'
      ? { ok: false, siteId: s, reason: 'deploy-failed', error: 'boom' }
      : { ok: true, siteId: s, deployedUrl: `https://${s}.vercel.app` }));
    const r = await republishAll({ dryRun: false, runId: 'run-2', limit: 10 }, f.deps);
    expect(r.results).toEqual([
      expect.objectContaining({ slug: 'a-site', ok: true }),
      expect.objectContaining({ slug: 'b-site', ok: false, error: 'publish-failed' }),
      expect.objectContaining({ slug: 'c-site', ok: true }),
    ]);
    expect(r.totals).toEqual({ ok: 2, failed: 1 });
    expect(r.failed).toEqual([{ slug: 'b-site', error: 'publish-failed' }]);
    expect(r.done).toBe(true);
    const again = await republishAll({ dryRun: false, runId: 'run-2', limit: 10 }, f.deps);
    expect(again.results).toEqual([]);
  });

  it('stops starting new sites when the time budget is spent (the rest stay for the next call)', async () => {
    const f = fleet();
    (f.deps.publish as any).mockImplementation(async (s: string) => { f.tick(60_000); return { ok: true, siteId: s, deployedUrl: 'u' }; });
    const r = await republishAll({ dryRun: false, runId: 'run-3', limit: 10, budgetMs: 100_000, concurrency: 1 }, f.deps);
    expect(r.results.map((x) => x.slug)).toEqual(['a-site', 'b-site']);
    expect(r).toMatchObject({ remaining: 1, done: false });
  });

  it('progress is saved after every site, so a killed function resumes where it stopped', async () => {
    const f = fleet();
    await republishAll({ dryRun: false, runId: 'run-4', limit: 10, concurrency: 1 }, f.deps);
    const saved = (f.store.writeRun as any).mock.calls.map((c: any[]) => c[1].done);
    expect(saved).toEqual([['a-site'], ['a-site', 'b-site'], ['a-site', 'b-site', 'c-site']]);
  });

  it('an exception on one site is recorded as failed and the batch goes on', async () => {
    const f = fleet();
    (f.store.readPending as any).mockImplementation(async (s: string) => {
      if (s === 'b-site') throw new Error('gcs down');
      return f.pending.get(s) ?? null;
    });
    const r = await republishAll({ dryRun: false, runId: 'run-5', limit: 10, concurrency: 1 }, f.deps);
    expect(r.results.map((x) => [x.slug, x.ok])).toEqual([['a-site', true], ['b-site', false], ['c-site', true]]);
    expect(r.failed).toEqual([{ slug: 'b-site', error: 'exception' }]);
  });

  it('a real run needs a runId', async () => {
    await expect(republishAll({ dryRun: false } as any, fleet().deps)).rejects.toThrow(/runId/);
  });
});
