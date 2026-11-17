// extraPages.searchPages: the paths that are not the iOS publish. Admin edits (api/save-pending-site.ts), the lapse sweeps (lib/ios/tiers.ts
// stripLapsedLinks) and the service-text endpoint. The mark travels untouched; an unmarked site is stored exactly as sent; model-written text
// stays web-only (the endpoint still reads a web draft and refuses a site that is not web-made).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('@google-cloud/storage', () => ({
  Storage: class { bucket() { return { file: (name: string) => ({ save: async (data: string) => { store.set(name, data); }, delete: async () => {}, exists: async () => [store.has(name)], download: async () => [Buffer.from(store.get(name)!)] }) }; } },
}));

import { savePendingSite } from '../../api/save-pending-site.js';
import { stripLapsedLinks } from '../../lib/ios/tiers';
import { rig, site, GOOD_JSON } from './helpers';

const res = () => { const r: any = { statusCode: 0, body: undefined }; r.setHeader = () => r; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.end = () => r; return r; };
const deps = { isAppSlug: vi.fn(async () => false), isPublished: vi.fn(async () => false), ownerOf: vi.fn(async () => null) };
const admin = async (slug: string, siteData: unknown) => {
  const r = res();
  await savePendingSite({ method: 'POST', body: { siteId: slug, data: { siteId: slug, siteData, imageUrlMap: {} } } }, r, deps);
  return { r, saved: store.has(`pending-sites/${slug}.json`) ? JSON.parse(store.get(`pending-sites/${slug}.json`)!).data.siteData : null };
};
const iosShaped = (extraPages: Record<string, unknown>) => { const s = site({ extraPages }); delete s.source; return s; };

beforeEach(() => {
  store.clear();
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('admin edit (save-pending-site)', () => {
  it('an iOS site WITHOUT the mark is stored exactly as sent', async () => {
    const sd = iosShaped({ on: ['faq'], serviceGuides: true, seed: 7 });
    const o = await admin('shop-a', sd);
    expect(o.r.statusCode).toBe(200);
    expect(o.saved).toEqual(sd);
    expect(o.saved.source).toBeUndefined();
    expect(o.saved.extraPages.searchPages).toBeUndefined();
  });
  it('an iOS site WITH the mark keeps the mark and gains no source', async () => {
    const sd = iosShaped({ on: ['faq'], serviceGuides: true, seed: 7, searchPages: true });
    const o = await admin('shop-b', sd);
    expect(o.r.statusCode).toBe(200);
    expect(o.saved).toEqual(sd);
    expect(o.saved.extraPages.searchPages).toBe(true);
    expect(o.saved.source).toBeUndefined();
  });
  it('model-written text with no approval is still dropped on a marked site (same as before)', async () => {
    const sd = iosShaped({ on: ['faq'], serviceGuides: true, seed: 7, searchPages: true, svcCopy: { 'scalp massage': { v: 1, aiGenerated: true, ...GOOD_JSON, approval: 'owner' } } });
    const o = await admin('shop-c', sd);
    expect(o.saved.extraPages.svcCopy).toBeUndefined();
    expect(o.saved.extraPages.searchPages).toBe(true);
  });
});

describe('lapse and takedown paths', () => {
  it('stripLapsedLinks (the lapse sweep) keeps the mark and never adds a mark to an unmarked site', () => {
    const marked = iosShaped({ on: [], serviceGuides: true, searchPages: true });
    const plain = iosShaped({ on: [], serviceGuides: true });
    expect((stripLapsedLinks(marked, 'com.ibrahim1774.aibarber.hosting.monthly') as any).extraPages.searchPages).toBe(true);
    expect((stripLapsedLinks(plain, 'com.ibrahim1774.aibarber.hosting.monthly') as any).extraPages).toEqual(plain.extraPages);
  });
});

describe('service text endpoint stays web-only', () => {
  it('a draft that carries the mark but is not web-made is refused (model text is never written for it)', async () => {
    const r = rig({ siteData: iosShaped({ on: ['faq'], serviceGuides: true, seed: 7, searchPages: true }), writeMode: true });
    const out = await r.call({ titleKey: 'scalp massage', mode: 'write' });
    expect(out.code).toBe(403);
    expect(out.body).toEqual({ error: 'not_available' });
  });
  it('the same data stamped web-made is let through the gate (control)', async () => {
    const r = rig({ siteData: { ...iosShaped({ on: ['faq'], serviceGuides: true, seed: 7, searchPages: true }), source: 'web-app' }, writeMode: true });
    const out = await r.call({ titleKey: 'scalp massage', mode: 'write' });
    expect(out.code).not.toBe(403);
  });
});
