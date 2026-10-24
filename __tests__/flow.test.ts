import { track } from '@/lib/analytics';
import { importBooking, importListing, startDraft } from '@/lib/flow';
import { clearSite, loadSite, saveSite, type SiteRecord } from '@/lib/siteStore';
import { toShopSite } from '@/lib/importer';
import type { ShopInputs, WebsiteData } from '@/web/types';

// The moduleNameMapper stand-in exports a plain function; a jest.fn is needed
// to assert the site_generated call.
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

const booksy = require('./fixtures/scrape-booksy.json');
const gbp = require('./fixtures/import-business.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(async () => {
  await clearSite();
  (track as jest.Mock).mockClear();
});

test('startDraft saves a draft and returns it with a uuid', async () => {
  const result = toShopSite(booksy, 'https://booksy.com/en-us/dl/show-business/998736', 'booking');
  const before = Date.now();
  const rec = await startDraft(result);

  expect(rec.draftId).toMatch(UUID);
  expect(rec.inputs).toEqual(result.inputs);
  // A newly generated site opts in to multi-page (P3b): every eligible page on, default order.
  expect(rec.data).toEqual({ ...result.site, pages: { order: [], hidden: [] } });
  expect(rec.slug).toBeNull();
  expect(rec.deployedUrl).toBeNull();
  expect(rec.transactionId).toBeNull();
  expect(rec.updatedAt).toBeGreaterThanOrEqual(before);
  expect(await loadSite()).toEqual(rec);
  expect(track).toHaveBeenCalledWith('site_generated', { importedFrom: 'booking' });
});

test('a fresh install gets a new draft id each time', async () => {
  const result = toShopSite(booksy, '', 'gbp');
  const a = await startDraft(result);
  await clearSite();
  const b = await startDraft(result);
  expect(a.draftId).not.toBe(b.draftId);
  expect(track).toHaveBeenLastCalledWith('site_generated', { importedFrom: 'gbp' });
});

test('new content keeps the existing site: draftId, slug, deployedUrl and transactionId carry forward', async () => {
  const published: SiteRecord = {
    draftId: 'd-live',
    inputs: { shopName: 'Old Name', area: '', phone: '' } as ShopInputs,
    data: { shopName: 'Old Name' } as WebsiteData,
    updatedAt: 1,
    slug: 'old-name',
    deployedUrl: 'https://old-name.vercel.app',
    transactionId: 'tx-123',
  };
  await saveSite(published);

  const result = toShopSite(gbp, '', 'gbp');
  const rec = await startDraft(result);

  expect(rec.draftId).toBe('d-live');
  expect(rec.slug).toBe('old-name');
  expect(rec.deployedUrl).toBe('https://old-name.vercel.app');
  expect(rec.transactionId).toBe('tx-123');
  expect(rec.inputs.shopName).toBe('Kings Barber Shop & Unisex');
  expect(rec.data.shopName).toBe('Kings Barber Shop & Unisex');
  expect(rec.updatedAt).toBeGreaterThan(1);
  expect(await loadSite()).toEqual(rec);
});

test('a manual site tracks importedFrom manual', async () => {
  const inputs = { shopName: 'Fresh Cuts', area: '', phone: '' } as ShopInputs;
  await startDraft({ inputs, site: { shopName: 'Fresh Cuts' } as WebsiteData });
  expect(track).toHaveBeenCalledWith('site_generated', { importedFrom: 'manual' });
});

describe('import helpers', () => {
  const realFetch = global.fetch;
  const mockFetch = jest.fn();
  const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  beforeEach(() => {
    mockFetch.mockReset();
    (global as any).fetch = mockFetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });
  const sentBody = () => JSON.parse(mockFetch.mock.calls[0][1].body);

  test('importBooking scrapes the link and keeps it as the fallback booking url', async () => {
    mockFetch.mockResolvedValue(ok(booksy));
    const url = 'https://booksy.com/en-us/dl/show-business/998736';
    const r = await importBooking(url, '#3b82f6');
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/api\/import-scrape$/);
    expect(sentBody()).toEqual({ url });
    expect(r.inputs.importedFrom).toBe('booking');
    expect(r.inputs.shopName).toBe('Willi Barber');
    expect(r.inputs.bookingUrl).toBe(url); // the payload has none, so the link is the fallback
    expect(r.inputs.colorTheme).toBe('#3b82f6');
    expect(r.site.services).toHaveLength(4); // Booksy's own menu
  });

  test('importListing imports a picked candidate by its place_id Maps URL', async () => {
    mockFetch.mockResolvedValue(ok(gbp));
    const r = await importListing({ placeId: 'ChIJabc' }, '#22c55e');
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/api\/import-business$/);
    expect(sentBody()).toEqual({ url: 'https://www.google.com/maps/place/?q=place_id:ChIJabc' });
    expect(r.inputs.importedFrom).toBe('gbp');
    expect(r.inputs.shopName).toBe('Kings Barber Shop & Unisex');
    expect(r.inputs.phone).toBe('(718) 513-4171');
    expect(r.inputs.colorTheme).toBe('#22c55e');
    expect(r.site.services).toEqual([]); // honest sites: no default menu without ticks
  });

  test('importListing imports a picked suggestion by "name, address"', async () => {
    mockFetch.mockResolvedValue(ok(gbp));
    await importListing({ query: "Jack's Barbershop, 12 Main St, Houston, TX" });
    expect(sentBody()).toEqual({ url: "Jack's Barbershop, 12 Main St, Houston, TX" });
  });
});
