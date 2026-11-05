// Review 6c open point: the unauthenticated save-pending-site must not accept a server approval minted for another account or another site.
// Everything is mocked (storage and owner lookup); no network.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('@google-cloud/storage', () => ({
  Storage: class { bucket() { return { file: (name: string) => ({ save: async (data: string) => { store.set(name, data); }, delete: async () => {}, exists: async () => [store.has(name)], download: async () => [Buffer.from(store.get(name)!)] }) }; } },
}));

import { savePendingSite } from '../../api/save-pending-site.js';
import { readPendingSite, renderPendingBundle } from '../../lib/publishSite';
import { stampApproval } from '../../lib/serviceCopy/approval';
import { GOOD_JSON, TEST_SECRET, U1, U2, site } from './helpers';

const text = { v: 1 as const, aiGenerated: true, ...GOOD_JSON };
const stamp = (user: string, where: { slug?: string; draftId?: string }, mode: 'owner' | 'auto' = 'owner', key = 'scalp massage', secret = TEST_SECRET) =>
  stampApproval(secret, { userId: user, ...where }, key, 'Barbershop', text as never, mode) as any;
const withCopy = (copy: Record<string, unknown>) => site({ extraPages: { on: ['faq'], serviceGuides: true, seed: 7, svcCopy: copy } });
const res = () => { const r: any = { statusCode: 0, body: undefined }; r.setHeader = () => r; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.end = () => r; return r; };
const deps = (owner: string | null | Error | undefined) => ({
  isAppSlug: vi.fn(async () => false), isPublished: vi.fn(async () => false),
  ...(owner === undefined ? {} : { ownerOf: vi.fn(async () => { if (owner instanceof Error) throw owner; return owner; }) }),
});
const post = async (slug: string, siteData: unknown, d = deps(U1)) => {
  const r = res();
  await savePendingSite({ method: 'POST', body: { siteId: slug, data: { siteId: slug, siteData, imageUrlMap: {} } } }, r, d);
  return { r, saved: store.has(`pending-sites/${slug}.json`) ? JSON.parse(store.get(`pending-sites/${slug}.json`)!).data.siteData : null };
};
const kept = (o: { saved: any }) => o.saved?.extraPages?.svcCopy;

beforeEach(() => {
  store.clear();
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('save-pending-site: a replayed approval cannot print', () => {
  it('the genuine case: text stamped to this slug for this slug\'s recorded owner is kept', async () => {
    const o = await post('shop-a', withCopy({ 'scalp massage': stamp(U1, { slug: 'shop-a' }) }));
    expect(o.r.statusCode).toBe(200); expect(Object.keys(kept(o))).toEqual(['scalp massage']);
  });
  it('CROSS-ACCOUNT: a stamp minted for account A posted to a slug owned by account B is dropped (the rest of the payload still saves)', async () => {
    const o = await post('shop-b', withCopy({ 'scalp massage': stamp(U1, { slug: 'shop-b' }) }), deps(U2));
    expect(o.r.statusCode).toBe(200); expect(kept(o)).toBeUndefined(); expect(o.saved.shopName).toBeDefined();
  });
  it('CROSS-SITE: a stamp minted for site A posted under site B (same account or not) is dropped', async () => {
    for (const owner of [U1, U2]) {
      const o = await post('shop-b', withCopy({ 'scalp massage': stamp(U1, { slug: 'shop-a' }) }), deps(owner));
      expect(o.r.statusCode).toBe(200); expect(kept(o)).toBeUndefined();
    }
  });
  it('a draft stamp, a tampered text, a wrong service key, an expired draft stamp and a forged signature are dropped', async () => {
    const good = stamp(U1, { slug: 'shop-a' });
    const cases: any[] = [
      stamp(U1, { draftId: 'draft-1' }), { ...good, intro: good.intro.replace('Learn', 'Study') }, stamp(U1, { slug: 'shop-a' }, 'owner', 'eyebrow styling'),
      { ...good, approvalSig: 'a'.repeat(64) }, { ...text, approval: 'owner' }, stamp(U1, { slug: 'shop-a' }, 'owner', 'scalp massage', 'another-secret-0123456789abcdef'),
    ];
    for (const c of cases) { const o = await post('shop-a', withCopy({ 'scalp massage': c })); expect(o.r.statusCode).toBe(200); expect(kept(o)).toBeUndefined(); }
  });
  it('owner unknown (none recorded, lookup throws, no lookup configured) = fail closed: dropped, never a 500', async () => {
    for (const d of [deps(null), deps(new Error('db down')), deps(undefined)]) {
      const o = await post('shop-a', withCopy({ 'scalp massage': stamp(U1, { slug: 'shop-a' }) }), d);
      expect(o.r.statusCode).toBe(200); expect(kept(o)).toBeUndefined();
    }
  });
  it('signing secret unset: dropped, never a 500', async () => {
    const prev = process.env.SERVICE_COPY_SIGNING_SECRET;
    delete process.env.SERVICE_COPY_SIGNING_SECRET;
    try { const o = await post('shop-a', withCopy({ 'scalp massage': stamp(U1, { slug: 'shop-a' }) })); expect(o.r.statusCode).toBe(200); expect(kept(o)).toBeUndefined(); }
    finally { process.env.SERVICE_COPY_SIGNING_SECRET = prev; }
  });
  it('a payload with no model text does not call the owner lookup', async () => {
    const d = deps(U1);
    await post('shop-a', site(), d);
    expect((d as any).ownerOf).not.toHaveBeenCalled();
  });
});

describe('a stored copy cannot say which site it is', () => {
  it('readPendingSite takes siteId from the storage key, so a body claiming another site\'s id cannot borrow that site\'s approvals', async () => {
    const signedForA = stamp(U1, { slug: 'shop-a' });
    // the body of shop-b's object claims to be shop-a (a client can write any body through save-pending-site)
    store.set('pending-sites/shop-b.json', JSON.stringify({ siteId: 'shop-b', data: { siteId: 'shop-a', siteData: withCopy({ 'scalp massage': signedForA }), imageUrlMap: {} } }));
    const read = await readPendingSite('shop-b');
    expect(read?.siteId).toBe('shop-b');
    const html = renderPendingBundle(read!, { siteBaseUrl: 'https://x.example.com' }).pages.map((p) => p.html).join('\n');
    expect(html).not.toContain('Learn what the service involves');
    store.set('pending-sites/shop-a.json', JSON.stringify({ siteId: 'shop-a', data: { siteData: withCopy({ 'scalp massage': signedForA }), imageUrlMap: {} } }));
    const own = await readPendingSite('shop-a');
    expect(renderPendingBundle(own!, { siteBaseUrl: 'https://x.example.com' }).pages.map((p) => p.html).join('\n')).toContain('Learn what the service involves');
  });
});
