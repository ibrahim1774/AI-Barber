import { checkBookingLink, toShopSite, manualSite } from '@/lib/importer';
import { api } from '@/lib/api';

const booksy = require('./fixtures/scrape-booksy.json');
const gbp = require('./fixtures/import-business.json');

describe('importer', () => {
  it('unsupported host is rejected before calling the API', () => {
    const spy = jest.spyOn(api, 'importScrape');
    const r = checkBookingLink('https://example.com/my-shop');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/isn't Booksy/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('empty input asks for the booking link', () => {
    const r = checkBookingLink('   ');
    expect(r).toEqual({ ok: false, message: 'Paste your booking link to continue.' });
  });

  it('extracts a supported URL out of a share sentence', () => {
    const r = checkBookingLink("I'm using Willi Barber. Check it out on Booksy here: https://booksy.com/en-us/dl/show-business/998736");
    expect(r).toEqual({ ok: true, url: 'https://booksy.com/en-us/dl/show-business/998736' });
  });

  it('toShopSite marks importedFrom booking', () => {
    const { inputs, site } = toShopSite(booksy, 'https://booksy.com/en-us/dl/show-business/998736', 'booking');
    expect(inputs.importedFrom).toBe('booking');
    expect(site.shopName).toBe(booksy.shopName);
  });

  it('gbp import maps hours and reviews', () => {
    const { inputs, site } = toShopSite(gbp, '', 'gbp');
    expect(inputs.importedFrom).toBe('gbp');
    expect(site.shopName).toBe(gbp.shopName);
    expect(site.hours?.length ?? (site as any).about?.hours?.length ?? 0).toBeGreaterThan(0);
    expect(JSON.stringify(site)).toContain(gbp.reviews[0].author);
  });

  it('seeds the default barber menu for an empty-services Google listing without mutating the payload', () => {
    const before = JSON.stringify(gbp);
    const { site } = toShopSite(gbp, '', 'gbp');
    expect(JSON.stringify(gbp)).toBe(before);
    expect(site.services.length).toBeGreaterThan(0);
  });

  it('manualSite generates from the shop name', async () => {
    const { inputs, site } = await manualSite('Fade Lab');
    expect(inputs.shopName).toBe('Fade Lab');
    expect(site.shopName).toBeTruthy();
  });
});
