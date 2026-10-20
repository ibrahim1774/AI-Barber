import { track } from '@/lib/analytics';
import { importBooking, importListing, startDraft } from '@/lib/flow';
import { clearSite, loadSite } from '@/lib/siteStore';
import { toShopSite } from '@/lib/importer';
import type { ShopInputs, WebsiteData } from '@/web/types';

jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

const booksy = require('./fixtures/scrape-booksy.json');
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
  expect(rec.data).toEqual(result.site);
  expect(rec.slug).toBeNull();
  expect(rec.deployedUrl).toBeNull();
  expect(rec.transactionId).toBeNull();
  expect(rec.updatedAt).toBeGreaterThanOrEqual(before);
  expect(await loadSite()).toEqual(rec);
  expect(track).toHaveBeenCalledWith('site_generated', { importedFrom: 'booking' });
});

test('each draft gets a new id and replaces the stored one', async () => {
  const result = toShopSite(booksy, '', 'gbp');
  const a = await startDraft(result);
  const b = await startDraft(result);
  expect(a.draftId).not.toBe(b.draftId);
  expect((await loadSite())?.draftId).toBe(b.draftId);
  expect(track).toHaveBeenLastCalledWith('site_generated', { importedFrom: 'gbp' });
});

test('a manual site tracks importedFrom manual', async () => {
  const inputs = { shopName: 'Fresh Cuts', area: '', phone: '' } as ShopInputs;
  await startDraft({ inputs, site: { shopName: 'Fresh Cuts' } as WebsiteData });
  expect(track).toHaveBeenCalledWith('site_generated', { importedFrom: 'manual' });
});

describe('import helpers', () => {
  const gbp = require('./fixtures/import-business.json');
  const mockFetch = jest.fn();
  const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  beforeEach(() => {
    mockFetch.mockReset();
    (global as any).fetch = mockFetch;
  });
  const sentBody = () => JSON.parse(mockFetch.mock.calls[0][1].body);

  test('importBooking scrapes the link and keeps it as the fallback booking url', async () => {
    mockFetch.mockResolvedValue(ok(booksy));
    const url = 'https://booksy.com/en-us/dl/show-business/998736';
    const r = await importBooking(url, '#3b82f6');
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/api\/import-scrape$/);
    expect(sentBody()).toEqual({ url });
    expect(r).toEqual(toShopSite(booksy, url, 'booking', '#3b82f6'));
  });

  test('importListing imports a picked candidate by its place_id Maps URL', async () => {
    mockFetch.mockResolvedValue(ok(gbp));
    const r = await importListing({ placeId: 'ChIJabc' }, '#22c55e');
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/api\/import-business$/);
    expect(sentBody()).toEqual({ url: 'https://www.google.com/maps/place/?q=place_id:ChIJabc' });
    expect(r).toEqual(toShopSite(gbp, '', 'gbp', '#22c55e'));
    expect(r.inputs.importedFrom).toBe('gbp');
  });

  test('importListing imports a picked suggestion by "name, address"', async () => {
    mockFetch.mockResolvedValue(ok(gbp));
    await importListing({ query: "Jack's Barbershop, 12 Main St, Houston, TX" });
    expect(sentBody()).toEqual({ url: "Jack's Barbershop, 12 Main St, Houston, TX" });
  });
});
