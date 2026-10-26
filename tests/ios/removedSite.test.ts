// Apple audit PR #261, Opus review C1 + H1 (+ M6): a removal deletes only what the server binds to
// the purchase, and nothing automatic ever brings a removed site back.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- in-memory GCS bucket ----
const files = new Map<string, string>();
const owners = new Map<string, string>();
const fakeFile = (name: string) => ({
  name,
  metadata: owners.has(name) ? { metadata: { siteId: owners.get(name) } } : {},
  exists: async () => [files.has(name)],
  download: async () => [Buffer.from(files.get(name) ?? '')],
  delete: async () => { files.delete(name); },
});
let shopId: string | null = null;
let domainRow: any = null;
vi.mock('../../lib/publishSite.js', () => ({
  bucket: () => ({
    name: 'ab-bucket',
    file: (k: string) => fakeFile(k),
    getFiles: async ({ prefix }: { prefix: string }) => [[...files.keys()].filter((k) => k.startsWith(prefix)).map(fakeFile)],
  }),
  readPendingSite: async (slug: string) => {
    const t = files.get(`pending-sites/${slug}.json`);
    return t ? JSON.parse(t).data : null;
  },
  slugify: (s: string) => s,
}));
vi.mock('../../lib/siteSubpages.js', () => ({ findShopForSite: async () => (shopId ? { id: shopId, slug: 's', bookingsEnabled: true } : null) }));
vi.mock('../../lib/deploySite.js', () => ({ deployRenderedSite: vi.fn(async () => {}) }));
vi.mock('../../lib/ios/domainsRepo.js', () => ({
  supabaseDomains: () => ({ holdingSite: async () => domainRow, update: async () => {} }),
  SITE_HOLDING_STATES: [],
}));
vi.mock('../../lib/ios/vercelDomains.js', () => ({ liveVercelDomains: () => ({ removeProjectDomain: async () => 'ok' }) }));
vi.mock('../../lib/ios/purchases.js', async (orig) => ({ ...(await orig<any>()), supabasePurchases: () => ({}) }));

import { liveRemoveDeps, ownedPrefixes, underOwnedPrefix, draftPhotosToDelete } from '../../lib/ios/removeSiteLive.js';
import { removeSite } from '../../lib/ios/removeSite.js';
import { sweepIos } from '../../lib/ios/sweep.js';
import type { PurchaseRow } from '../../lib/ios/purchases.js';

const U = (k: string) => `https://storage.googleapis.com/ab-bucket/${k}`;
const pending = (slug: string, urls: Record<string, string>) =>
  files.set(`pending-sites/${slug}.json`, JSON.stringify({ data: { siteId: slug, imageUrlMap: urls } }));

beforeEach(() => { files.clear(); shopId = null; domainRow = null; });

describe('C1: deletion never trusts client-supplied image URLs', () => {
  it("user A's copy pointing at user B's photos deletes none of B's objects", async () => {
    files.set('b-cuts/hero-1.jpg', 'B'); files.set('ios-drafts/draftB/b1.jpg', 'B'); files.set('stock/shared.jpg', 'S');
    pending('b-cuts', { hero: U('b-cuts/hero-1.jpg'), gallery0: U('ios-drafts/draftB/b1.jpg') });
    files.set('a-cuts/own.jpg', 'A'); files.set('ios-drafts/draftA/a1.jpg', 'A');
    pending('a-cuts', {
      hero: U('a-cuts/own.jpg'), gallery0: U('ios-drafts/draftA/a1.jpg'),
      gallery1: U('b-cuts/hero-1.jpg'), gallery2: U('ios-drafts/draftB/b1.jpg'), gallery3: U('stock/shared.jpg'),
      gallery4: 'https://evil.example/ab-bucket/x.jpg', gallery5: U('pending-sites/b-cuts.json'),
    });
    await liveRemoveDeps().deleteContent('a-cuts');
    expect([...files.keys()].sort()).toEqual(['b-cuts/hero-1.jpg', 'ios-drafts/draftB/b1.jpg', 'pending-sites/b-cuts.json', 'stock/shared.jpg']);
  });

  it('a photo shared by two sites survives the removal of one', async () => {
    files.set('ios-drafts/shared/x.jpg', 'x');
    pending('a-cuts', { hero: U('ios-drafts/shared/x.jpg') });
    pending('b-cuts', { hero: U('ios-drafts/shared/x.jpg') });
    await liveRemoveDeps().deleteContent('a-cuts');
    expect(files.has('ios-drafts/shared/x.jpg')).toBe(true);
    expect(files.has('pending-sites/a-cuts.json')).toBe(false);
    expect(files.has('pending-sites/b-cuts.json')).toBe(true);
  });

  it('deletes the purchase own folders whole, a never-shared draft photo (incl. history-only ones)', async () => {
    shopId = 'aaaaaaaa-1111-2222-3333-444444444444';
    files.set('a-cuts/hero-1.jpg', '1'); files.set('a-cuts/old-gallery.jpg', '1');
    files.set(`ab-products/${shopId}/p1.jpg`, '1'); files.set('ab-products/other-shop-id-xx/p1.jpg', 'keep');
    files.set('ios-drafts/draftA/a1.jpg', '1'); files.set('ios-drafts/draftA/orphan-snapshot.jpg', '1');
    files.set('a-cuts-evil/other.jpg', 'keep'); // prefix-sibling, not under a-cuts/
    pending('a-cuts', { hero: U('ios-drafts/draftA/a1.jpg') });
    files.set('pending-sites-history/a-cuts/1.json', JSON.stringify({ data: { imageUrlMap: { hero: U('ios-drafts/draftA/orphan-snapshot.jpg') } } }));
    await liveRemoveDeps().deleteContent('a-cuts');
    expect([...files.keys()].sort()).toEqual(['a-cuts-evil/other.jpg', 'ab-products/other-shop-id-xx/p1.jpg']);
  });

  it('is idempotent: a second run over the same state succeeds and changes nothing', async () => {
    files.set('a-cuts/hero-1.jpg', '1'); files.set('b-cuts/hero.jpg', 'B'); pending('a-cuts', {});
    const d = liveRemoveDeps();
    await d.deleteContent('a-cuts');
    const after = [...files.keys()].sort();
    await d.deleteContent('a-cuts');
    expect([...files.keys()].sort()).toEqual(after);
    expect(after).toEqual(['b-cuts/hero.jpg']);
  });

  it('prefix validation: only <slug>/ and ab-products/<shop id>/, never server JSON, traversal or empty', () => {
    const p = ownedPrefixes('a-cuts', 'aaaaaaaa-1111');
    expect(p).toEqual(['a-cuts/', 'ab-products/aaaaaaaa-1111/']);
    expect(ownedPrefixes('../x', 'a/../b')).toEqual([]);
    expect(underOwnedPrefix('pending-sites/x.json', ['pending-sites/'])).toBe(false);
    expect(underOwnedPrefix('a-cuts/hero.jpg', p)).toBe(true);
    for (const k of ['a-cuts/../b-cuts/hero.jpg', '/a-cuts/x.jpg', 'a-cuts//x.jpg', 'a-cuts/', 'b-cuts/hero.jpg', 'a-cutsx/hero.jpg', '']) {
      expect(underOwnedPrefix(k, p)).toBe(false);
    }
  });

  it('draftPhotosToDelete: only ios-drafts objects of our bucket that nobody else references', () => {
    const urls = [U('ios-drafts/d1/a.jpg'), U('ios-drafts/d1/b.jpg'), U('d1/c.jpg'), U('other/hero.jpg'), U('ios-drafts/d1/../../x.jpg'), 'https://evil.example/ios-drafts/d1/a.jpg', null];
    expect(draftPhotosToDelete(urls, 'ab-bucket', new Set(['ios-drafts/d1/b.jpg']))).toEqual(['ios-drafts/d1/a.jpg']);
  });
});

describe('C1-R: a reserved or draft-shaped slug never deletes a shared folder', () => {
  const UUID = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
  const seed = () => {
    files.set('ios-drafts/d1/a.jpg', 'x'); files.set('ab-products/shop1/p.jpg', 'x'); files.set(`${UUID}/staff.jpg`, 'x');
    files.set('b-cuts/hero.jpg', 'x');
  };
  it.each(['ios-drafts', 'ab-products', UUID, 'pending-sites', 'pending-sites-history', 'admin-republish-runs', 'IOS-DRAFTS', 'ios-drafts/'])(
    'slug %j deletes no folder (only its own pending copy)', async (slug) => {
      seed(); pending(slug.replace(/\/$/, ''), {});
      shopId = null;
      await liveRemoveDeps().deleteContent(slug);
      expect([...files.keys()].filter((k) => !k.startsWith('pending-sites/')).sort())
        .toEqual([`${UUID}/staff.jpg`, 'ab-products/shop1/p.jpg', 'b-cuts/hero.jpg', 'ios-drafts/d1/a.jpg']);
    });
  it('ownedPrefixes refuses reserved, UUID, lookalike and trailing-slash slugs', () => {
    for (const s of ['ios-drafts', 'AB-PRODUCTS', 'ios_drafts', UUID, 'ios-drafts/', 'ｉｏｓ-ｄｒａｆｔｓ', 'pending-sites', '']) expect(ownedPrefixes(s, null)).toEqual([]);
    expect(ownedPrefixes('ios-drafts', 'aaaaaaaa-1111')).toEqual(['ab-products/aaaaaaaa-1111/']);
  });
  it('underOwnedPrefix refuses a reserved prefix even when handed one', () => {
    expect(underOwnedPrefix('ios-drafts/d1/a.jpg', ['ios-drafts/'])).toBe(false);
    expect(underOwnedPrefix('ab-products/shop1/p.jpg', ['ab-products/'])).toBe(false);
    expect(underOwnedPrefix(`${UUID}/staff.jpg`, [`${UUID}/`])).toBe(false);
    expect(underOwnedPrefix('ab-products/shop1/p.jpg', ['ab-products/shop1/'])).toBe(true);
  });
  it('a non-canonical slug deletes no folder', async () => {
    seed();
    await liveRemoveDeps().deleteContent('B-Cuts');
    expect(files.has('b-cuts/hero.jpg')).toBe(true);
  });
  it('an object stamped with another site as owner is skipped', async () => {
    files.set('a-cuts/mine.jpg', 'x'); files.set('a-cuts/theirs.jpg', 'x');
    owners.set('a-cuts/theirs.jpg', 'someone-else');
    await liveRemoveDeps().deleteContent('a-cuts');
    expect([...files.keys()]).toEqual(['a-cuts/theirs.jpg']);
    owners.clear();
  });
});

describe('H1: a removed site is never revived by the sweep', () => {
  const NOW = Date.parse('2026-10-25T00:00:00Z');
  const base = (): PurchaseRow => ({
    original_transaction_id: 'o1', product_id: 'p', environment: 'Production', site_slug: 'a-cuts', user_id: 'u1',
    expires_at: new Date(NOW + 30 * 86400000).toISOString(), revoked_at: null, last_notification: null,
    published_at: new Date(NOW - 86400000).toISOString(), taken_down_at: null, lapse_checked_at: null, removed_at: null,
  });
  const tx = async () => ({ originalTransactionId: 'o1', transactionId: 'o1', productId: 'p', environment: 'Production', expiresAt: NOW + 86400000, status: 1, revoked: false }) as any;

  function world() {
    const r = base();
    const repo: any = {
      unpublishedBound: vi.fn(async () => (r.published_at ? [] : [r])),
      // Deliberately ignores removed_at (as a broken/older SQL filter would): the sweep's second lock must hold.
      restoreCandidates: vi.fn(async () => (r.taken_down_at ? [r] : [])),
      takedownCandidates: vi.fn(async () => []),
      markRemoved: vi.fn(async (_o: string, at: number) => { if (!r.removed_at) r.removed_at = new Date(at).toISOString(); }),
      markTakenDown: vi.fn(async (_o: string, at: number) => { r.taken_down_at = new Date(at).toISOString(); }),
      clearTakenDown: vi.fn(async () => { r.taken_down_at = null; }),
      markLapseChecked: vi.fn(async () => {}),
      upsertVerified: vi.fn(async () => r),
    };
    return { r, repo };
  }

  it('a purge that fails halfway (stored copy still there) is NOT republished by the next sweep', async () => {
    files.set('pending-sites/a-cuts.json', JSON.stringify({ data: { siteId: 'a-cuts', imageUrlMap: {} } }));
    const { r, repo } = world();
    const deps = {
      ...liveRemoveDeps(), now: () => NOW, markRemoved: repo.markRemoved, markTakenDown: repo.markTakenDown,
      deployOffline: async () => {}, releaseDomains: async () => { throw new Error('vercel down'); },
    };
    await expect(removeSite(r, deps)).rejects.toThrow('vercel down');
    expect(files.has('pending-sites/a-cuts.json')).toBe(true); // the copy a restore would deploy
    expect(r.removed_at).not.toBeNull();
    const publish = vi.fn(async (s: string) => ({ ok: true as const, siteId: s, deployedUrl: 'x' }));
    const verify = vi.fn(tx);
    const out = await sweepIos({ repo, publish, deployOffline: async () => {}, verify }, 50, { now: () => NOW });
    expect(publish).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(repo.clearTakenDown).not.toHaveBeenCalled();
    expect(out.restored).toEqual([]);
    expect(r.taken_down_at).not.toBeNull();
  });

  it('removed rows are ignored by every sweep pass even if the repo hands them over', async () => {
    const { r, repo } = world();
    r.removed_at = new Date(NOW - 1000).toISOString(); r.taken_down_at = r.removed_at;
    repo.unpublishedBound = vi.fn(async () => [{ ...r, published_at: null, taken_down_at: null }]);
    repo.linksDue = vi.fn(async () => [{ ...r, links_due_at: r.removed_at }]);
    repo.clearLinksDue = vi.fn(async () => {});
    const publish = vi.fn(async (s: string) => ({ ok: true as const, siteId: s, deployedUrl: 'x' }));
    const out = await sweepIos({ repo, publish, deployOffline: async () => {}, verify: vi.fn(tx), stripPending: async () => {} }, 50, { now: () => NOW });
    expect(publish).not.toHaveBeenCalled();
    expect(out.published).toEqual([]); expect(out.restored).toEqual([]); expect(out.linksStripped).toEqual([]);
  });

  it('a lapse-only takedown (no removed_at) still restores on resubscribe', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { r, repo } = world();
    r.taken_down_at = new Date(NOW - 1000).toISOString();
    const publish = vi.fn(async (s: string) => ({ ok: true as const, siteId: s, deployedUrl: 'x' }));
    const out = await sweepIos({ repo, publish, deployOffline: async () => {}, verify: vi.fn(tx) }, 50, { now: () => NOW });
    expect(out.restored).toEqual(['a-cuts']);
  });

  it('removal stamps removed_at before the offline deploy and before anything is deleted', async () => {
    const log: string[] = [];
    const { r } = world();
    await removeSite(r, {
      now: () => 1, markRemoved: async () => { log.push('removed'); }, markTakenDown: async () => { log.push('taken'); },
      deployOffline: async () => { log.push('offline'); }, releaseDomains: async () => { log.push('domain'); }, deleteContent: async () => { log.push('content'); },
    });
    expect(log).toEqual(['removed', 'taken', 'offline', 'domain', 'content']);
  });

  it('if the removed_at stamp fails nothing else happens (fail closed)', async () => {
    const { r } = world();
    const d = { now: () => 1, markRemoved: vi.fn(async () => { throw new Error('column missing'); }), markTakenDown: vi.fn(), deployOffline: vi.fn(), releaseDomains: vi.fn(), deleteContent: vi.fn() };
    await expect(removeSite(r, d as any)).rejects.toThrow('column missing');
    expect(d.markTakenDown).not.toHaveBeenCalled();
    expect(d.deleteContent).not.toHaveBeenCalled();
  });
});

describe('M6: a custom domain purchase in flight is not detached', () => {
  it.each(['reserved', 'buying', 'ordered'])('%s: removal refuses until the domain sweep resolves it', async (state) => {
    domainRow = { state, simulated: false, domain: 'x.com', original_transaction_id: 'o1' };
    await expect(liveRemoveDeps().releaseDomains('a-cuts')).rejects.toThrow(/in progress/);
  });
  it('an attached domain is released', async () => {
    domainRow = { state: 'live', simulated: false, domain: 'x.com', original_transaction_id: 'o1' };
    await expect(liveRemoveDeps().releaseDomains('a-cuts')).resolves.toBeUndefined();
  });
});
