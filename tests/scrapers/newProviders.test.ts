import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectPlatform, scrapeBookingUrl } from '../../lib/scrapers/index';
import { cleanPhotoUrls, finalize } from '../../lib/scrapers/util';
import { normalizeHours } from '../../lib/scrapeNormalize';
import { isBlockedPage } from '../../lib/scrapers/squire';
import { shopFromStructuredHtml } from '../../lib/scrapers/structured';
import { DUMMY_APIFY_TOKEN, apifyItems, fixture, html, json, stubFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const GG = 'https://example.glossgenius.com/';

describe('detectPlatform', () => {
  it.each([
    ['https://getsquire.com/booking/book/some-shop', 'squire'],
    ['getsquire.com/discover/barbershop/x', 'squire'],
    ['https://drthebarber.glossgenius.com/', 'glossgenius'],
    ['https://app.acuityscheduling.com/schedule.php?owner=1', 'acuity'],
    ['https://leobarbershop.as.me/', 'acuity'],
    ['https://booksy.com/en-us/1_x', 'booksy'],
  ])('%s -> %s', (url, id) => {
    const d = detectPlatform(url);
    expect(d.unsupportedReason).toBeUndefined();
    expect(d.adapter?.id).toBe(id);
  });
  it('Calendly stays rejected (no business data on its pages)', () => {
    expect(detectPlatform('https://calendly.com/someone/30min').unsupportedReason).toMatch(/Calendly/);
  });
});

describe('GlossGenius', () => {
  it('team page: name, address, phone, rating, hours, services with price/duration/category, staff, photos', async () => {
    const net = stubFetch([html(/glossgenius\.com/, fixture('glossgenius-team.html'))]);
    const { platform, shop } = await scrapeBookingUrl(GG, {});
    expect(platform).toBe('glossgenius');
    expect(shop.shopName).toBe('Deluxe Barber Lounge');
    expect(shop.address).toBe('7301 S 900 E suite 12, Midvale, UT, 84047');
    expect(shop.phone).toBe('(555) 555-0100');
    expect(shop.aggregateRating).toEqual({ rating: 5, count: 81 });
    // Tuesday 10:30-18:30 from locations[0].hours; Monday and Sunday closed.
    expect(shop.hours?.find((h) => h.day === 'Tuesday')).toEqual({ day: 'Tuesday', open: '10:30', close: '18:30' });
    expect(shop.hours?.find((h) => h.day === 'Monday')?.closed).toBe(true);
    const cut = shop.services.find((s) => s.title === 'Deluxe Haircut And Beard');
    expect(cut).toMatchObject({ price: '$60', duration: '50 min', category: 'Haircut' });
    expect(shop.staff?.length).toBe(3);
    expect(shop.staff?.[0].name).toBe('Team Member A');
    expect(shop.photos[0]).toMatch(/website_cover_image/);
    expect(shop.photos.length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(shop)).not.toMatch(/@/); // no e-mail address anywhere
    expect(net.apify()).toHaveLength(0); // plenty of photos: no paid run
  });

  it('solo page: team hidden, price that varies gets a +, 00:00-00:00 days are closed, "None" category dropped', async () => {
    stubFetch([html(/glossgenius\.com/, fixture('glossgenius-solo.html'))]);
    const { shop } = await scrapeBookingUrl(GG, {});
    expect(shop.shopName).toBe('DR The Barber');
    expect(shop.staff).toEqual([]);
    const first = shop.services.find((s) => s.title === 'First Time/New Clients');
    expect(first).toMatchObject({ price: '$60+', duration: '1 hr 30 min' });
    expect(first?.category).toBeUndefined();
    expect(shop.hours?.find((h) => h.day === 'Monday')?.closed).toBe(true);
    expect(shop.hours?.find((h) => h.day === 'Wednesday')).toMatchObject({ open: '09:00', close: '17:00' });
  });

  it('an empty page is a friendly error, not an invented shop', async () => {
    stubFetch([html(/glossgenius\.com/, fixture('squire-empty.html'))]);
    await expect(scrapeBookingUrl(GG, {})).rejects.toThrow(/Couldn't read that GlossGenius/);
  });

  it('thin gallery + token: ONE mocked Apify run adds the rendered gallery (own CDN, no avatars); no token = no run', async () => {
    const thin = fixture('glossgenius-solo.html').replace(/"image": ?"https:[^"]*\/service\/[^"]*"/g, '"image":""');
    const noToken = stubFetch([html(/glossgenius\.com/, thin)]);
    const a = await scrapeBookingUrl(GG, {});
    expect(noToken.apify()).toHaveLength(0);
    expect(a.shop.photos.length).toBe(1);

    const net = stubFetch([
      html(/glossgenius\.com/, thin),
      apifyItems([{ photos: [
        'https://static.glossgenius.com/public/portfolio/aaa/1.jpg',
        'https://static.glossgenius.com/public/portfolio/aaa/2.jpg',
        'http://static.glossgenius.com/public/portfolio/insecure.jpg',
        'https://static.glossgenius.com/public/portfolio/logo.svg',
      ] }]),
    ]);
    const b = await scrapeBookingUrl(GG, { apifyToken: DUMMY_APIFY_TOKEN });
    expect(net.apify()).toHaveLength(1);
    expect(b.shop.photos).toHaveLength(3); // cover + 2 https gallery images; http and svg dropped
    expect(b.shop.photos.slice(1)).toEqual([
      'https://static.glossgenius.com/public/portfolio/aaa/1.jpg',
      'https://static.glossgenius.com/public/portfolio/aaa/2.jpg',
    ]);
  });
});

describe('Acuity', () => {
  const URL_ = 'https://app.acuityscheduling.com/schedule.php?owner=123';
  it('name, services with price/duration, staff, address from the calendar; no hours or phone invented', async () => {
    stubFetch([html(/acuityscheduling\.com/, fixture('acuity-business.html'))]);
    const { platform, shop } = await scrapeBookingUrl(URL_, {});
    expect(platform).toBe('acuity');
    expect(shop.shopName).toBe("Leo's Barbershop");
    expect(shop.services[0]).toMatchObject({ title: 'Regular Haircut', price: '$30', duration: '20 min' });
    expect(shop.services.length).toBeGreaterThan(3);
    expect(shop.staff?.map((s) => s.name)).toEqual(['Leo', 'simon']);
    expect(shop.staff?.[0].photo).toMatch(/^https:\/\//);
    expect(shop.address).toBe('59-11 71st ave ridgewood ny 11385');
    expect(shop.hours).toEqual([]);
    expect(shop.phone).toBe('');
    // Only the service images the page itself lists, https; the logo and the staff headshots are not gallery photos.
    expect(shop.photos.every((p) => p.startsWith('https://'))).toBe(true);
    expect(shop.photos).not.toContain(shop.staff?.[0].photo);
  });
  it('private and inactive appointment types are not imported', async () => {
    const page = fixture('acuity-business.html').replaceAll('"private": false', '"private": true');
    stubFetch([html(/acuityscheduling\.com/, page)]);
    const { shop } = await scrapeBookingUrl(URL_, {});
    expect(shop.services).toEqual([]);
  });
  it('a page without the scheduler state is a friendly error', async () => {
    stubFetch([html(/acuityscheduling\.com/, fixture('squire-empty.html'))]);
    await expect(scrapeBookingUrl(URL_, {})).rejects.toThrow(/Couldn't read that Acuity/);
  });
});

describe('Squire', () => {
  const URL_ = 'https://getsquire.com/booking/book/example-barbershop';
  it('detects the bot-check page', () => {
    expect(isBlockedPage(403, fixture('squire-blocked.html'))).toBe(true);
    expect(isBlockedPage(200, fixture('squire-synthetic.html'))).toBe(false);
  });
  it('blocked and no token: friendly error that points to Find me on Google, zero paid calls', async () => {
    const net = stubFetch([(c) => (/getsquire\.com/.test(c.url) ? { status: 403, body: fixture('squire-blocked.html') } : undefined)]);
    await expect(scrapeBookingUrl(URL_, {})).rejects.toThrow(/find you on Google/);
    expect(net.apify()).toHaveLength(0);
  });
  it('blocked + token: one mocked Apify render, parsed by the structured reader', async () => {
    const net = stubFetch([
      (c) => (/getsquire\.com/.test(c.url) ? { status: 403, body: fixture('squire-blocked.html') } : undefined),
      apifyItems([{ html: fixture('squire-synthetic.html'), photos: ['https://images.example-cdn.test/shop/2.jpg'] }]),
    ]);
    const { platform, shop } = await scrapeBookingUrl(URL_, { apifyToken: DUMMY_APIFY_TOKEN });
    expect(platform).toBe('squire');
    expect(net.apify()).toHaveLength(1);
    expect(shop.shopName).toBe('Example Barbershop');
    expect(shop.photos).toContain('https://images.example-cdn.test/shop/2.jpg');
  });
  it('blocked even after the Apify render: error, never a made-up shop', async () => {
    stubFetch([
      (c) => (/getsquire\.com/.test(c.url) ? { status: 403, body: fixture('squire-blocked.html') } : undefined),
      apifyItems([{ html: fixture('squire-blocked.html'), photos: [] }]),
    ]);
    await expect(scrapeBookingUrl(URL_, { apifyToken: DUMMY_APIFY_TOKEN })).rejects.toThrow(/blocked us/);
  });
  it('a readable page (synthetic, schema.org-shaped): hours, rating, services, phone, https photos only', async () => {
    const net = stubFetch([html(/getsquire\.com/, fixture('squire-synthetic.html'))]);
    const { shop } = await scrapeBookingUrl(URL_, {});
    expect(shop.shopName).toBe('Example Barbershop');
    expect(shop.phone).toBe('(555) 555-0100');
    expect(shop.aggregateRating).toEqual({ rating: 4.8, count: 120 });
    expect(shop.hours?.find((h) => h.day === 'Saturday')).toMatchObject({ open: '10:00', close: '14:00' });
    expect(shop.hours?.find((h) => h.day === 'Sunday')?.closed).toBe(true);
    expect(shop.services[0]).toMatchObject({ title: 'Haircut', price: '$35', duration: '30 min' });
    expect(shop.services[1]).toMatchObject({ title: 'Beard Trim', price: '$15' });
    expect(shop.photos.every((p) => p.startsWith('https://'))).toBe(true);
    expect(shop.photos.some((p) => p.includes('insecure'))).toBe(false);
    expect(net.apify()).toHaveLength(0); // no token: no paid run for photos
  });
  it('empty page: structured reader finds nothing', () => {
    expect(shopFromStructuredHtml(fixture('squire-empty.html'))).toBeNull();
  });
});

describe('photos: existing providers + shared rules (all Apify output mocked)', () => {
  it('Vagaro: og:image only -> no run without a token; with a token one mocked run adds the gallery', async () => {
    const page = '<html><head><meta property="og:title" content="Fade Lab - Austin TX | Vagaro"><meta property="og:image" content="https://img.vagaro.com/a.jpg"></head></html>';
    const none = stubFetch([html(/vagaro\.com/, page)]);
    const a = await scrapeBookingUrl('https://www.vagaro.com/fadelab', {});
    expect(a.shop.photos).toEqual(['https://img.vagaro.com/a.jpg']);
    expect(none.apify()).toHaveLength(0);

    const net = stubFetch([html(/www\.vagaro\.com/, page), apifyItems([{ photos: ['https://img.vagaro.com/b.jpg', 'https://img.vagaro.com/a.jpg'] }])]);
    const b = await scrapeBookingUrl('https://www.vagaro.com/fadelab', { apifyToken: DUMMY_APIFY_TOKEN });
    expect(net.apify()).toHaveLength(1);
    expect(b.shop.photos).toEqual(['https://img.vagaro.com/a.jpg', 'https://img.vagaro.com/b.jpg']); // deduped
  });
  it('theCut: profile picture + mocked gallery; a failed Apify run leaves the import intact', async () => {
    const api = json(/api\.thecut\.co/, { name: 'Cuts By Sam', profilePictureUrl: 'https://cdn.thecut.test/p.jpg', services: [], address: { city: 'Miami', region: 'FL' } });
    stubFetch([api, apifyItems([{ photos: ['https://cdn.thecut.test/g1.jpg'] }])]);
    const ok = await scrapeBookingUrl('https://book.thecut.co/cutsbysam', { apifyToken: DUMMY_APIFY_TOKEN });
    expect(ok.shop.photos).toEqual(['https://cdn.thecut.test/p.jpg', 'https://cdn.thecut.test/g1.jpg']);
    stubFetch([api, (c) => (/api\.apify\.com/.test(c.url) ? { status: 500, body: 'boom' } : undefined)]);
    const failed = await scrapeBookingUrl('https://book.thecut.co/cutsbysam', { apifyToken: DUMMY_APIFY_TOKEN });
    expect(failed.shop.photos).toEqual(['https://cdn.thecut.test/p.jpg']);
  });
  it('StyleSeat: API gives no photo; only the mocked Apify gallery fills it', async () => {
    const api = json(/styleseat\.com\/api/, { name: 'Sam', locations: [{ name: 'Sam Cuts', city: 'Austin', state: 'TX' }] });
    const none = stubFetch([api]);
    expect((await scrapeBookingUrl('https://www.styleseat.com/m/v/samcuts', {})).shop.photos).toEqual([]);
    expect(none.apify()).toHaveLength(0);
    stubFetch([api, apifyItems([{ photos: ['https://cdn.styleseat.test/1.jpg'] }])]);
    const r = await scrapeBookingUrl('https://www.styleseat.com/m/v/samcuts', { apifyToken: DUMMY_APIFY_TOKEN });
    expect(r.shop.photos).toEqual(['https://cdn.styleseat.test/1.jpg']);
  });
  it('APIFY_PHOTO_ENRICH=off switches the new photo runs off', async () => {
    vi.stubEnv('APIFY_PHOTO_ENRICH', 'off');
    const net = stubFetch([json(/styleseat\.com\/api/, { name: 'Sam', locations: [] }), apifyItems([{ photos: ['https://x.test/1.jpg'] }])]);
    await scrapeBookingUrl('https://www.styleseat.com/m/v/samcuts', { apifyToken: DUMMY_APIFY_TOKEN });
    expect(net.apify()).toHaveLength(0);
    vi.unstubAllEnvs();
  });
  it('finalize: https only, protocol-relative upgraded, svg/gif/data dropped, deduped without query, capped', () => {
    expect(cleanPhotoUrls(['//cdn.x/a.jpg', 'http://x/b.jpg', 'https://x/c.svg', 'data:image/png;base64,AA', 'https://x/d.gif', 'https://x/e.jpg?w=1', 'https://x/e.jpg?w=2', 5, ' https://x/f.png '])).toEqual(
      ['https://cdn.x/a.jpg', 'https://x/e.jpg?w=1', 'https://x/e.jpg?w=2', 'https://x/f.png'],
    );
    const many = Array.from({ length: 40 }, (_, i) => `https://x/${i}.jpg`);
    const shop = finalize({ shopName: 'A', area: '', address: '', services: [], photos: [...many, ...many], reviews: [] });
    expect(shop.photos).toHaveLength(20);
  });
});

describe('hours: a day that opens and closes at the same minute is closed', () => {
  it('00:00-00:00 -> closed; a real 24 h day (00:00-23:59) stays open', () => {
    const rows = normalizeHours([
      { day: 'Monday', open: '00:00', close: '00:00' },
      { day: 'Tuesday', open: '09:00', close: '17:00' },
      { day: 'Wednesday', open: '00:00', close: '23:59' },
    ]);
    expect(rows[0].closed).toBe(true);
    expect(rows[1]).toEqual({ day: 'Tuesday', open: '09:00', close: '17:00' });
    expect(rows[2].closed).toBeUndefined();
  });
});
