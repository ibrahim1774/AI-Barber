import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichFromGoogle, hoursFromGoogle, matchPlace, normalizeName, type PlaceCandidate } from '../../lib/scrapers/enrich';
import { scrapeBookingUrl } from '../../lib/scrapers/index';
import { searchPlacesForEnrichment } from '../../lib/gbp/gbpPlaces';
import { buildSiteFromScrape } from '../../lib/buildSiteFromScrape';
import type { ScrapedShop } from '../../lib/scrapers/types';
import { apifyItems, fixture, html, json, stubFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const googleHours = WEEK.map((day, i) => (i === 6 ? { day, hours: 'Closed', closed: true } : { day, hours: '9:00 AM – 6:30 PM' }));
const place = (over: Partial<PlaceCandidate> = {}): PlaceCandidate => ({
  name: "Tony's Barber Shop",
  address: '728 Franklin Ave, Brooklyn, NY 11238, USA',
  phone: '(718) 555-0100',
  rating: 4.7,
  ratingCount: 210,
  hours: googleHours,
  ...over,
});
const bare = (over: Partial<ScrapedShop> = {}): ScrapedShop => ({
  shopName: "Tony's Barbershop", area: 'Brooklyn, NY', address: '728 Franklin Ave, Brooklyn, NY, 11238', phone: '', hours: [],
  services: [], photos: ['https://x.test/1.jpg'], reviews: [], ...over,
});
const lookup = (cands: PlaceCandidate[] | null) => vi.fn(async () => cands);

describe('enrichFromGoogle: fills only what is empty', () => {
  it('fills hours (as HH:MM rows), phone and rating; marks them as from Google; photos untouched', async () => {
    const out = await enrichFromGoogle(bare(), lookup([place()]));
    expect(out.phone).toBe('(718) 555-0100');
    expect(out.aggregateRating).toEqual({ rating: 4.7, count: 210 });
    expect(out.hours?.[0]).toEqual({ day: 'Monday', open: '09:00', close: '18:30' });
    expect(out.hours?.[6]).toMatchObject({ day: 'Sunday', closed: true });
    expect(out.enriched).toEqual({ hours: 'google', phone: 'google', aggregateRating: 'google' });
    expect(out.photos).toEqual(['https://x.test/1.jpg']);
  });
  it('never overrides what the booking page had', async () => {
    const own = bare({
      phone: '(111) 222-3333', address: '1 Own St, Brooklyn, NY 11238', area: 'Brooklyn, NY',
      hours: [{ day: 'Monday', open: '10:00', close: '16:00' }], aggregateRating: { rating: 5, count: 3 },
    });
    const look = lookup([place()]);
    const out = await enrichFromGoogle(own, look);
    expect(look).not.toHaveBeenCalled(); // nothing missing: no lookup at all
    expect(out).toBe(own);
  });
  it('fills only the missing field when others exist', async () => {
    const out = await enrichFromGoogle(bare({ phone: '(111) 222-3333', hours: [{ day: 'Monday', open: '10:00', close: '16:00' }] }), lookup([place()]));
    expect(out.phone).toBe('(111) 222-3333');
    expect(out.hours).toEqual([{ day: 'Monday', open: '10:00', close: '16:00' }]);
    expect(out.aggregateRating?.rating).toBe(4.7);
    expect(out.enriched).toEqual({ aggregateRating: 'google' });
  });
  it('fills address and area when the page had none (name must then match exactly)', async () => {
    const out = await enrichFromGoogle(bare({ address: '', area: '', shopName: "Tony's Barber Shop" }), lookup([place()]));
    expect(out.address).toBe('728 Franklin Ave, Brooklyn, NY 11238');
    expect(out.area).toBe('Brooklyn, NY');
  });
  it('all-closed Google hours fill nothing', async () => {
    const out = await enrichFromGoogle(bare(), lookup([place({ hours: WEEK.map((day) => ({ day, hours: 'Closed', closed: true })) })]));
    expect(out.hours).toEqual([]);
  });
});

describe('enrichFromGoogle: refuses a doubtful match', () => {
  it('wrong business (different name)', async () => {
    const out = await enrichFromGoogle(bare(), lookup([place({ name: 'Sharp Edge Cuts' })]));
    expect(out.phone).toBe('');
    expect(out.enriched).toBeUndefined();
  });
  it('same name, different city/zip/street', async () => {
    const out = await enrichFromGoogle(bare(), lookup([place({ address: '9 Elm St, Austin, TX 78701, USA' })]));
    expect(out.phone).toBe('');
  });
  it('two branches that both match the name and city: ambiguous, fill nothing', async () => {
    const out = await enrichFromGoogle(bare(), lookup([place(), place({ phone: '(718) 555-0199', address: '12 Court St, Brooklyn, NY 11201, USA' })]));
    expect(out.phone).toBe('');
  });
  it('no address on the scrape: needs the exact normalized name; a near-miss is rejected', async () => {
    const noLoc = bare({ address: '', area: '' });
    expect((await enrichFromGoogle(noLoc, lookup([place({ name: "Tony's Barber Shops" })]))).phone).toBe('(718) 555-0100'); // normalizes equal
    expect((await enrichFromGoogle(noLoc, lookup([place({ name: 'Tonys Barber Lounge Brooklyn' })]))).phone).toBe('');
  });
  it('no address and two exact-name results: ambiguous', async () => {
    const noLoc = bare({ address: '', area: '' });
    expect((await enrichFromGoogle(noLoc, lookup([place(), place({ address: '5 Other Rd, Queens, NY 11101, USA' })]))).phone).toBe('');
  });
  it('very close spelling plus the same zip is accepted', async () => {
    const out = await enrichFromGoogle(bare({ shopName: 'Brooklyn Fade Factory' }), lookup([place({ name: 'Brooklyn Fade Faktory' })]));
    expect(out.phone).toBe('(718) 555-0100');
  });
  it('matchPlace reasons', () => {
    expect(matchPlace(bare(), [])).toEqual({ ok: false, reason: 'none' });
    expect(matchPlace(bare({ shopName: '' }), [place()])).toEqual({ ok: false, reason: 'no-name' });
  });
});

describe('enrichFromGoogle: failure paths never break the import', () => {
  it('lookup throws -> shop unchanged', async () => {
    const shop = bare();
    const out = await enrichFromGoogle(shop, async () => { throw new Error('timeout'); });
    expect(out).toBe(shop);
  });
  it('lookup returns null / nothing, or no lookup configured -> unchanged', async () => {
    const shop = bare();
    expect(await enrichFromGoogle(shop, lookup(null))).toBe(shop);
    expect(await enrichFromGoogle(shop, lookup([]))).toBe(shop);
    expect(await enrichFromGoogle(shop, null)).toBe(shop);
  });
  it('the Places request: HTTP error, network error, no key -> null, no throw', async () => {
    stubFetch([(c) => (/places\.googleapis/.test(c.url) ? { status: 500, body: 'x' } : undefined)]);
    expect(await searchPlacesForEnrichment('x', 'fake-key')).toBeNull();
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    expect(await searchPlacesForEnrichment('x', 'fake-key')).toBeNull();
    expect(await searchPlacesForEnrichment('x', '')).toBeNull();
  });
  it('the Places request is ONE Text Search with a field mask that excludes photos and reviews', async () => {
    const net = stubFetch([json(/places\.googleapis/, { places: [{ displayName: { text: 'A' }, formattedAddress: 'x', regularOpeningHours: { weekdayDescriptions: ['Monday: 9:00 AM – 5:00 PM'] } }] })]);
    const r = await searchPlacesForEnrichment('A', 'fake-key');
    expect(net.places()).toHaveLength(1);
    expect(r?.[0].hours[0].hours).toBe('9:00 AM – 5:00 PM');
    expect(JSON.stringify(net.calls)).not.toMatch(/photos|reviews/);
  });
});

describe('hoursFromGoogle', () => {
  it('12-hour clock, a missing AM/PM on the opening time, split-free 24 hours, unreadable text dropped', () => {
    const rows = hoursFromGoogle([
      { day: 'Monday', hours: '9 – 5 PM' },
      { day: 'Tuesday', hours: 'Open 24 hours' },
      { day: 'Wednesday', hours: 'By appointment' },
      { day: 'Thursday', hours: '10:00 AM – 7:00 PM' },
    ]);
    expect(rows.map((r) => [r.day, r.open, r.close])).toEqual([
      ['Monday', '09:00', '17:00'], ['Tuesday', '00:00', '23:59'], ['Thursday', '10:00', '19:00'],
    ]);
  });
  it('normalizeName', () => {
    expect(normalizeName("Tony's Barber Shop, LLC")).toBe('tonys');
    expect(normalizeName('Café & Cuts')).toBe('cafe');
  });
});

// Per provider: the page gives a name (and little else) -> what Google adds. One Places call per import.
describe('per provider through scrapeBookingUrl (Google lookup mocked)', () => {
  // The same page with no opening hours anywhere (JSON-LD or page state), as a page that lacks them would be.
  const withoutHours = (page: string) =>
    page
      .replace(/"openingHoursSpecification": ?\[.*?\], ?"image"/, '"image"')
      .replace(/"locations": ?\[\{"hours": ?\{.*?\}\}\]/, '"locations":[{}]');
  const g = (cands: PlaceCandidate[]) => vi.fn(async () => cands);
  const cases: [string, string, () => any[], PlaceCandidate][] = [
    ['vagaro', 'https://www.vagaro.com/fadelab', () => [html(/vagaro\.com/, '<meta property="og:title" content="Fade Lab - Austin TX | Vagaro"><meta property="og:image" content="https://img.vagaro.com/a.jpg">')], place({ name: 'Fade Lab', address: '1 Congress Ave, Austin, TX 78701, USA' })],
    ['styleseat', 'https://www.styleseat.com/m/v/samcuts', () => [json(/styleseat\.com\/api/, { name: 'Sam', locations: [{ name: 'Sam Cuts', city: 'Austin', state: 'TX' }] })], place({ name: 'Sam Cuts', address: '1 Congress Ave, Austin, TX 78701, USA' })],
    ['thecut', 'https://book.thecut.co/cutsbysam', () => [json(/api\.thecut\.co/, { name: 'Cuts By Sam', address: { city: 'Austin', region: 'TX' }, services: [] })], place({ name: 'Cuts By Sam', address: '1 Congress Ave, Austin, TX 78701, USA' })],
    ['acuity', 'https://app.acuityscheduling.com/schedule.php?owner=1', () => [html(/acuityscheduling/, fixture('acuity-business.html'))], place({ name: "Leo's Barbershop", address: '59-11 71st Ave, Ridgewood, NY 11385, USA' })],
    ['glossgenius', 'https://x.glossgenius.com/', () => [html(/glossgenius/, withoutHours(fixture('glossgenius-solo.html')))], place({ name: 'DR The Barber', address: '2400 Bull St, Savannah, GA 31401, USA' })],
  ];
  it.each(cases)('%s: empty phone/hours get Google values, nothing else changes', async (id, url, routes, p) => {
    stubFetch(routes());
    const look = g([p]);
    const { shop } = await scrapeBookingUrl(url, { placeLookup: look });
    expect(look).toHaveBeenCalledTimes(1);
    expect(shop.enriched?.hours).toBe('google');
    expect(shop.hours?.some((h) => !h.closed && /^\d\d:\d\d$/.test(h.open))).toBe(true);
    if (id !== 'glossgenius') expect(shop.phone).toBe('(718) 555-0100'); // GlossGenius already had a phone
    else expect(shop.phone).toBe('(555) 555-0100');
  });
  it('a provider whose page has everything triggers no lookup (GlossGenius team page with rating, hours, phone, address)', async () => {
    stubFetch([html(/glossgenius/, fixture('glossgenius-team.html'))]);
    const look = g([place()]);
    const { shop } = await scrapeBookingUrl('https://x.glossgenius.com/', { placeLookup: look });
    expect(look).not.toHaveBeenCalled();
    expect(shop.enriched).toBeUndefined();
  });
  it('a lookup that throws still returns the scrape', async () => {
    stubFetch([html(/glossgenius/, fixture('glossgenius-solo.html'))]);
    const { shop } = await scrapeBookingUrl('https://x.glossgenius.com/', { placeLookup: async () => { throw new Error('down'); } });
    expect(shop.shopName).toBe('DR The Barber');
  });
  it('enriched hours reach the site as hours rows in the editor shape', () => {
    const built = buildSiteFromScrape({ shopName: 'Fade Lab', hours: [{ day: 'Monday', open: '09:00', close: '18:30' }, { day: 'Sunday', open: '', close: '', closed: true }], _platform: 'vagaro', photos: ['https://img.vagaro.com/a.jpg'] }, 'https://www.vagaro.com/fadelab');
    expect(built.scraped.hours).toEqual([{ day: 'Monday', open: '09:00', close: '18:30' }, { day: 'Sunday', open: '', close: '', closed: true }]);
    expect(built.scraped.importedFrom).toBe('booking');
  });
  it('no Apify call ever happens in enrichment', async () => {
    const net = stubFetch([html(/glossgenius/, fixture('glossgenius-solo.html')), apifyItems([])]);
    await scrapeBookingUrl('https://x.glossgenius.com/', { placeLookup: g([place({ name: 'DR The Barber', address: '2400 Bull St, Savannah, GA 31401, USA' })]) });
    expect(net.apify()).toHaveLength(0);
  });
});
