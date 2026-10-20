import { describe, it, expect, vi } from 'vitest';
import {
  buildImageUrlMap,
  toPendingSiteData,
  runIosPublish,
  runIosSiteLookup,
  type PublishDeps,
} from '../../lib/ios/publishFlow.js';
import { VerifyFailure, type VerifiedTx } from '../../lib/ios/appleVerify.js';
import { makeIsTaken, vercelProjectExists } from '../../lib/ios/slug.js';
import type { PurchaseRow, PurchasesRepo } from '../../lib/ios/purchases.js';
import type { PendingSite, PublishOutcome } from '../../lib/publishSite.js';
import type { WebsiteData } from '../../types.js';

const NOW = 1_800_000_000_000;
const OTID = 'o-999'; // deliberately different from the transactionId the app sends
const USER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';

function site(over: Partial<WebsiteData> = {}): WebsiteData {
  return {
    shopName: 'Fresh Cuts',
    area: 'Brooklyn',
    phone: '555-0100',
    hero: { heading: 'H', tagline: 'T', imageUrl: 'https://img.example/hero.jpg' },
    about: { heading: 'A', description: ['d'], imageUrl: '' },
    services: [{ name: 'Fade', price: '$30', imageUrl: 'https://img.example/svc.jpg' } as any],
    gallery: ['https://img.example/g0.jpg', '', 'http://img.example/g2.jpg'],
    craftImages: ['https://img.example/c0.jpg'],
    staff: [{ name: 'Sam', photo: 'https://img.example/s0.jpg' }, { name: 'Lee', photo: '' }],
    ...over,
  } as WebsiteData;
}

function tx(over: Partial<VerifiedTx> = {}): VerifiedTx {
  return {
    originalTransactionId: OTID,
    transactionId: 't-123',
    productId: 'com.ibrahim1774.aibarber.hosting.monthly',
    environment: 'Production',
    expiresAt: NOW + 86_400_000,
    revoked: false,
    ...over,
  };
}

function row(over: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    original_transaction_id: OTID, product_id: 'com.ibrahim1774.aibarber.hosting.monthly', environment: 'Production',
    site_slug: null, user_id: null, expires_at: null, revoked_at: null, last_notification: null, published_at: null,
    ...over,
  };
}

interface FakeOpts {
  verified?: VerifiedTx | VerifyFailure | Error;
  existing?: PurchaseRow | null;
  taken?: string[];
  outcome?: (slug: string) => PublishOutcome;
  /** Simulates a concurrent request winning the bind with this slug. */
  bindLoses?: string | null;
  pending?: Record<string, PendingSite>;
}

function fakes(o: FakeOpts = {}) {
  const rows = new Map<string, PurchaseRow>();
  if (o.existing) rows.set(o.existing.original_transaction_id, { ...o.existing });
  const pending = new Map<string, PendingSite>(Object.entries(o.pending || {}));

  const repo: PurchasesRepo = {
    get: vi.fn(async (otid: string) => (rows.has(otid) ? { ...rows.get(otid)! } : null)),
    upsertVerified: vi.fn(async (t: VerifiedTx) => {
      const prev = rows.get(t.originalTransactionId) || row({ original_transaction_id: t.originalTransactionId });
      const next = { ...prev, product_id: t.productId, environment: t.environment };
      rows.set(t.originalTransactionId, next);
      return { ...next };
    }),
    bindSlug: vi.fn(async (otid: string, slug: string) => {
      const r = rows.get(otid)!;
      if (o.bindLoses !== undefined) {
        if (o.bindLoses) r.site_slug = o.bindLoses;
        return false;
      }
      if (r.site_slug) return false;
      r.site_slug = slug;
      return true;
    }),
    slugTaken: vi.fn(async () => false),
    markPublished: vi.fn(async (otid: string) => { rows.get(otid)!.published_at = new Date(NOW).toISOString(); }),
    setUser: vi.fn(async (otid: string, userId: string) => { rows.get(otid)!.user_id = userId; }),
    applyNotification: vi.fn(async () => {}),
    unpublishedBound: vi.fn(async () => []),
  };

  const deps: PublishDeps = {
    verify: vi.fn(async () => {
      const v = o.verified ?? tx();
      if (v instanceof Error) throw v;
      return v;
    }),
    repo,
    isTaken: vi.fn(async (s: string) => (o.taken || []).includes(s)),
    writePending: vi.fn(async (slug: string, p: PendingSite) => { pending.set(slug, p); }),
    publish: vi.fn(async (slug: string) =>
      o.outcome ? o.outcome(slug) : { ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app`, alreadyLive: false }),
    readPending: vi.fn(async (slug: string) => pending.get(slug) ?? null),
    now: () => NOW,
  };
  return { deps, repo, rows, pending };
}

const input = (over: Record<string, unknown> = {}) => ({ transactionId: 't-123', siteData: site(), ...over }) as any;

describe('runIosPublish', () => {
  it('first publish binds a new slug and publishes without force', async () => {
    const { deps, repo, rows, pending } = fakes();
    const r = await runIosPublish(input(), deps);
    expect(r).toEqual({ status: 200, body: { siteId: 'fresh-cuts', deployedUrl: 'https://fresh-cuts.vercel.app', republished: false } });
    expect(deps.verify).toHaveBeenCalledWith('t-123');
    expect(repo.bindSlug).toHaveBeenCalledWith(OTID, 'fresh-cuts');
    expect(deps.publish).toHaveBeenCalledWith('fresh-cuts', { force: false });
    expect(repo.markPublished).toHaveBeenCalledWith(OTID);
    expect(rows.get(OTID)!.site_slug).toBe('fresh-cuts');
    const p = pending.get('fresh-cuts')!;
    expect(p.siteId).toBe('fresh-cuts');
    expect(p.imageUrlMap!.hero).toBe('https://img.example/hero.jpg');
    expect(p.siteData.hero.imageUrl).toBe('uploaded');
    expect(p.siteData.services[0].imageUrl).toBe('');
  });

  it('does not reuse a slug owned by the web', async () => {
    const { deps } = fakes({ taken: ['fresh-cuts'] });
    const r: any = await runIosPublish(input(), deps);
    expect(r.status).toBe(200);
    expect(r.body.siteId).toMatch(/^fresh-cuts-[a-z0-9]{4}$/);
    const written = (deps.writePending as any).mock.calls.map((c: any[]) => c[0]);
    expect(written).not.toContain('fresh-cuts');
    expect((deps.publish as any).mock.calls[0][0]).toBe(r.body.siteId);
  });

  it('republish after rename keeps the bound slug and forces a deploy', async () => {
    const { deps, repo } = fakes({ existing: row({ site_slug: 'fresh-cuts-ab12', published_at: '2026-10-01T00:00:00Z' }) });
    const r = await runIosPublish(input({ siteData: site({ shopName: 'Elite Fades' }) }), deps);
    expect(deps.publish).toHaveBeenCalledWith('fresh-cuts-ab12', { force: true });
    expect(deps.writePending).toHaveBeenCalledWith('fresh-cuts-ab12', expect.anything());
    expect(repo.bindSlug).not.toHaveBeenCalled();
    expect(deps.isTaken).not.toHaveBeenCalled();
    expect(r).toEqual({ status: 200, body: { siteId: 'fresh-cuts-ab12', deployedUrl: 'https://fresh-cuts-ab12.vercel.app', republished: true } });
  });

  it('republish carries the previous deployedUrl forward in the pending file', async () => {
    const prior: PendingSite = { siteId: 'fresh-cuts-ab12', siteData: site(), deployedUrl: 'https://fresh-cuts-ab12.vercel.app' };
    const { deps, pending } = fakes({
      existing: row({ site_slug: 'fresh-cuts-ab12' }),
      pending: { 'fresh-cuts-ab12': prior },
      outcome: (s) => ({ ok: false, siteId: s, reason: 'deploy-failed' }),
    });
    await runIosPublish(input({ siteData: site({ shopName: 'Elite Fades' }) }), deps);
    expect(pending.get('fresh-cuts-ab12')!.deployedUrl).toBe('https://fresh-cuts-ab12.vercel.app');
    expect(pending.get('fresh-cuts-ab12')!.siteData.shopName).toBe('Elite Fades');
  });

  it('a bound slug that never went live is force-deployed but not reported as republished', async () => {
    const { deps } = fakes({ existing: row({ site_slug: 'fresh-cuts', published_at: null }) });
    const r = await runIosPublish(input(), deps);
    expect(deps.publish).toHaveBeenCalledWith('fresh-cuts', { force: true });
    expect(r).toEqual({ status: 200, body: { siteId: 'fresh-cuts', deployedUrl: 'https://fresh-cuts.vercel.app', republished: false } });
  });

  it('non-array gallery → 400 before verify or any repo call', async () => {
    const { deps, repo } = fakes();
    const r = await runIosPublish(input({ siteData: site({ gallery: 'x' as any }) }), deps);
    expect(r).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect(deps.verify).not.toHaveBeenCalled();
    expect(repo.upsertVerified).not.toHaveBeenCalled();
    expect(repo.bindSlug).not.toHaveBeenCalled();
  });

  it('non-object hero → 400', async () => {
    const { deps } = fakes();
    expect(await runIosPublish(input({ siteData: site({ hero: 'x' as any }) }), deps)).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it('non-array services, craftImages or staff → 400; absent craftImages/staff is fine', async () => {
    for (const bad of [{ services: {} }, { craftImages: 'x' }, { staff: { name: 'a' } }]) {
      const { deps } = fakes();
      expect(await runIosPublish(input({ siteData: site(bad as any) }), deps)).toEqual({ status: 400, body: { error: 'bad-request' } });
    }
    const { deps } = fakes();
    const sd: any = site();
    delete sd.craftImages;
    delete sd.staff;
    expect((await runIosPublish(input({ siteData: sd }), deps)).status).toBe(200);
  });

  it('text that merely contains "data:" is accepted', async () => {
    const { deps } = fakes();
    const r = await runIosPublish(input({ siteData: site({ bio: 'Metadata: walk-ins welcome' }) }), deps);
    expect(r.status).toBe(200);
  });

  it('a data URL in hero.imageUrl → 400 (case-insensitive, leading whitespace)', async () => {
    for (const v of ['data:image/jpeg;base64,AAAA', '  DATA:image/png;base64,AAAA']) {
      const { deps } = fakes();
      const sd = site({ hero: { heading: 'H', tagline: 'T', imageUrl: v } });
      expect(await runIosPublish(input({ siteData: sd }), deps)).toEqual({ status: 400, body: { error: 'bad-request' } });
      expect(deps.verify).not.toHaveBeenCalled();
    }
  });

  it('a nested staff[0].photo data URL → 400', async () => {
    const { deps } = fakes();
    const sd = site({ staff: [{ name: 'Sam', photo: 'data:image/jpeg;base64,AAAA' }] });
    expect(await runIosPublish(input({ siteData: sd }), deps)).toEqual({ status: 400, body: { error: 'bad-request' } });
  });

  it('expired subscription cannot republish', async () => {
    const { deps, repo } = fakes({ verified: tx({ expiresAt: NOW - 1 }), existing: row({ site_slug: 'fresh-cuts' }) });
    const r = await runIosPublish(input(), deps);
    expect(r).toEqual({ status: 402, body: { error: 'subscription-inactive' } });
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.writePending).not.toHaveBeenCalled();
    expect(repo.upsertVerified).not.toHaveBeenCalled();
  });

  it('revoked subscription cannot publish', async () => {
    const { deps } = fakes({ verified: tx({ revoked: true }) });
    const r = await runIosPublish(input(), deps);
    expect(r.status).toBe(402);
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('rejects data URLs', async () => {
    const { deps } = fakes();
    const r = await runIosPublish(input({ siteData: site({ gallery: ['data:image/jpeg;base64,AAAA'] }) }), deps);
    expect(r).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it('deploy failure leaves the row for the sweeper', async () => {
    const { deps, repo, rows } = fakes({ outcome: (s) => ({ ok: false, siteId: s, reason: 'deploy-failed', error: 'boom' }) });
    const r = await runIosPublish(input(), deps);
    expect(r).toEqual({ status: 502, body: { error: 'publish-failed', reason: 'deploy-failed' } });
    expect(repo.markPublished).not.toHaveBeenCalled();
    expect(rows.get(OTID)!.site_slug).toBe('fresh-cuts');
    expect(rows.get(OTID)!.published_at).toBeNull();
  });

  it('concurrent first publish uses the slug that won the bind', async () => {
    const { deps, repo } = fakes({ bindLoses: 'fresh-cuts-zz99' });
    const r = await runIosPublish(input(), deps);
    expect(repo.get).toHaveBeenCalledWith(OTID);
    expect(deps.writePending).toHaveBeenCalledWith('fresh-cuts-zz99', expect.anything());
    expect(deps.writePending).not.toHaveBeenCalledWith('fresh-cuts', expect.anything());
    expect(deps.publish).toHaveBeenCalledWith('fresh-cuts-zz99', { force: false });
    expect(r).toEqual({ status: 200, body: { siteId: 'fresh-cuts-zz99', deployedUrl: 'https://fresh-cuts-zz99.vercel.app', republished: false } });
  });

  it('bind lost with no slug on re-read returns 503 slug-bind-failed', async () => {
    const { deps } = fakes({ bindLoses: null });
    const r = await runIosPublish(input(), deps);
    expect(r).toEqual({ status: 503, body: { error: 'slug-bind-failed' } });
    expect(deps.writePending).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('apple-unavailable → 503', async () => {
    const { deps } = fakes({ verified: new VerifyFailure('apple-unavailable') });
    expect(await runIosPublish(input(), deps)).toEqual({ status: 503, body: { error: 'apple-unavailable' } });
  });

  it('bad-product → 400', async () => {
    const { deps } = fakes({ verified: new VerifyFailure('bad-product') });
    expect(await runIosPublish(input(), deps)).toEqual({ status: 400, body: { error: 'bad-product' } });
  });

  it('bad-bundle → 400', async () => {
    const { deps } = fakes({ verified: new VerifyFailure('bad-bundle') });
    expect(await runIosPublish(input(), deps)).toEqual({ status: 400, body: { error: 'bad-bundle' } });
  });

  it('not-found → 404', async () => {
    const { deps } = fakes({ verified: new VerifyFailure('not-found') });
    expect(await runIosPublish(input(), deps)).toEqual({ status: 404, body: { error: 'not-found' } });
  });

  it('missing transactionId → 400', async () => {
    const { deps } = fakes();
    expect(await runIosPublish(input({ transactionId: undefined }), deps)).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect(await runIosPublish(input({ transactionId: '' }), deps)).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it('siteData missing shopName → 400', async () => {
    const { deps } = fakes();
    const sd: any = site();
    delete sd.shopName;
    expect(await runIosPublish(input({ siteData: sd }), deps)).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect(await runIosPublish(input({ siteData: null }), deps)).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it('body over 3 MB → 400', async () => {
    const { deps } = fakes();
    const big = site({ bio: 'x'.repeat(3 * 1024 * 1024 + 1) });
    expect(await runIosPublish(input({ siteData: big }), deps)).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it('userId given → setUser called with the row\'s otid', async () => {
    const { deps, repo } = fakes();
    await runIosPublish(input({ userId: USER }), deps);
    expect(repo.setUser).toHaveBeenCalledTimes(1);
    expect(repo.setUser).toHaveBeenCalledWith(OTID, USER);
  });

  it('no userId → setUser not called', async () => {
    const { deps, repo } = fakes();
    await runIosPublish(input({ userId: null }), deps);
    expect(repo.setUser).not.toHaveBeenCalled();
  });

  it('a malformed userId is ignored and a failing setUser does not block publishing', async () => {
    const a = fakes();
    await runIosPublish(input({ userId: 'not-a-uuid' }), a.deps);
    expect(a.repo.setUser).not.toHaveBeenCalled();

    const b = fakes();
    (b.repo.setUser as any).mockRejectedValueOnce(new Error('fk violation'));
    const r = await runIosPublish(input({ userId: USER }), b.deps);
    expect(r.status).toBe(200);
  });

  it('repo errors surface as 503 temporarily-unavailable', async () => {
    const { deps, repo } = fakes();
    (repo.upsertVerified as any).mockRejectedValueOnce(new Error('db down'));
    expect(await runIosPublish(input(), deps)).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('isTaken errors surface as 503, not a guess', async () => {
    const { deps, repo } = fakes();
    (deps.isTaken as any).mockRejectedValueOnce(new Error('gcs down'));
    expect(await runIosPublish(input(), deps)).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
    expect(repo.bindSlug).not.toHaveBeenCalled();
  });

  it('markPublished failing after a live deploy still returns 200', async () => {
    const { deps, repo } = fakes();
    (repo.markPublished as any).mockRejectedValueOnce(new Error('db blip'));
    const r = await runIosPublish(input(), deps);
    expect(r.status).toBe(200);
  });

  it('a slug that is an existing Vercel project (no pending file, URL 404) gets a suffix', async () => {
    const { deps } = fakes();
    deps.isTaken = makeIsTaken({
      pendingExists: async () => false,
      repoTaken: async () => false,
      projectExists: async (s) => s === 'fresh-cuts',
      urlServes: async () => false,
    });
    const r: any = await runIosPublish(input(), deps);
    expect(r.status).toBe(200);
    expect(r.body.siteId).toMatch(/^fresh-cuts-[a-z0-9]{4}$/);
    expect((deps.publish as any).mock.calls[0][0]).toBe(r.body.siteId);
  });

  it('Vercel project API 500 → chooseSlug throws → 503 and nothing bound, written or deployed', async () => {
    const { deps, repo } = fakes();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('VERCEL_TOKEN', 'tok');
    const fetchMock = vi.fn(async () => ({ status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      deps.isTaken = makeIsTaken({
        pendingExists: async () => false,
        repoTaken: async () => false,
        projectExists: vercelProjectExists,
        urlServes: async () => false,
      });
      expect(await runIosPublish(input(), deps)).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(repo.bindSlug).not.toHaveBeenCalled();
      expect(deps.writePending).not.toHaveBeenCalled();
      expect(deps.publish).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });

  it('sandbox purchases get the ios-test- prefix', async () => {
    const { deps } = fakes({ verified: tx({ environment: 'Sandbox' }) });
    const r: any = await runIosPublish(input(), deps);
    expect(r.body.siteId).toBe('ios-test-fresh-cuts');
  });
});

describe('buildImageUrlMap', () => {
  it('keeps only http(s) and indexes gallery/craft/staff', () => {
    const sd = site({
      about: { heading: 'A', description: [], imageUrl: 'ftp://nope/about.jpg' },
      gallery: ['', 'https://g/1.jpg', 'blob:abc', 'http://g/3.jpg'],
      craftImages: ['uploaded', 'https://c/1.jpg'],
      staff: [{ name: 'a' }, { name: 'b', photo: 'https://s/1.jpg' }],
    });
    expect(buildImageUrlMap(sd)).toEqual({
      hero: 'https://img.example/hero.jpg',
      gallery1: 'https://g/1.jpg',
      gallery3: 'http://g/3.jpg',
      craft1: 'https://c/1.jpg',
      staff1: 'https://s/1.jpg',
    });
  });

  it('tolerates missing optional arrays', () => {
    const sd: any = { shopName: 'X', hero: {}, about: {} };
    expect(buildImageUrlMap(sd)).toEqual({});
  });
});

describe('toPendingSiteData', () => {
  it('replaces mapped images with uploaded markers and clears service images', () => {
    const sd = site();
    const out = toPendingSiteData(sd, buildImageUrlMap(sd));
    expect(out.hero.imageUrl).toBe('uploaded');
    expect(out.about.imageUrl).toBe('');
    expect(out.gallery).toEqual(['uploaded', '', 'uploaded']);
    expect(out.craftImages).toEqual(['uploaded']);
    expect(out.staff).toEqual([{ name: 'Sam', photo: 'uploaded' }, { name: 'Lee', photo: '' }]);
    expect(out.services[0].imageUrl).toBe('');
    expect(out.shopName).toBe('Fresh Cuts');
  });
});

describe('runIosSiteLookup', () => {
  it('site lookup returns siteData with real image URLs', async () => {
    const sd = site();
    const map = buildImageUrlMap(sd);
    const { deps } = fakes({
      existing: row({ site_slug: 'fresh-cuts' }),
      pending: { 'fresh-cuts': { siteId: 'fresh-cuts', siteData: toPendingSiteData(sd, map), imageUrlMap: map, deployedUrl: 'https://fresh-cuts.vercel.app' } },
    });
    const r: any = await runIosSiteLookup('t-123', deps);
    expect(r.status).toBe(200);
    expect(r.body.siteId).toBe('fresh-cuts');
    expect(r.body.deployedUrl).toBe('https://fresh-cuts.vercel.app');
    expect(r.body.active).toBe(true);
    expect(r.body.siteData.hero.imageUrl).toBe('https://img.example/hero.jpg');
    expect(r.body.siteData.about.imageUrl).toBe('');
    expect(r.body.siteData.gallery).toEqual(['https://img.example/g0.jpg', '', 'http://img.example/g2.jpg']);
    expect(r.body.siteData.craftImages).toEqual(['https://img.example/c0.jpg']);
    expect(r.body.siteData.staff).toEqual([{ name: 'Sam', photo: 'https://img.example/s0.jpg' }, { name: 'Lee', photo: '' }]);
    expect(deps.repo.upsertVerified).not.toHaveBeenCalled();
  });

  it('site lookup for a transaction with no bound slug → 404 no-site', async () => {
    const a = fakes({ existing: row({ site_slug: null }) });
    expect(await runIosSiteLookup('t-123', a.deps)).toEqual({ status: 404, body: { error: 'no-site' } });
    const b = fakes({ existing: null });
    expect(await runIosSiteLookup('t-123', b.deps)).toEqual({ status: 404, body: { error: 'no-site' } });
  });

  it('site lookup returns active:false for an expired subscription', async () => {
    const { deps } = fakes({ verified: tx({ expiresAt: 1000 }), existing: row({ site_slug: 'fresh-cuts' }) });
    const r: any = await runIosSiteLookup('t-123', deps);
    expect(r.status).toBe(200);
    expect(r.body.active).toBe(false);
    expect(r.body.siteData).toBeNull();
    expect(r.body.deployedUrl).toBeNull();
  });

  it('site lookup judges activity by the injected clock', async () => {
    // NOW - 1 is still in the future by the wall clock, but expired by deps.now().
    expect(NOW - 1).toBeGreaterThan(Date.now());
    const { deps } = fakes({ verified: tx({ expiresAt: NOW - 1 }), existing: row({ site_slug: 'fresh-cuts' }) });
    const r: any = await runIosSiteLookup('t-123', deps);
    expect(r.body.active).toBe(false);
  });

  it('site lookup maps verify failures', async () => {
    expect(await runIosSiteLookup('t', fakes({ verified: new VerifyFailure('not-found') }).deps))
      .toEqual({ status: 404, body: { error: 'not-found' } });
    expect(await runIosSiteLookup('t', fakes({ verified: new VerifyFailure('bad-product') }).deps))
      .toEqual({ status: 404, body: { error: 'bad-product' } });
    expect(await runIosSiteLookup('t', fakes({ verified: new VerifyFailure('apple-unavailable') }).deps))
      .toEqual({ status: 503, body: { error: 'apple-unavailable' } });
  });

  it('site lookup repo errors → 503', async () => {
    const { deps, repo } = fakes({ existing: row({ site_slug: 'fresh-cuts' }) });
    (repo.get as any).mockRejectedValueOnce(new Error('db down'));
    expect(await runIosSiteLookup('t-123', deps)).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
  });
});
