import { checkBookingLink, toShopSite, manualSite } from '@/lib/importer';
import { servicesFromPicks } from '@/lib/serviceChecklist';
import { scratchPicks } from '@/lib/scratchDefaults';
import { gallerySlots } from '@/lib/sections/gallery';
import { stockPhotoPaths } from '@/lib/editor';
import { importCounts } from '@/lib/importReview';
import { eligiblePages } from '@/web/lib/render/pages';
import { renderSite } from '@/lib/render';
import { DEFAULT_SWATCH } from '@/web/lib/brandSwatches';

const booksy = require('./fixtures/scrape-booksy.json');
const gbp = require('./fixtures/import-business.json');

describe('importer', () => {
  it('checkBookingLink rejects an unsupported host', () => {
    const r = checkBookingLink('https://example.com/my-shop');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/isn't Booksy/);
  });

  it('empty input asks for the booking link', () => {
    const r = checkBookingLink('   ');
    expect(r).toEqual({ ok: false, message: 'Paste your booking link to continue.' });
  });

  it('text that is not a link says so, instead of reading as empty', () => {
    const r = checkBookingLink('not a link');
    expect(r).toEqual({ ok: false, message: "That doesn't look like a valid link. Paste the full booking link from Booksy, theCut, Fresha, Square, Vagaro or StyleSeat." });
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
    expect(site.hours).toHaveLength(gbp.hours.length);
    expect(JSON.stringify(site)).toContain(gbp.reviews[0].author);
  });

  it('honest sites: an empty-services Google listing gets no invented menu, and the payload is not mutated', () => {
    const before = JSON.stringify(gbp);
    const { site } = toShopSite(gbp, '', 'gbp');
    expect(JSON.stringify(gbp)).toBe(before);
    expect(site.services).toEqual([]);
  });

  it('default import carries the default swatch colorTheme on inputs and site', () => {
    const { inputs, site } = toShopSite(booksy, '', 'booking');
    expect(inputs.colorTheme).toBe('#f4a100');
    expect(site.colorTheme).toBe('#f4a100');
  });

  it('honours a passed swatch and ignores a non-swatch colour', () => {
    const a = toShopSite(booksy, '', 'booking', '#3B82F6');
    expect(a.site.colorTheme).toBe('#3b82f6');
    expect(a.inputs.colorTheme).toBe('#3b82f6');
    const b = toShopSite(booksy, '', 'booking', '#123456');
    expect(b.inputs.colorTheme).toBeUndefined();
  });

  it('manualSite writes the address, area, phone and the place label, and no reviews', async () => {
    const r = await manualSite({ shopName: 'Fade Lab', area: 'Austin, TX', address: '512 Congress Ave, Austin, TX', phone: '(512) 555-0142', place: 'Downtown', colorTheme: DEFAULT_SWATCH });
    expect(r.site.contact.address).toBe('512 Congress Ave, Austin, TX');
    expect(r.site.area).toBe('Austin, TX');
    expect(r.site.phone).toBe('(512) 555-0142');
    expect(r.site.labels?.pgPlace).toBe('Downtown');
    expect(r.site.reviews ?? []).toHaveLength(0);
    expect(r.inputs).toMatchObject({ shopName: 'Fade Lab', area: 'Austin, TX', phone: '(512) 555-0142' });
    const noPlace = await manualSite({ shopName: 'A', area: 'Austin, TX', address: 'Austin, TX', phone: '(512) 555-0142', colorTheme: DEFAULT_SWATCH });
    expect(noPlace.site.labels?.pgPlace).toBeUndefined();
  });

  const SCRATCH = { shopName: 'Fade Lab', area: 'Austin, TX', address: '512 Congress Ave, Austin, TX', phone: '(512) 555-0142', colorTheme: DEFAULT_SWATCH };

  it('a scratch site mimics an import: sample gallery, ticked services, no reviews; unticking everything gives no services', async () => {
    const r = await manualSite({ ...SCRATCH, services: servicesFromPicks(scratchPicks()) });
    expect(r.site.services.map((s) => s.title)).toEqual(['Haircut', 'Beard trim', 'Haircut & beard']);
    expect(gallerySlots(r.site).filter((i) => r.site.gallery[i]).length).toBe(6);
    expect(stockPhotoPaths(r.site).length).toBeGreaterThanOrEqual(6);
    expect(importCounts(r.site)).toMatchObject({ photos: 0, reviews: 0 });
    expect(eligiblePages(r.site)).toEqual(expect.arrayContaining(['home', 'services']));
    expect(eligiblePages(r.site)).not.toContain('reviews');
    expect(eligiblePages(r.site)).not.toContain('gallery');
    const none = await manualSite({ ...SCRATCH, services: undefined });
    expect(none.site.services).toEqual([]);
    expect(eligiblePages(none.site)).not.toContain('services');
  });

  it('the rendered scratch home page has a gallery and services and no reviews section', async () => {
    const r = await manualSite({ ...SCRATCH, services: servicesFromPicks(scratchPicks()) });
    const html = renderSite(r.site);
    expect(html).toContain('{{gallery2}}');
    expect(html).toContain('Haircut');
    expect(html).not.toMatch(/Reviews from|Selected reviews/);
  });
});
