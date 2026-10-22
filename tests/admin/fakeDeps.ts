import { vi } from 'vitest';
import type { AdminSitesDeps, RepublishRun, SiteStore } from '../../lib/admin/sites.js';
import { buildImageUrlMap, toPendingSiteData } from '../../lib/ios/pendingData.js';
import type { PurchaseRow } from '../../lib/ios/purchases.js';
import { renderPending, type PendingSite, type PublishOutcome } from '../../lib/publishSite.js';
import type { WebsiteData } from '../../types.js';

export const NOW = 1_800_000_000_000;
export const DAY = 86_400_000;
export const iso = (ms: number) => new Date(ms).toISOString();
export const P = 'com.ibrahim1774.aibarber.';

export function site(over: Partial<WebsiteData> = {}): WebsiteData {
  return {
    shopName: 'Fade Lab',
    area: 'Austin',
    phone: '555-0100',
    hero: { heading: 'H', tagline: 'T', imageUrl: 'https://img.example/hero.jpg' },
    about: { heading: 'A', description: ['d'], imageUrl: '' },
    services: [{ title: 'Fade', subtitle: '', description: '', icon: 'scissors', imageUrl: '', price: '$30' }],
    gallery: ['https://img.example/g0.jpg'],
    contact: { address: '1 Main St', email: '' },
    ...over,
  } as WebsiteData;
}

export function stored(slug: string, sd: WebsiteData = site(), over: Partial<PendingSite> = {}): PendingSite {
  const map = buildImageUrlMap(sd);
  return { siteId: slug, siteData: toPendingSiteData(sd, map), imageUrlMap: map, deployedUrl: `https://${slug}.vercel.app`, ...over };
}

export function purchase(slug: string, over: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    original_transaction_id: `otid-${slug}`, product_id: `${P}store.monthly`, environment: 'Production',
    site_slug: slug, user_id: `user-${slug}`, expires_at: iso(NOW + 10 * DAY), revoked_at: null, last_notification: null,
    published_at: iso(NOW - 10 * DAY), taken_down_at: null, lapse_checked_at: null, ...over,
  };
}

export function fakes(opts: { rows?: PurchaseRow[]; pending?: Record<string, PendingSite>; outcome?: (slug: string) => PublishOutcome } = {}) {
  const rows = opts.rows ?? [purchase('fade-lab')];
  const pending = new Map<string, PendingSite>(Object.entries(opts.pending ?? { 'fade-lab': stored('fade-lab', site(), { version: 3, editedBy: 'owner' }) }));
  const history = new Map<string, PendingSite>();
  const runs = new Map<string, RepublishRun>();
  const events: any[] = [];
  let clock = NOW;
  const store: SiteStore = {
    readPending: vi.fn(async (slug: string) => (pending.has(slug) ? structuredClone(pending.get(slug)!) : null)),
    writePending: vi.fn(async (slug: string, p: PendingSite) => { pending.set(slug, structuredClone(p)); }),
    // Mirrors gcsSiteStore: write-once; same content reuses the id, different content gets "{v}-{ms}".
    writeHistory: vi.fn(async (slug: string, version: number, p: PendingSite) => {
      const id = String(version);
      const existing = history.get(`${slug}/${id}`);
      if (!existing) { history.set(`${slug}/${id}`, structuredClone(p)); return id; }
      if (JSON.stringify(existing) === JSON.stringify(p)) return id;
      const unique = `${version}-${clock}`;
      history.set(`${slug}/${unique}`, structuredClone(p));
      return unique;
    }),
    readHistory: vi.fn(async (slug: string, id: string) => history.get(`${slug}/${id}`) ?? null),
    listHistory: vi.fn(async (slug: string) =>
      [...history.entries()].filter(([k]) => k.startsWith(`${slug}/`)).map(([k, p]) => {
        const id = k.split('/')[1];
        return { id, version: Number(id.split('-')[0]), editedBy: p.editedBy ?? null, editedAt: p.editedAt ?? null };
      }).sort((a, b) => b.version - a.version || b.id.length - a.id.length)),
    readRun: vi.fn(async (id: string) => (runs.has(id) ? structuredClone(runs.get(id)!) : null)),
    writeRun: vi.fn(async (id: string, r: RepublishRun) => { runs.set(id, structuredClone(r)); }),
  };
  const deps: AdminSitesDeps = {
    listBound: vi.fn(async () => rows.map((r) => ({ ...r }))),
    findBySlug: vi.fn(async (slug: string) => rows.find((r) => r.site_slug === slug) ?? null),
    emailsByUserId: vi.fn(async () => new Map(rows.filter((r) => r.user_id).map((r) => [r.user_id!, `${r.site_slug}@mail.test`]))),
    store,
    publish: vi.fn(async (slug: string) =>
      opts.outcome ? opts.outcome(slug) : { ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app`, alreadyLive: false }),
    render: vi.fn((p: Pick<PendingSite, 'siteData' | 'imageUrlMap'>) => renderPending(p)),
    audit: vi.fn(async (e) => { events.push(e); }),
    now: () => clock,
  };
  return { deps, store, pending, history, runs, events, tick: (ms: number) => { clock += ms; } };
}

