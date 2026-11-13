// Regression: the real shape of a site imported from a website (anonymised), through runWebPublish and the real renderer.
import { describe, expect, it, vi } from 'vitest';
import draft from './fixtures/websiteImportDraft.json' with { type: 'json' };
import { runWebPublish } from '../../lib/webApp/publishFlow.js';
import { renderPending } from '../../lib/publishSite.js';
import { finalizePages } from '../../lib/deploySite.js';
import { restoreImageUrls } from '../../lib/ios/siteShape.js';
import type { RehostDeps } from '../../lib/rehostImages.js';

process.env.GCS_BUCKET_NAME = 'primehub-site-assets';
const FOREIGN = 'd2zdpiztbgorvt.cloudfront.net';
const USER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';

function harness(over: Partial<RehostDeps> = {}) {
  const store = new Map<string, Buffer>();
  const rehost: RehostDeps = {
    bucketName: 'primehub-site-assets',
    fetchImage: async () => ({ buffer: Buffer.from('x'), contentType: 'image/jpeg' }),
    exists: async (s, f) => store.has(`${s}/${f}`),
    upload: vi.fn(async (s, f, b) => { store.set(`${s}/${f}`, b); return `https://storage.googleapis.com/primehub-site-assets/${s}/${f}`; }),
    urlOf: (s, f) => `https://storage.googleapis.com/primehub-site-assets/${s}/${f}`,
    ...over,
  };
  const pending = new Map<string, any>(), sites = new Map<string, any>(), owners = new Map<string, any>();
  const deployed: string[] = [];
  const d: any = {
    environment: 'live', userOf: async () => ({ id: USER, email: 'o@example.com' }),
    entitlementOf: async () => ({ stripe_subscription_id: 'sub_1', stripe_customer_id: 'c', user_id: USER, site_slug: null, tier: 'website', billing_interval: 'month', status: 'active', environment: 'live', current_period_end: null, cancel_at_period_end: false }),
    sites: { byUser: async () => [...sites.values()][0] ?? null, get: async (s: string) => sites.get(s) ?? null,
      insertIfAbsent: async (r: any) => { sites.set(r.slug, { ...r, published_at: null, taken_down_at: null, removed_at: null }); return true; }, releaseUnpublished: async () => {}, markPublished: async () => {} },
    owners: { get: async (s: string) => owners.get(s) ?? null, insertIfAbsent: async (r: any) => { owners.set(r.slug, r); return true; } },
    isTaken: async () => false, readPending: async (s: string) => pending.get(s) ?? null, writePending: async (s: string, p: any) => { pending.set(s, p); },
    publish: vi.fn(async (slug: string) => {
      const p = pending.get(slug);
      const pages = finalizePages(renderPending(p), p.imageUrlMap, slug);
      for (const pg of pages) deployed.push(pg.html);
      return { ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app` };
    }),
    render: undefined, rememberSlug: async () => {}, now: () => 1_800_000_000_000, rehost,
  };
  return { d, pending, deployed, rehost };
}

describe('real website-import draft', () => {
  it('no foreign photo URL stays in the deployed pages or the stored copy', async () => {
    const h = harness();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'info').mockImplementation((m: any) => { logs.push(String(m)); });
    const r = await runWebPublish({ siteData: structuredClone(draft) }, h.d, { authorization: 'Bearer t' });
    spy.mockRestore();
    expect(r.status).toBe(200);
    const stored = [...h.pending.values()][0];
    expect(JSON.stringify(stored)).not.toContain(FOREIGN);
    expect(JSON.stringify(restoreImageUrls(stored.siteData, stored.imageUrlMap))).not.toContain(FOREIGN);
    expect(h.deployed.length).toBeGreaterThan(0);
    expect(h.deployed.join('\n')).not.toContain(FOREIGN);
    expect(h.deployed.join('\n')).toContain('storage.googleapis.com/primehub-site-assets/');
    expect(h.rehost.upload).toHaveBeenCalledTimes(8);
    expect(logs.some((l) => /^\[rehost\] .+: 8 copied, 0 reused, 0 kept$/.test(l))).toBe(true);
  });
});
