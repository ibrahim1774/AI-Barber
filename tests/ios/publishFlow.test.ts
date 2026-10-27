import { describe, it, expect, vi } from 'vitest';
import {
  buildImageUrlMap,
  toPendingSiteData,
  runIosPublish,
  runIosSiteLookup,
  type PublishDeps,
} from '../../lib/ios/publishFlow.js';
import { VerifyFailure, makeVerifier, type VerifiedTx } from '../../lib/ios/appleVerify.js';
import { makeIsTaken, vercelProjectExists } from '../../lib/ios/slug.js';
import type { PurchaseRow, PurchasesRepo } from '../../lib/ios/purchases.js';
import type { PendingSite, PublishOutcome } from '../../lib/publishSite.js';
import type { WebsiteData } from '../../types.js';

const NOW = 1_800_000_000_000;
const OTID = 'o-999'; // deliberately different from the transactionId the app sends
const USER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
/** What a publish over a copy with no version writes and returns. */
const OWNER_V1 = { version: 1, editedBy: 'owner', editedAt: new Date(NOW).toISOString() };

function site(over: Partial<WebsiteData> = {}): WebsiteData {
  return {
    shopName: 'Fresh Cuts',
    area: 'Brooklyn',
    phone: '555-0100',
    hero: { heading: 'H', tagline: 'T', imageUrl: 'https://img.example/hero.jpg' },
    about: { heading: 'A', description: ['d'], imageUrl: '' },
    services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: 'https://img.example/svc.jpg' } as any],
    gallery: ['https://img.example/g0.jpg', '', 'http://img.example/g2.jpg'],
    craftImages: ['https://img.example/c0.jpg'],
    staff: [{ name: 'Sam', photo: 'https://img.example/s0.jpg' }, { name: 'Lee', photo: '' }],
    // Renderable (the publish dry-renders before storing, e2e I3).
    contact: { address: '1 Main St', email: 'a@b.co' },
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
    taken_down_at: null, lapse_checked_at: null,
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
    setUserIfUnlinked: vi.fn(async (otid: string, userId: string) => { const r = rows.get(otid); if (!r || r.user_id) return false; r.user_id = userId; return true; }),
    applyNotification: vi.fn(async () => {}),
    unpublishedBound: vi.fn(async () => []),
    takedownCandidates: vi.fn(async () => []),
    restoreCandidates: vi.fn(async () => []),
    markTakenDown: vi.fn(async (otid: string, at: number) => { rows.get(otid)!.taken_down_at = new Date(at).toISOString(); }),
    clearTakenDown: vi.fn(async (otid: string) => { rows.get(otid)!.taken_down_at = null; }),
    markRemoved: vi.fn(async (otid: string, at: number) => { const r = rows.get(otid)!; if (!r.removed_at) r.removed_at = new Date(at).toISOString(); }),
    clearRemoved: vi.fn(async (otid: string, at: string) => { const r = rows.get(otid)!; if (r.removed_at === at) r.removed_at = null; }),
    markLapseChecked: vi.fn(async () => {}),
    findBySlug: vi.fn(async (slug: string) => [...rows.values()].find((r) => r.site_slug === slug) ?? null),
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
    userOf: vi.fn(async (t: string) => (t === 'tok-user' ? { id: USER } : null)),
    now: () => NOW,
  };
  return { deps, repo, rows, pending };
}

const input = (over: Record<string, unknown> = {}) => ({ transactionId: 't-123', siteData: site(), ...over }) as any;

describe('runIosPublish', () => {
  it('first publish binds a new slug and publishes without force', async () => {
    const { deps, repo, rows, pending } = fakes();
    const r = await runIosPublish(input(), deps);
    expect(r).toEqual({ status: 200, body: { siteId: 'fresh-cuts', deployedUrl: 'https://fresh-cuts.vercel.app', republished: false, ...OWNER_V1 } });
    expect(deps.verify).toHaveBeenCalledWith('t-123');
    expect(repo.bindSlug).toHaveBeenCalledWith(OTID, 'fresh-cuts');
    expect(deps.publish).toHaveBeenCalledWith('fresh-cuts', { force: false });
    expect(repo.markPublished).toHaveBeenCalledWith(OTID, undefined);
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
    expect(r).toEqual({ status: 200, body: { siteId: 'fresh-cuts-ab12', deployedUrl: 'https://fresh-cuts-ab12.vercel.app', republished: true, ...OWNER_V1 } });
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
    expect(r).toEqual({ status: 200, body: { siteId: 'fresh-cuts', deployedUrl: 'https://fresh-cuts.vercel.app', republished: false, ...OWNER_V1 } });
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

  it('billing-grace subscription (status 4, expiry passed) can still publish', async () => {
    const { deps } = fakes({ verified: tx({ status: 4, expiresAt: NOW - 1000 }) });
    expect((await runIosPublish(input(), deps)).status).toBe(200);
  });

  it('billing-retry subscription (status 3) gets 402', async () => {
    const { deps } = fakes({ verified: tx({ status: 3, expiresAt: NOW - 1000 }) });
    expect(await runIosPublish(input(), deps)).toEqual({ status: 402, body: { error: 'subscription-inactive' } });
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
    expect(r).toEqual({ status: 200, body: { siteId: 'fresh-cuts-zz99', deployedUrl: 'https://fresh-cuts-zz99.vercel.app', republished: false, ...OWNER_V1 } });
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

  // e2e I6: only a verified Supabase bearer links the purchase, and only while it is unlinked.
  const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const withAuth = (f: ReturnType<typeof fakes>) => {
    f.deps.userOf = vi.fn(async (t: string) => (t === 'tok-user' ? { id: USER } : t === 'tok-other' ? { id: OTHER } : null));
    f.repo.setUserIfUnlinked = vi.fn(async (otid: string, uid: string) => {
      const r = f.rows.get(otid)!;
      if (r.user_id) return false;
      r.user_id = uid;
      return true;
    });
    return f;
  };

  it('a body userId alone never links (or re-points) the purchase', async () => {
    const f = withAuth(fakes());
    const r = await runIosPublish(input({ userId: USER }), f.deps);
    expect(r.status).toBe(200);
    expect(f.repo.setUserIfUnlinked).not.toHaveBeenCalled();
    expect(f.rows.get(OTID)!.user_id).toBeNull();
  });

  it('a verified bearer links an unlinked purchase to that account (body userId ignored)', async () => {
    const f = withAuth(fakes());
    await runIosPublish(input({ userId: OTHER }), f.deps, { authorization: 'Bearer tok-user' });
    expect(f.repo.setUserIfUnlinked).toHaveBeenCalledWith(OTID, USER);
    expect(f.rows.get(OTID)!.user_id).toBe(USER);
  });

  it('after a signup on an unlinked purchase whose old account was deleted (slug kept, site taken down, no shop/site rows): the new account is linked and the site is republished on the same slug', async () => {
    const f = withAuth(fakes({ existing: row({ site_slug: 'fade-lab', published_at: '2026-10-01T00:00:00Z', taken_down_at: '2026-10-20T00:00:00Z', removed_at: '2026-10-20T00:00:00Z' }) }));
    (f.deps as any).bindingOwner = vi.fn(async () => null); // ab_shops / sites rows went with the deleted account
    const r = await runIosPublish(input(), f.deps, { authorization: 'Bearer tok-user' });
    expect(r.status).toBe(200);
    expect((r.body as any).siteId).toBe('fade-lab');
    expect(f.rows.get(OTID)!.user_id).toBe(USER);
    expect(f.rows.get(OTID)!.removed_at).toBeNull();
    expect(f.rows.get(OTID)!.taken_down_at).toBeNull();
    expect(f.repo.bindSlug).not.toHaveBeenCalled();
  });

  it('an unlinked purchase whose site still belongs to a live OTHER account is not taken over by a new signup (409, nothing written)', async () => {
    const f = withAuth(fakes({ existing: row({ site_slug: 'fade-lab' }) }));
    (f.deps as any).bindingOwner = vi.fn(async () => OTHER);
    const r = await runIosPublish(input(), f.deps, { authorization: 'Bearer tok-user' });
    expect(r.status).toBe(409);
    expect(f.deps.writePending).not.toHaveBeenCalled();
    expect(f.rows.get(OTID)!.user_id).toBeNull();
  });

  it('a verified bearer of another account never re-points a linked purchase (409, nothing written)', async () => {
    const f = withAuth(fakes({ existing: row({ user_id: USER }) }));
    const r = await runIosPublish(input(), f.deps, { authorization: 'Bearer tok-other' });
    expect(r).toEqual({ status: 409, body: { error: 'purchase-other-account', hint: null, ownerHint: null, hasLiveSite: false } });
    expect(f.deps.writePending).not.toHaveBeenCalled();
    expect(f.repo.bindSlug).not.toHaveBeenCalled();
    expect(f.rows.get(OTID)!.user_id).toBe(USER);
  });

  it('a move that lands while the old owner\'s publish is deploying: nothing goes offline, the publish answers 409 purchase-changed', async () => {
    const f = withAuth(fakes({
      existing: row({ user_id: USER, site_slug: 'fade-lab', published_at: '2026-10-01T00:00:00Z' }),
      outcome: (slug) => {
        // the transfer's compare-and-set lands during the deploy (the slug stays with the purchase)
        Object.assign(f.rows.get(OTID)!, { user_id: OTHER });
        return { ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app`, alreadyLive: false } as any;
      },
    }));
    const r = await runIosPublish(input(), f.deps, { authorization: 'Bearer tok-user' });
    expect(r).toEqual({ status: 409, body: { error: 'purchase-changed' } });
    // the stamps are conditional on the owner and slug (so they cannot land on the new owner's row)
    expect(f.repo.markPublished).toHaveBeenCalledWith(OTID, { userId: USER, slug: 'fade-lab' });
  });

  it('M3: publish by the purchase owner first finishes an unfinished business move; a failing finisher never blocks the publish', async () => {
    const f = withAuth(fakes({ existing: row({ user_id: USER, site_slug: 'fade-lab', published_at: '2026-10-01T00:00:00Z' }) }));
    const finishMove = vi.fn(async () => { throw new Error('x'); });
    (f.deps as any).finishMove = finishMove;
    expect((await runIosPublish(input(), f.deps, { authorization: 'Bearer tok-user' })).status).toBe(200);
    expect(finishMove).toHaveBeenCalledWith(USER);
  });

  it('an invalid token still publishes under the compat flag; an auth outage or a failed link fails closed (503, nothing written)', async () => {
    const a = withAuth(fakes());
    expect((await runIosPublish(input(), a.deps, { authorization: 'Bearer nope' })).status).toBe(200);
    expect(a.rows.get(OTID)!.user_id).toBeNull();
    const b = withAuth(fakes());
    (b.deps.userOf as any).mockRejectedValueOnce(new Error('auth down'));
    expect((await runIosPublish(input(), b.deps, { authorization: 'Bearer tok-user' })).status).toBe(503);
    expect(b.deps.publish).not.toHaveBeenCalled();
    const c = withAuth(fakes());
    (c.repo.setUserIfUnlinked as any).mockRejectedValueOnce(new Error('fk violation'));
    expect((await runIosPublish(input(), c.deps, { authorization: 'Bearer tok-user' })).status).toBe(503);
    expect(c.deps.publish).not.toHaveBeenCalled();
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

describe('runIosPublish tiers (Phase 4)', () => {
  const P = 'com.ibrahim1774.aibarber.';
  const AB_BOOK = 'https://www.aibarber.org/book/fresh-cuts';
  const AB_SHOP = 'https://www.aibarber.org/shop/fresh-cuts';
  const linked = (over: Partial<WebsiteData> = {}) => input({ siteData: site({ bookingUrl: AB_BOOK, shopUrl: AB_SHOP, ...over }) });

  it('a Website-tier publish with an AI Barber bookingUrl and a shopUrl: the pending payload has neither', async () => {
    const { deps, pending } = fakes({ verified: tx({ productId: `${P}hosting.monthly` }) });
    expect((await runIosPublish(linked(), deps)).status).toBe(200);
    const sd = pending.get('fresh-cuts')!.siteData;
    expect('bookingUrl' in sd).toBe(false);
    expect('shopUrl' in sd).toBe(false);
  });

  it('a Store-tier publish keeps both', async () => {
    const { deps, pending } = fakes({ verified: tx({ productId: `${P}store.yearly` }) });
    expect((await runIosPublish(linked(), deps)).status).toBe(200);
    const sd = pending.get('fresh-cuts')!.siteData;
    expect(sd.bookingUrl).toBe(AB_BOOK);
    expect(sd.shopUrl).toBe(AB_SHOP);
  });

  it('a Booksy bookingUrl is kept on Website', async () => {
    const { deps, pending } = fakes({ verified: tx({ productId: `${P}hosting.yearly` }) });
    await runIosPublish(linked({ bookingUrl: 'https://booksy.com/en-us/1_fresh-cuts' }), deps);
    expect(pending.get('fresh-cuts')!.siteData.bookingUrl).toBe('https://booksy.com/en-us/1_fresh-cuts');
  });

  it('strips by the verified (latest) product, not anything the app sends', async () => {
    const { deps, pending } = fakes({ verified: tx({ productId: `${P}bookings.monthly` }) });
    await runIosPublish({ ...linked(), productId: `${P}store.yearly`, tier: 'store' } as any, deps);
    const sd = pending.get('fresh-cuts')!.siteData;
    expect(sd.bookingUrl).toBe(AB_BOOK);
    expect('shopUrl' in sd).toBe(false);
  });

  // Controller update (2026-10-21): the publish paywall sells all six products, so a Bookings or
  // Store purchase at publish must verify, publish and record its tier straight away.
  describe('a purchase of any of the six products at publish', () => {
    function appleSays(productId: string, purchaseDate: number) {
      const decoded = {
        bundleId: 'com.ibrahim1774.aibarber', productId, originalTransactionId: OTID, transactionId: 't-123',
        expiresDate: NOW + 30 * 86_400_000, purchaseDate,
      };
      return makeVerifier({
        bundleId: 'com.ibrahim1774.aibarber',
        lookup: async (env) => (env === 'Production' ? { status: 200, signedTransactionInfo: 'sent' } : { status: 404 }),
        decode: async () => decoded,
        statuses: async () => ({ status: 200, items: [{ status: 1, originalTransactionId: OTID, signedTransactionInfo: 'latest' }] }),
      });
    }

    it.each([
      ['bookings.monthly', true, false],
      ['store.yearly', true, true],
      ['bookings.yearly', true, false],
      ['store.monthly', true, true],
      ['hosting.monthly', false, false],
    ])('%s: 200, the tier is recorded, links kept per tier', async (suffix, keepsBook, keepsShop) => {
      const { deps, repo, rows, pending } = fakes();
      deps.verify = appleSays(P + suffix, NOW - 60_000);
      const r = await runIosPublish(linked(), deps);
      expect(r).toEqual({ status: 200, body: { siteId: 'fresh-cuts', deployedUrl: 'https://fresh-cuts.vercel.app', republished: false, ...OWNER_V1 } });
      expect(repo.upsertVerified).toHaveBeenCalledWith(
        expect.objectContaining({ originalTransactionId: OTID, productId: P + suffix, productPurchasedAt: NOW - 60_000 }),
        { checkedAt: NOW },
      );
      expect(rows.get(OTID)!.product_id).toBe(P + suffix);
      const sd = pending.get('fresh-cuts')!.siteData;
      expect('bookingUrl' in sd).toBe(keepsBook);
      expect('shopUrl' in sd).toBe(keepsShop);
    });

    it('an unknown product is still 400 bad-product (nothing bound or written)', async () => {
      const { deps, repo, pending } = fakes();
      deps.verify = appleSays('com.other.app.monthly', NOW);
      expect(await runIosPublish(linked(), deps)).toEqual({ status: 400, body: { error: 'bad-product' } });
      expect(repo.upsertVerified).not.toHaveBeenCalled();
      expect(pending.size).toBe(0);
    });
  });
});

describe('runIosPublish after an owner removal (removed_at, review H1)', () => {
  const removed = () => row({ site_slug: 'fresh-cuts-ab12', published_at: '2026-09-01T00:00:00Z', taken_down_at: '2026-10-15T00:00:00Z', removed_at: '2026-10-15T00:00:00Z' });

  it('an explicit owner publish brings the site back: removed_at and taken_down_at cleared', async () => {
    const { deps, repo, rows } = fakes({ existing: removed() });
    const r = await runIosPublish(input(), deps);
    expect(r.status).toBe(200);
    expect(repo.clearRemoved).toHaveBeenCalledWith(OTID, '2026-10-15T00:00:00Z');
    expect(rows.get(OTID)!.removed_at).toBeNull();
    expect(rows.get(OTID)!.taken_down_at).toBeNull();
  });

  it('a removal that lands while the publish is in flight keeps its marks (L5)', async () => {
    const { deps, repo, rows } = fakes({ existing: removed() });
    (deps.publish as any).mockImplementationOnce(async (slug: string) => {
      rows.get(OTID)!.removed_at = '2026-10-25T10:00:00Z'; // a newer removal, mid-publish
      return { ok: true, siteId: slug, deployedUrl: 'https://x.vercel.app' };
    });
    const r = await runIosPublish(input(), deps);
    expect(r.status).toBe(200);
    expect(rows.get(OTID)!.removed_at).toBe('2026-10-25T10:00:00Z');
    expect(repo.clearTakenDown).not.toHaveBeenCalled();
  });

  it('a failed publish leaves the removal in place', async () => {
    const { deps, repo, rows } = fakes({ existing: removed(), outcome: (s) => ({ ok: false, siteId: s, reason: 'deploy-failed', error: 'x' }) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await runIosPublish(input(), deps)).status).toBe(502);
    expect(repo.clearRemoved).not.toHaveBeenCalled();
    expect(rows.get(OTID)!.removed_at).toBe('2026-10-15T00:00:00Z');
  });
});

describe('runIosPublish lapse takedown flag', () => {
  const takenDown = () => row({ site_slug: 'fresh-cuts-ab12', published_at: '2026-09-01T00:00:00Z', taken_down_at: '2026-10-15T00:00:00Z' });

  it('resubscribe: a successful bound-slug republish clears taken_down_at', async () => {
    const { deps, repo, rows } = fakes({ existing: takenDown() });
    const r = await runIosPublish(input(), deps);
    expect(r.status).toBe(200);
    expect(deps.publish).toHaveBeenCalledWith('fresh-cuts-ab12', { force: true });
    expect(repo.clearTakenDown).toHaveBeenCalledWith(OTID, undefined);
    expect(rows.get(OTID)!.taken_down_at).toBeNull();
  });

  it('a failed republish leaves the flag set', async () => {
    const { deps, repo, rows } = fakes({
      existing: takenDown(),
      outcome: (s) => ({ ok: false, siteId: s, reason: 'deploy-failed', error: 'x' }),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runIosPublish(input(), deps);
    expect(r.status).toBe(502);
    expect(repo.clearTakenDown).not.toHaveBeenCalled();
    expect(rows.get(OTID)!.taken_down_at).toBe('2026-10-15T00:00:00Z');
  });

  it('clearTakenDown failing after a live deploy still returns 200 (best effort, logged)', async () => {
    const { deps, repo } = fakes({ existing: takenDown() });
    (repo.clearTakenDown as any).mockRejectedValueOnce(new Error('db'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runIosPublish(input(), deps);
    expect(r.status).toBe(200);
    expect(err.mock.calls.flat().join(' ')).toMatch(/clearTakenDown/);
    err.mockRestore();
  });

  it('passes when Apple was asked (checkedAt) so a stale revocation can clear on an active answer', async () => {
    const { deps, repo } = fakes({ existing: takenDown() });
    await runIosPublish(input(), deps);
    expect(repo.upsertVerified).toHaveBeenCalledWith(expect.objectContaining({ originalTransactionId: OTID }), { checkedAt: NOW });
  });

  it('a first publish (new slug) does not touch the flag', async () => {
    const { deps, repo } = fakes();
    const r = await runIosPublish(input(), deps);
    expect(r.status).toBe(200);
    expect(repo.clearTakenDown).not.toHaveBeenCalled();
  });

  it('an expired subscription cannot republish a taken-down site (402, flag kept)', async () => {
    const { deps, repo } = fakes({ existing: takenDown(), verified: tx({ expiresAt: NOW - 1 }) });
    const r = await runIosPublish(input(), deps);
    expect(r.status).toBe(402);
    expect(deps.publish).not.toHaveBeenCalled();
    expect(repo.clearTakenDown).not.toHaveBeenCalled();
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

const AS_USER = { authorization: 'Bearer tok-user' };

describe('runIosSiteLookup', () => {
  it('site lookup returns siteData with real image URLs', async () => {
    const sd = site();
    const map = buildImageUrlMap(sd);
    const { deps } = fakes({
      existing: row({ user_id: USER, site_slug: 'fresh-cuts' }),
      pending: { 'fresh-cuts': { siteId: 'fresh-cuts', siteData: toPendingSiteData(sd, map), imageUrlMap: map, deployedUrl: 'https://fresh-cuts.vercel.app' } },
    });
    const r: any = await runIosSiteLookup('t-123', deps, AS_USER);
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
    const a = fakes({ existing: row({ user_id: USER, site_slug: null }) });
    expect(await runIosSiteLookup('t-123', a.deps, AS_USER)).toEqual({ status: 404, body: { error: 'no-site' } });
    const b = fakes({ existing: null });
    expect(await runIosSiteLookup('t-123', b.deps, AS_USER)).toEqual({ status: 404, body: { error: 'no-site' } });
  });

  it('site lookup for a site the owner took offline (removed_at) → 404 no-site, so a new site can be published', async () => {
    const { deps } = fakes({ existing: row({ user_id: USER, site_slug: 'fresh-cuts', removed_at: '2026-10-15T00:00:00Z', taken_down_at: '2026-10-15T00:00:00Z' }) });
    expect(await runIosSiteLookup('t-123', deps, AS_USER)).toEqual({ status: 404, body: { error: 'no-site' } });
  });

  describe('H1: no Authorization header (build 22 and earlier)', () => {
    it('no purchase row, or an unlinked row with no site -> 404 no-site with no data, Apple was asked', async () => {
      for (const existing of [null, row({ user_id: null, site_slug: null })]) {
        const { deps } = fakes({ existing });
        for (const ctx of [{}, { authorization: undefined }, { authorization: '' }]) {
          expect(await runIosSiteLookup('t-123', deps, ctx)).toEqual({ status: 404, body: { error: 'no-site' } });
        }
        expect(deps.verify).toHaveBeenCalled();
        expect(deps.readPending).not.toHaveBeenCalled();
      }
    });

    it('a linked row, or an unlinked row with a bound site -> 401 auth-required with no data', async () => {
      for (const existing of [row({ user_id: USER, site_slug: 'fresh-cuts' }), row({ user_id: USER, site_slug: null }), row({ user_id: null, site_slug: 'fresh-cuts' })]) {
        const { deps } = fakes({ existing });
        expect(await runIosSiteLookup('t-123', deps, {})).toEqual({ status: 401, body: { error: 'auth-required' } });
        expect(deps.readPending).not.toHaveBeenCalled();
      }
    });

    it('Apple refusing (unknown / down) is 404 / 503, never a 401 loop', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const a = fakes({ verified: new VerifyFailure('not-found') });
      expect((await runIosSiteLookup('t-123', a.deps, {})).status).toBe(404);
      const b = fakes({ verified: new VerifyFailure('apple-unavailable') });
      expect((await runIosSiteLookup('t-123', b.deps, {})).status).toBe(503);
    });
  });

  describe('M2: Restore links an accountless legacy site', () => {
    it('nobody attached (owner null): the signed-in caller is linked and gets the site', async () => {
      const { deps } = fakes({ existing: row({ user_id: null, site_slug: 'fresh-cuts' }), pending: { 'fresh-cuts': { siteId: 'fresh-cuts', siteData: toPendingSiteData(site(), buildImageUrlMap(site())), imageUrlMap: buildImageUrlMap(site()), deployedUrl: 'https://x' } } });
      (deps as any).bindingOwner = vi.fn(async () => null);
      const r: any = await runIosSiteLookup('t-123', deps, AS_USER);
      expect(r.status).toBe(200);
      expect(deps.repo.setUserIfUnlinked).toHaveBeenCalledWith(OTID, USER);
    });

    it('another account owns the shop, or ownership is ambiguous: 409 and no link', async () => {
      for (const owner of ['9f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f', 'ambiguous'] as const) {
        const { deps } = fakes({ existing: row({ user_id: null, site_slug: 'fresh-cuts' }) });
        (deps as any).bindingOwner = vi.fn(async () => owner);
        expect((await runIosSiteLookup('t-123', deps, AS_USER)).status).toBe(409);
        expect(deps.repo.setUserIfUnlinked).not.toHaveBeenCalled();
      }
    });
  });

  it('site lookup returns active:false for an expired subscription', async () => {
    const { deps } = fakes({ verified: tx({ expiresAt: 1000 }), existing: row({ user_id: USER, site_slug: 'fresh-cuts' }) });
    const r: any = await runIosSiteLookup('t-123', deps, AS_USER);
    expect(r.status).toBe(200);
    expect(r.body.active).toBe(false);
    expect(r.body.siteData).toBeNull();
    expect(r.body.deployedUrl).toBeNull();
  });

  it('site lookup judges activity by the injected clock', async () => {
    // NOW - 1 is still in the future by the wall clock, but expired by deps.now().
    expect(NOW - 1).toBeGreaterThan(Date.now());
    const { deps } = fakes({ verified: tx({ expiresAt: NOW - 1 }), existing: row({ user_id: USER, site_slug: 'fresh-cuts' }) });
    const r: any = await runIosSiteLookup('t-123', deps, AS_USER);
    expect(r.body.active).toBe(false);
  });

  it('site lookup maps verify failures', async () => {
    expect(await runIosSiteLookup('t', fakes({ verified: new VerifyFailure('not-found') }).deps, AS_USER))
      .toEqual({ status: 404, body: { error: 'not-found' } });
    expect(await runIosSiteLookup('t', fakes({ verified: new VerifyFailure('bad-product') }).deps, AS_USER))
      .toEqual({ status: 404, body: { error: 'bad-product' } });
    expect(await runIosSiteLookup('t', fakes({ verified: new VerifyFailure('apple-unavailable') }).deps, AS_USER))
      .toEqual({ status: 503, body: { error: 'apple-unavailable' } });
  });

  it('site lookup repo errors → 503', async () => {
    const { deps, repo } = fakes({ existing: row({ user_id: USER, site_slug: 'fresh-cuts' }) });
    (repo.get as any).mockRejectedValueOnce(new Error('db down'));
    expect(await runIosSiteLookup('t-123', deps, AS_USER)).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
  });
});

describe('site versions (admin edits never lost to the phone)', () => {
  const SLUG = 'fresh-cuts-ab12';
  const bound = () => row({ site_slug: SLUG, published_at: '2026-10-01T00:00:00Z' });
  const stored = (over: Partial<PendingSite> = {}): PendingSite => {
    const sd = site({ shopName: 'Server Copy' });
    const map = buildImageUrlMap(sd);
    return { siteId: SLUG, siteData: toPendingSiteData(sd, map), imageUrlMap: map, deployedUrl: `https://${SLUG}.vercel.app`, ...over };
  };

  it('a publish writes version + 1, editedBy owner, editedAt, and returns them', async () => {
    const { deps, pending } = fakes({ existing: bound(), pending: { [SLUG]: stored({ version: 4, editedBy: 'owner' }) } });
    const r: any = await runIosPublish(input({ baseVersion: 4 }), deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ version: 5, editedBy: 'owner', editedAt: new Date(NOW).toISOString() });
    expect(pending.get(SLUG)).toMatchObject({ version: 5, editedBy: 'owner', editedAt: new Date(NOW).toISOString() });
  });

  it('a first publish (no stored copy) is version 1', async () => {
    const { deps, pending } = fakes();
    const r: any = await runIosPublish(input(), deps);
    expect(r.body).toMatchObject({ version: 1, editedBy: 'owner' });
    expect(pending.get('fresh-cuts')!.version).toBe(1);
  });

  it('baseVersion older than a stored admin edit → 409 site-updated with the server copy; nothing written or deployed', async () => {
    const { deps } = fakes({
      existing: bound(),
      pending: { [SLUG]: stored({ version: 5, editedBy: 'admin', editedAt: '2026-10-21T10:00:00.000Z' }) },
    });
    const r: any = await runIosPublish(input({ baseVersion: 4 }), deps);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('site-updated');
    expect(r.body.site).toEqual({
      siteId: SLUG,
      deployedUrl: `https://${SLUG}.vercel.app`,
      siteData: expect.objectContaining({ shopName: 'Server Copy' }),
      active: true,
      version: 5,
      editedBy: 'admin',
      editedAt: '2026-10-21T10:00:00.000Z',
    });
    // Image URLs come back real, like the site lookup.
    expect(r.body.site.siteData.hero.imageUrl).toBe('https://img.example/hero.jpg');
    expect(deps.writePending).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('baseVersion equal to the admin version publishes over it (the app adopted it)', async () => {
    const { deps, pending } = fakes({ existing: bound(), pending: { [SLUG]: stored({ version: 5, editedBy: 'admin' }) } });
    const r: any = await runIosPublish(input({ baseVersion: 5 }), deps);
    expect(r.status).toBe(200);
    expect(pending.get(SLUG)).toMatchObject({ version: 6, editedBy: 'owner', adminVersion: 5 });
  });

  it('a stale phone is still refused after another phone adopted the admin edit (admin version carried)', async () => {
    const { deps } = fakes({
      existing: bound(),
      pending: { [SLUG]: stored({ version: 6, editedBy: 'owner', adminVersion: 5 }) },
    });
    const r: any = await runIosPublish(input({ baseVersion: 3 }), deps);
    expect(r.status).toBe(409);
    expect(r.body.site.version).toBe(6);
  });

  it('no baseVersion counts as 0: refused while the stored copy is an admin edit', async () => {
    const { deps } = fakes({ existing: bound(), pending: { [SLUG]: stored({ version: 2, editedBy: 'admin' }) } });
    const r: any = await runIosPublish(input(), deps);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'site-updated', site: { version: 2, editedBy: 'admin' } });
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('no baseVersion over an owner copy or an unversioned copy still publishes (old app builds keep working)', async () => {
    for (const p of [stored({ version: 3, editedBy: 'owner' }), stored()]) {
      const { deps, pending } = fakes({ existing: bound(), pending: { [SLUG]: p } });
      const r: any = await runIosPublish(input(), deps);
      expect(r.status).toBe(200);
      expect(pending.get(SLUG)!.version).toBe((p.version || 0) + 1);
    }
  });

  it('a 409 is only ever returned after Apple verified an active subscription', async () => {
    const { deps } = fakes({
      existing: bound(),
      verified: tx({ expiresAt: NOW - 1 }),
      pending: { [SLUG]: stored({ version: 5, editedBy: 'admin' }) },
    });
    const r: any = await runIosPublish(input({ baseVersion: 1 }), deps);
    expect(r.status).toBe(402);
  });

  it('a non-integer or negative baseVersion → 400', async () => {
    for (const baseVersion of ['3', -1, 1.5]) {
      const { deps } = fakes({ existing: bound() });
      expect(await runIosPublish(input({ baseVersion }), deps)).toEqual({ status: 400, body: { error: 'bad-request' } });
    }
  });

  it('site lookup returns version, editedBy and editedAt (0 / null for an unversioned copy)', async () => {
    const a = fakes({ existing: { ...bound(), user_id: USER }, pending: { [SLUG]: stored({ version: 7, editedBy: 'admin', editedAt: '2026-10-21T10:00:00.000Z' }) } });
    const r: any = await runIosSiteLookup('t-123', a.deps, AS_USER);
    expect(r.body).toMatchObject({ siteId: SLUG, version: 7, editedBy: 'admin', editedAt: '2026-10-21T10:00:00.000Z' });
    const b = fakes({ existing: { ...bound(), user_id: USER }, pending: { [SLUG]: stored() } });
    const r2: any = await runIosSiteLookup('t-123', b.deps, AS_USER);
    expect(r2.body).toMatchObject({ version: 0, editedBy: null, editedAt: null });
  });
});
